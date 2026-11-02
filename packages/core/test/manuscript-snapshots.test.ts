import { afterEach, expect, it } from "vitest";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { copyFixture } from "../../../tests/helpers/fixture-projects.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
import {
  applyHistoryRetention,
  createHistorySnapshot,
  openProjectForEditing,
  openProject,
  migrateProjectToEditorialV3,
  createEditorialAnnotation,
  replyToEditorialThread,
  saveChapter,
  importImageAsset,
  listManuscriptSnapshots,
  captureNamedSnapshot,
  inspectManuscriptSnapshot,
  previewSnapshotRestore,
  restoreNamedSnapshot,
  setManuscriptSnapshotDeleted,
  recoverEditorialTransactions,
  readEditorialDraft,
  recoverEditorialDraft,
  createProjectArchive,
  restoreProjectArchive,
  resolveSnapshotRestoreConflict,
  listSnapshotRestoreConflicts,
  readImageAsset,
  saveBookTheme,
} from "../src/index.js";
import { createUuid } from "@drelwick/shared";
import {
  ManuscriptSnapshotSchema,
  SnapshotDeletionSchema,
} from "@drelwick/project-model";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
async function fixture() {
  const copy = await copyFixture("multi-chapter-book");
  cleanups.push(copy.cleanup);
  await openProjectForEditing(copy.projectPath);
  await migrateProjectToEditorialV3(copy.projectPath);
  const session = await openProject(copy.projectPath);
  return {
    root: copy.projectPath,
    projectId: session.project.projectId,
    ids: session.project.manuscript.order,
  };
}
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function capture(
  f: Awaited<ReturnType<typeof fixture>>,
  label = "Checkpoint",
) {
  const listing = await listManuscriptSnapshots(f.root, f.projectId);
  return captureNamedSnapshot({
    projectPath: f.root,
    projectId: f.projectId,
    operationId: createUuid(),
    label,
    expected: listing.source,
  });
}
async function annotate(f: Awaited<ReturnType<typeof fixture>>, body: string) {
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: doc("red fox"),
  });
  return createEditorialAnnotation({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    from: 5,
    to: 8,
    kind: "comment",
    body,
    evidence: {
      slice: {
        content: [{ type: "text", text: "fox" }],
        openStart: 0,
        openEnd: 0,
      },
      prefix: "red ",
      suffix: "",
    },
  });
}

it("S01 captures complete ordered chapters, shared and retained deleted assets and exact editorial bytes", async () => {
  const f = await fixture();
  const source = join(dirname(f.root), "source.png");
  await writeFile(source, await syntheticImage());
  const first = await importImageAsset({
    projectPath: f.root,
    sourcePath: source,
  });
  const retained = await importImageAsset({
    projectPath: f.root,
    sourcePath: source,
  });
  const image = (id: string) => ({
    type: "image",
    attrs: { assetId: id, alt: "Synthetic image", size: "medium" },
  });
  const before = { type: "doc", content: [image(retained.id)] };
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: before,
  });
  await createEditorialAnnotation({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    from: 0,
    to: 1,
    kind: "comment",
    body: "Retained image discussion",
    evidence: {
      slice: { content: [image(retained.id)], openStart: 0, openEnd: 0 },
      prefix: "",
      suffix: "",
    },
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: { type: "doc", content: [image(first.id)] },
    transactions: [
      {
        before,
        steps: [
          {
            stepType: "replace",
            from: 0,
            to: 1,
            slice: { content: [image(first.id)] },
          },
        ],
      },
    ],
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[1]!,
    document: { type: "doc", content: [image(first.id)] },
  });
  const snapshot = await capture(f, "Unicode checkpoint 🦊");
  const selected = await inspectManuscriptSnapshot(
    f.root,
    f.projectId,
    snapshot,
  );
  expect(selected.chapters.map((chapter) => chapter.id)).toEqual(f.ids);
  for (const id of [first.id, retained.id])
    expect(
      selected.files.filter((file) => file.path.includes(id)),
    ).toHaveLength(2);
  for (const file of selected.files) {
    const current = await readFile(join(f.root, file.path));
    const saved = await readFile(
      join(
        f.root,
        "snapshots/manuscript",
        snapshot.snapshotId,
        "files",
        file.path,
      ),
    );
    expect(saved).toEqual(current);
    expect(createHash("sha256").update(saved).digest("hex")).toBe(file.sha256);
  }
  expect(selected.exclusions).toEqual([
    "reference",
    "application-settings",
    "other-snapshots",
    "periodic-history",
  ]);
}, 30_000);

it.each(["after-copy", "before-manifest"])(
  "S02 preserves originals and never publishes success when capture fails at %s",
  async (point) => {
    const f = await fixture(),
      source = (await listManuscriptSnapshots(f.root, f.projectId)).source;
    const original = await readFile(join(f.root, "project.json"));
    const operationId = createUuid();
    await expect(
      captureNamedSnapshot(
        {
          projectPath: f.root,
          projectId: f.projectId,
          operationId,
          label: "Interrupted",
          expected: source,
        },
        {
          checkpoint: async (name) => {
            if (name === point)
              throw Object.assign(new Error("Synthetic disk failure"), {
                code: "ENOSPC",
              });
          },
        },
      ),
    ).rejects.toThrow();
    expect(await readFile(join(f.root, "project.json"))).toEqual(original);
    await expect(
      readFile(
        join(f.root, "snapshots/manuscript", operationId, "snapshot.json"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const listing = await listManuscriptSnapshots(f.root, f.projectId);
    expect(listing.snapshots).toEqual([]);
    expect(listing.diagnostics.map((item) => item.snapshotId)).toContain(
      operationId,
    );
  },
  20_000,
);

it("rejects stale generations, changed optional-file inventory, missing assets and corrupted immutable bytes", async () => {
  const f = await fixture();
  const initial = (await listManuscriptSnapshots(f.root, f.projectId)).source;
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: doc("New source"),
  });
  await expect(
    captureNamedSnapshot({
      projectPath: f.root,
      projectId: f.projectId,
      operationId: createUuid(),
      label: "Stale",
      expected: initial,
    }),
  ).rejects.toMatchObject({ code: "EDITORIAL_STALE" });
  const snapshot = await capture(f);
  await writeFile(
    join(
      f.root,
      "snapshots/manuscript",
      snapshot.snapshotId,
      "files/book.json",
    ),
    "{}",
  );
  await expect(
    inspectManuscriptSnapshot(f.root, f.projectId, snapshot),
  ).rejects.toThrow();
  const source = (await listManuscriptSnapshots(f.root, f.projectId)).source;
  await expect(
    captureNamedSnapshot(
      {
        projectPath: f.root,
        projectId: f.projectId,
        operationId: createUuid(),
        label: "Mutation",
        expected: source,
      },
      {
        checkpoint: async (point) => {
          if (point === "before-manifest")
            await writeFile(join(f.root, "publication.json"), "{}");
        },
      },
    ),
  ).rejects.toThrow();
}, 20_000);

it("S03 restores full scope with a verified safety snapshot and preserves current-only and same-ID divergent threads", async () => {
  const f = await fixture();
  await annotate(f, "Original discussion");
  const snapshot = await capture(f);
  const statePath = join(f.root, "editorial/state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  await replyToEditorialThread({
    projectPath: f.root,
    threadId: state.threads[0].id,
    body: "Current divergent reply",
  });
  await createEditorialAnnotation({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    from: 1,
    to: 4,
    kind: "note",
    body: "Current-only note",
    evidence: {
      slice: {
        content: [{ type: "text", text: "red" }],
        openStart: 0,
        openEnd: 0,
      },
      prefix: "",
      suffix: " fox",
    },
  });
  await createEditorialAnnotation({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    from: 1,
    to: 4,
    kind: "comment",
    body: "Current-only discard choice",
    evidence: {
      slice: {
        content: [{ type: "text", text: "red" }],
        openStart: 0,
        openEnd: 0,
      },
      prefix: "",
      suffix: " fox",
    },
  });
  const currentState = await readFile(statePath);
  const preview = await previewSnapshotRestore(f.root, f.projectId, snapshot);
  expect(preview.conflicts).toBe(3);
  const operationId = createUuid();
  const result = await restoreNamedSnapshot({
    projectPath: f.root,
    projectId: f.projectId,
    operationId,
    selection: snapshot,
    expected: preview.current,
  });
  expect(result.safety.snapshotId).toBe(operationId);
  expect(
    await readFile(
      join(
        f.root,
        "snapshots/manuscript",
        result.safety.snapshotId,
        "files/editorial/state.json",
      ),
    ),
  ).toEqual(currentState);
  const conflicts = await listSnapshotRestoreConflicts(f.root, f.projectId);
  expect(conflicts[0]!.entries.map((entry) => entry.reason).sort()).toEqual([
    "current-only",
    "current-only",
    "different-version",
  ]);
  expect(JSON.stringify(conflicts)).toContain("Current divergent reply");
  const restored = JSON.parse(await readFile(statePath, "utf8"));
  expect(restored.threads).toHaveLength(1);
  expect(restored.threads[0].comments).toHaveLength(1);
  expect(restored.generation).toBe(preview.current.generation + 1);
  const retry = await restoreNamedSnapshot({
    projectPath: f.root,
    projectId: f.projectId,
    operationId,
    selection: snapshot,
    expected: preview.current,
  });
  expect(retry.generation).toBe(result.generation);
  const listing = await listManuscriptSnapshots(f.root, f.projectId);
  await resolveSnapshotRestoreConflict({
    projectPath: f.root,
    projectId: f.projectId,
    operationId: createUuid(),
    expected: listing.source,
    collectionId: conflicts[0]!.id,
    annotationId: conflicts[0]!.entries[0]!.annotation.id,
    action: "copy",
  });
  const after = JSON.parse(await readFile(statePath, "utf8"));
  expect(after.annotations).toHaveLength(2);
  expect(after.annotations[1].id).not.toBe(
    conflicts[0]!.entries[0]!.annotation.id,
  );
  expect(
    (await listSnapshotRestoreConflicts(f.root, f.projectId))[0]!.entries[0]!
      .disposition,
  ).toBe("copied");
  for (const [index, action] of [
    [1, "reattach"],
    [2, "discard"],
  ] as const) {
    const source = (await listManuscriptSnapshots(f.root, f.projectId)).source;
    await resolveSnapshotRestoreConflict({
      projectPath: f.root,
      projectId: f.projectId,
      operationId: createUuid(),
      expected: source,
      collectionId: conflicts[0]!.id,
      annotationId: conflicts[0]!.entries[index]!.annotation.id,
      action,
      ...(action === "reattach"
        ? { target: { chapterId: f.ids[0]!, from: 5, to: 8 } }
        : {}),
    });
  }
  const resolved = (
    await listSnapshotRestoreConflicts(f.root, f.projectId)
  )[0]!;
  expect(resolved.entries.map((entry) => entry.disposition)).toEqual([
    "copied",
    "reattached",
    "discarded",
  ]);
  expect(resolved.entries.map((entry) => entry.thread)).toEqual(
    conflicts[0]!.entries.map((entry) => entry.thread),
  );
  expect((await listManuscriptSnapshots(f.root, f.projectId)).conflicts).toBe(
    0,
  );
}, 30_000);

it("S05 allows duplicate labels, keeps immutable bytes through recoverable deletion and archives independently of history", async () => {
  const f = await fixture();
  const first = await capture(f),
    second = await capture(f);
  expect(first.snapshotId).not.toBe(second.snapshotId);
  await createHistorySnapshot({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: doc("Old periodic history"),
    reason: "manual",
    now: "2020-01-01T00:00:00.000Z",
  });
  const retention = await applyHistoryRetention(
    f.root,
    "2026-11-02T00:00:00.000Z",
  );
  expect(retention.removed).toBeGreaterThan(0);
  const before = await readFile(
    join(f.root, "snapshots/manuscript", first.snapshotId, "snapshot.json"),
  );
  const listing = await listManuscriptSnapshots(f.root, f.projectId);
  await setManuscriptSnapshotDeleted({
    projectPath: f.root,
    projectId: f.projectId,
    operationId: createUuid(),
    expected: listing.source,
    selection: first,
    deleted: true,
  });
  await expect(
    previewSnapshotRestore(f.root, f.projectId, first),
  ).rejects.toMatchObject({ code: "EDITORIAL_STALE" });
  expect(
    await readFile(
      join(f.root, "snapshots/manuscript", first.snapshotId, "snapshot.json"),
    ),
  ).toEqual(before);
  const deleted = await listManuscriptSnapshots(f.root, f.projectId);
  await setManuscriptSnapshotDeleted({
    projectPath: f.root,
    projectId: f.projectId,
    operationId: createUuid(),
    expected: deleted.source,
    selection: first,
    deleted: false,
  });
  const archivePath = join(dirname(f.root), "snapshot.zip"),
    destinationParent = join(dirname(f.root), "restored");
  await mkdir(destinationParent);
  await createProjectArchive({
    projectPath: f.root,
    archivePath,
    includeHistory: false,
  });
  const archive = await restoreProjectArchive({
    archivePath,
    destinationParent,
  });
  const reopened = await listManuscriptSnapshots(
    archive.projectPath,
    f.projectId,
  );
  expect(reopened.snapshots.map((item) => item.snapshotId).sort()).toEqual(
    [first.snapshotId, second.snapshotId].sort(),
  );
}, 30_000);

it.each([
  "after-safety",
  "after-images",
  "draft-staged",
  "prepared",
  "after-publication",
  "last-publication",
  "committed",
])(
  "S04 killed restore at %s recovers a complete generation without consuming snapshots",
  async (point) => {
    const f = await fixture();
    const snapshot = await capture(f);
    const original = await readFile(
      join(f.root, "manuscript", `${f.ids[0]}.json`),
    );
    await saveChapter({
      projectPath: f.root,
      chapterId: f.ids[0]!,
      document: doc("Current recoverable manuscript"),
    });
    const current = await readFile(
      join(f.root, "manuscript", `${f.ids[0]}.json`),
    );
    const preview = await previewSnapshotRestore(f.root, f.projectId, snapshot),
      operationId = createUuid();
    const marker = join(dirname(f.root), "checkpoint-hit.txt");
    const fileCount = (
      await inspectManuscriptSnapshot(f.root, f.projectId, snapshot)
    ).files.filter((file) => !file.path.startsWith("assets/")).length;
    const script = `import {writeFile} from 'node:fs/promises'; import {restoreNamedSnapshot} from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/core/dist/index.js")).href)}; let count=0; await restoreNamedSnapshot(JSON.parse(process.argv[1]),{checkpoint:async name=>{if(name==='after-publication')count++; if(name===process.argv[2] || (process.argv[2]==='last-publication' && name==='after-publication' && count===Number(process.argv[4]))){await writeFile(process.argv[3],'hit');process.kill(process.pid,'SIGKILL')}}});`;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        script,
        JSON.stringify({
          projectPath: f.root,
          projectId: f.projectId,
          operationId,
          selection: snapshot,
          expected: preview.current,
        }),
        point,
        marker,
        String(fileCount),
      ],
      { stdio: "pipe" },
    );
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", () => resolve());
    });
    expect(await readFile(marker, "utf8")).toBe("hit");
    if (point === "after-images") {
      await expect(recoverEditorialTransactions(f.root)).rejects.toMatchObject({
        code: "EDITORIAL_RECOVERY_REQUIRED",
      });
      expect(
        await readFile(join(f.root, "manuscript", `${f.ids[0]}.json`)),
      ).toEqual(current);
      expect(
        await readFile(
          join(
            f.root,
            "snapshots/manuscript",
            snapshot.snapshotId,
            "snapshot.json",
          ),
        ),
      ).toBeDefined();
      return;
    }
    await recoverEditorialTransactions(f.root);
    await recoverEditorialTransactions(f.root);
    const recovered = await readFile(
      join(f.root, "manuscript", `${f.ids[0]}.json`),
    );
    if (point === "committed")
      expect(JSON.parse(recovered.toString()).content).toEqual(
        JSON.parse(original.toString()).content,
      );
    else expect(recovered).toEqual(current);
    expect(
      (await listManuscriptSnapshots(f.root, f.projectId)).snapshots.map(
        (item) => item.snapshotId,
      ),
    ).toContain(snapshot.snapshotId);
  },
  30_000,
);

it("strict manifests reject unsupported versions, unsafe paths, incomplete scope, invalid labels and excess inventories", async () => {
  const f = await fixture(),
    snapshot = await capture(f);
  const raw = JSON.parse(
    await readFile(
      join(
        f.root,
        "snapshots/manuscript",
        snapshot.snapshotId,
        "snapshot.json",
      ),
      "utf8",
    ),
  );
  expect(ManuscriptSnapshotSchema.safeParse(raw).success).toBe(true);
  for (const value of [
    { ...raw, schemaVersion: 2 },
    { ...raw, label: " " },
    { ...raw, label: "x".repeat(501) },
    { ...raw, files: raw.files.slice(1) },
    { ...raw, absent: [] },
    {
      ...raw,
      files: [
        ...raw.files,
        { path: "../book.json", size: 1, sha256: "a".repeat(64) },
      ],
    },
  ])
    expect(ManuscriptSnapshotSchema.safeParse(value).success).toBe(false);
  expect(
    SnapshotDeletionSchema.safeParse({
      schemaVersion: 1,
      snapshotId: snapshot.snapshotId,
      deletedAt: new Date().toISOString(),
      manifestHash: snapshot.manifestHash,
      extra: true,
    }).success,
  ).toBe(false);
});

it("serializes a concurrent chapter writer behind a complete capture generation", async () => {
  const f = await fixture(),
    expected = (await listManuscriptSnapshots(f.root, f.projectId)).source;
  let ready!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = await readFile(join(f.root, "manuscript", `${f.ids[0]}.json`));
  const capturing = captureNamedSnapshot(
    {
      projectPath: f.root,
      projectId: f.projectId,
      operationId: createUuid(),
      label: "Concurrent",
      expected,
    },
    {
      checkpoint: async (point) => {
        if (point === "before-copy") {
          ready();
          await gate;
        }
      },
    },
  );
  await entered;
  const writing = saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: doc("Saved after capture"),
  });
  release();
  const selected = await capturing;
  await writing;
  expect(
    await readFile(
      join(
        f.root,
        "snapshots/manuscript",
        selected.snapshotId,
        "files/manuscript",
        `${f.ids[0]}.json`,
      ),
    ),
  ).toEqual(before);
  expect(
    JSON.parse(
      await readFile(join(f.root, "manuscript", `${f.ids[0]}.json`), "utf8"),
    ).content,
  ).toEqual(doc("Saved after capture"));
}, 20_000);

it("restores missing immutable assets and optional absence while preserving out-of-scope reference bytes", async () => {
  const f = await fixture();
  const imageSource = join(dirname(f.root), "portable.png");
  await writeFile(imageSource, await syntheticImage());
  const asset = await importImageAsset({
    projectPath: f.root,
    sourcePath: imageSource,
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { assetId: asset.id, alt: "Portable", size: "medium" },
        },
      ],
    },
  });
  const selected = await capture(f);
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: doc("No current image"),
  });
  await saveBookTheme({
    projectPath: f.root,
    projectId: f.projectId,
    themeId: "modern",
  });
  await mkdir(join(f.root, "reference"), { recursive: true });
  const reference = join(f.root, "reference/independent.txt");
  await writeFile(reference, "Independent reference remains authoritative");
  await rm(join(f.root, "assets/images", asset.id), {
    recursive: true,
    force: true,
  });
  const preview = await previewSnapshotRestore(f.root, f.projectId, selected);
  const interruptedId = createUuid();
  await expect(
    restoreNamedSnapshot(
      {
        projectPath: f.root,
        projectId: f.projectId,
        operationId: interruptedId,
        selection: selected,
        expected: preview.current,
      },
      {
        checkpoint: async (point) => {
          if (point === "prepared")
            throw new Error("Interrupted streamed restore");
        },
      },
    ),
  ).rejects.toThrow("Interrupted streamed restore");
  await recoverEditorialTransactions(f.root);
  await expect(readImageAsset(f.root, asset.id)).rejects.toThrow();
  const draft = await readEditorialDraft({
    projectPath: f.root,
    projectId: f.projectId,
    draftId: interruptedId,
  });
  expect(draft.changes.filter((change) => change.afterSource)).toHaveLength(2);
  await recoverEditorialDraft({
    projectPath: f.root,
    projectId: f.projectId,
    draftId: interruptedId,
    operationId: createUuid(),
  });
  expect((await readImageAsset(f.root, asset.id)).bytes).toEqual(
    await syntheticImage(),
  );
  expect(await readFile(imageSource)).toEqual(await syntheticImage());
  expect(await readFile(reference, "utf8")).toBe(
    "Independent reference remains authoritative",
  );
  for (const path of ["presentation.json", "print.json"])
    await expect(readFile(join(f.root, path))).rejects.toMatchObject({
      code: "ENOENT",
    });
}, 30_000);

it("reports a located missing-asset failure without claiming or publishing capture success", async () => {
  const f = await fixture();
  const source = join(dirname(f.root), "missing.png");
  await writeFile(source, await syntheticImage());
  const asset = await importImageAsset({
    projectPath: f.root,
    sourcePath: source,
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { assetId: asset.id, alt: "Missing", size: "medium" },
        },
      ],
    },
  });
  const expected = (await listManuscriptSnapshots(f.root, f.projectId)).source;
  const chapter = await readFile(
    join(f.root, "manuscript", `${f.ids[0]}.json`),
  );
  await rm(join(f.root, "assets/images", asset.id), {
    recursive: true,
    force: true,
  });
  await expect(
    captureNamedSnapshot({
      projectPath: f.root,
      projectId: f.projectId,
      operationId: createUuid(),
      label: "Unavailable asset",
      expected,
    }),
  ).rejects.toMatchObject({
    code: "SNAPSHOT_INCOMPLETE",
    component: `managed image ${asset.id}`,
  });
  expect(
    await readFile(join(f.root, "manuscript", `${f.ids[0]}.json`)),
  ).toEqual(chapter);
}, 20_000);

it("revoked authorization or changed staged bytes cannot publish a complete snapshot", async () => {
  const f = await fixture(),
    expected = (await listManuscriptSnapshots(f.root, f.projectId)).source;
  let authorized = true;
  const operationId = createUuid();
  await expect(
    captureNamedSnapshot(
      {
        projectPath: f.root,
        projectId: f.projectId,
        operationId,
        label: "Cancelled",
        expected,
      },
      {
        authorized: () => authorized,
        checkpoint: async (point) => {
          if (point === "manifest-staged") authorized = false;
        },
      },
    ),
  ).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
  await expect(
    readFile(
      join(f.root, "snapshots/manuscript", operationId, "snapshot.json"),
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const corruptId = createUuid();
  await expect(
    captureNamedSnapshot(
      {
        projectPath: f.root,
        projectId: f.projectId,
        operationId: corruptId,
        label: "Changed staging",
        expected,
      },
      {
        checkpoint: async (point) => {
          if (point === "manifest-staged")
            await writeFile(
              join(
                f.root,
                "snapshots/manuscript",
                corruptId,
                "files/book.json",
              ),
              "{}",
            );
        },
      },
    ),
  ).rejects.toThrow();
  await expect(
    readFile(join(f.root, "snapshots/manuscript", corruptId, "snapshot.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
}, 20_000);
