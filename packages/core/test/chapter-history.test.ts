import { readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import {
  applyHistoryRetention,
  createHistorySnapshot,
  deleteChapter,
  listHistorySnapshots,
  loadChapter,
  openProject,
  readHistorySnapshot,
  RecoveryService,
  saveChapter,
  scanRecoveryCandidates,
  writeJsonAtomically,
} from "../src/index.js";
import { createUuid } from "@drelwick/shared";

it.each(["temporary", "committed"])(
  "process exit at %s boundary leaves deterministic complete content and safety history",
  async (stage) => {
    const f = await setup();
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      document: prose("B"),
    });
    const raw = JSON.parse(await readFile(f.path, "utf8"));
    await writeFile(
      f.path,
      JSON.stringify({ ...raw, modified: "2020-01-01T00:00:00.000Z" }),
    );
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { saveChapter, writeJsonAtomically } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
    import { open } from 'node:fs/promises';
    const input = JSON.parse(process.env.DRELWICK_HISTORY_TEST_INPUT);
    await saveChapter(input, { writeChapter: async (path, value) => {
      if (process.env.DRELWICK_HISTORY_TEST_STAGE === 'temporary') {
        const file = await open(path + '.tmp', 'wx');
        await file.writeFile(JSON.stringify(value)); await file.sync(); await file.close();
      } else await writeJsonAtomically(path, value);
      process.exit(74);
    }});
  `,
      ],
      {
        env: {
          ...process.env,
          DRELWICK_HISTORY_TEST_INPUT: JSON.stringify({
            projectPath: f.projectPath,
            chapterId: f.chapterId,
            document: prose("B"),
            restore: f.restore,
          }),
          DRELWICK_HISTORY_TEST_STAGE: stage,
        },
        encoding: "utf8",
      },
    );
    expect(child.status).toBe(74);
    expect((await loadChapter(f)).content).toEqual(
      stage === "temporary" ? prose("B") : f.original.content,
    );
    await expect(
      saveChapter({
        projectPath: f.projectPath,
        chapterId: f.chapterId,
        document: prose("retry"),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_BUSY" });
    const entries = (await listHistorySnapshots(f.projectPath, f.chapterId))
      .entries;
    const safety = entries.find((entry) => entry.id !== f.old.id)!;
    expect(
      (await readHistorySnapshot(f.projectPath, f.chapterId, safety.id))
        .snapshot.content,
    ).toEqual(prose("B"));
    // Existing recovery deliberately does not steal stale chapter locks. Simulate
    // explicit inspection/release after this test's child is known to have exited.
    await rmdir(join(f.projectPath, ".chapter-create.lock"));
    const service = new RecoveryService();
    const { candidates } = await service.scanProject(f.projectPath);
    expect(candidates).toHaveLength(stage === "temporary" ? 1 : 0);
    if (candidates[0]) await service.recoverCandidate(candidates[0].id);
    expect((await loadChapter(f)).content).toEqual(f.original.content);
  },
);

const copies: FixtureCopy[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
const prose = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function setup() {
  const copy = await copyFixture("formatted-book");
  copies.push(copy);
  const session = await openProject(copy.projectPath);
  const chapterId = session.chapters[0]!.id;
  const input = { projectPath: copy.projectPath, chapterId };
  const original = await loadChapter(input);
  const old = (await createHistorySnapshot({
    ...input,
    document: original.content,
    reason: "before-replace",
  }))!;
  const selected = await readHistorySnapshot(
    input.projectPath,
    chapterId,
    old.id,
  );
  return {
    ...input,
    original,
    old,
    restore: { snapshotId: old.id, fingerprint: selected.fingerprint },
    path: join(input.projectPath, "manuscript", `${chapterId}.json`),
  };
}

it("lists validated metadata deterministically, previews without writes and preserves recovery decisions", async () => {
  const f = await setup();
  const before = await readFile(f.path);
  const candidates = await scanRecoveryCandidates(f.projectPath);
  const second = (await createHistorySnapshot({
    ...f,
    document: prose("second"),
    reason: "before-replace",
    now: f.old.created,
  }))!;
  const listed = await listHistorySnapshots(f.projectPath, f.chapterId);
  expect(listed.entries.map((entry) => entry.id)).toEqual(
    [f.old.id, second.id].sort(),
  );
  expect(
    listed.entries.every(
      (entry) =>
        entry.chapterId === f.chapterId && entry.created === f.old.created,
    ),
  ).toBe(true);
  expect(listed.entries.every((entry) => !("content" in entry))).toBe(true);
  expect(
    (await readHistorySnapshot(f.projectPath, f.chapterId, f.old.id)).snapshot
      .content,
  ).toEqual(f.original.content);
  expect(await readFile(f.path)).toEqual(before);
  expect((await scanRecoveryCandidates(f.projectPath)).candidates).toEqual(
    candidates.candidates,
  );
});

it("preserves current B before committing rich OLD, keeps identity/metadata, and survives reopen and repeated restore", async () => {
  const f = await setup();
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: f.chapterId,
    document: prose("B"),
  });
  const envelope = JSON.parse(await readFile(f.path, "utf8"));
  const write = vi.fn(async (path: string, value: unknown) => {
    const list = await listHistorySnapshots(f.projectPath, f.chapterId);
    expect(list.entries).toHaveLength(2);
    const safety = list.entries.find((entry) => entry.id !== f.old.id)!;
    expect(
      (await readHistorySnapshot(f.projectPath, f.chapterId, safety.id))
        .snapshot.content,
    ).toEqual(prose("B"));
    expect((await loadChapter(f)).content).toEqual(prose("B"));
    await writeJsonAtomically(path, value);
  });
  await saveChapter({ ...f, document: prose("B") }, { writeChapter: write });
  expect(write).toHaveBeenCalledOnce();
  expect((await loadChapter(f)).content).toEqual(f.original.content);
  expect(JSON.parse(await readFile(f.path, "utf8"))).toMatchObject({
    id: envelope.id,
    title: envelope.title,
    status: envelope.status,
  });
  expect((await openProject(f.projectPath)).project.manuscript.order).toContain(
    f.chapterId,
  );
  const list = await listHistorySnapshots(f.projectPath, f.chapterId);
  const b = list.entries.find((entry) => entry.id !== f.old.id)!;
  const preview = await readHistorySnapshot(f.projectPath, f.chapterId, b.id);
  await saveChapter({
    ...f,
    document: f.original.content,
    restore: { snapshotId: b.id, fingerprint: preview.fingerprint },
  });
  expect((await loadChapter(f)).content).toEqual(prose("B"));
  expect(
    (await listHistorySnapshots(f.projectPath, f.chapterId)).entries,
  ).toHaveLength(3);
  expect(
    (await readHistorySnapshot(f.projectPath, f.chapterId, f.old.id)).snapshot
      .content,
  ).toEqual(f.original.content);
});

it.each(["throw", "suppressed", "not-persisted", "wrong-content"])(
  "aborts restore if safety snapshot is %s",
  async (mode) => {
    const f = await setup();
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      document: prose("B"),
    });
    const before = await readFile(f.path);
    const writer = vi.fn();
    await expect(
      saveChapter(
        { ...f, document: prose("B") },
        {
          writeChapter: writer,
          snapshot: async (input) => {
            if (mode === "throw") throw new Error("private manuscript failure");
            if (mode === "suppressed") return null;
            if (mode === "not-persisted") return { ...f.old, id: createUuid() };
            return createHistorySnapshot({
              ...input,
              document: prose("wrong"),
            });
          },
        },
      ),
    ).rejects.toThrow();
    expect(writer).not.toHaveBeenCalled();
    expect(await readFile(f.path)).toEqual(before);
    await expect(openProject(f.projectPath)).resolves.toBeDefined();
  },
);

it("rejects stale current content, changed/pruned selection, wrong chapter and deleted chapter", async () => {
  const f = await setup();
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: f.chapterId,
    document: prose("B"),
  });
  await expect(
    saveChapter({ ...f, document: prose("stale") }),
  ).rejects.toMatchObject({ code: "HISTORY_CURRENT_CHANGED" });
  const snapshotPath = join(
    f.projectPath,
    ".history",
    "snapshots",
    f.chapterId,
    `${f.old.id}.json`,
  );
  await writeFile(
    snapshotPath,
    JSON.stringify({ ...f.old, content: prose("changed") }),
  );
  await expect(
    saveChapter({ ...f, document: prose("B") }),
  ).rejects.toMatchObject({ code: "HISTORY_UNAVAILABLE" });
  await expect(
    readHistorySnapshot(f.projectPath, createUuid(), f.old.id),
  ).rejects.toThrow();
  await unlink(snapshotPath);
  await expect(
    saveChapter({ ...f, document: prose("B") }),
  ).rejects.toMatchObject({ code: "HISTORY_UNAVAILABLE" });
  await writeFile(snapshotPath, JSON.stringify(f.old));
  await deleteChapter(f);
  expect(
    (await listHistorySnapshots(f.projectPath, f.chapterId)).entries,
  ).toHaveLength(1);
  await expect(
    saveChapter({ ...f, document: prose("B") }),
  ).rejects.toMatchObject({ code: "CHAPTER_NOT_FOUND" });
  expect(
    (await openProject(f.projectPath)).project.manuscript.order,
  ).not.toContain(f.chapterId);
});

it.each([
  "truncated",
  "version",
  "identity",
  "document",
  "filename",
  "timestamp",
])("omits %s snapshots without breaking valid history", async (kind) => {
  const f = await setup();
  const id = createUuid();
  const raw = { ...f.old, id };
  const invalid =
    kind === "truncated"
      ? "{"
      : JSON.stringify({
          ...raw,
          ...(kind === "version" ? { schemaVersion: 99 } : {}),
          ...(kind === "identity" ? { chapterId: createUuid() } : {}),
          ...(kind === "document" ? { content: { type: "script" } } : {}),
          ...(kind === "filename" ? { id: createUuid() } : {}),
          ...(kind === "timestamp" ? { created: "yesterday" } : {}),
        });
  await writeFile(
    join(f.projectPath, ".history", "snapshots", f.chapterId, `${id}.json`),
    invalid,
  );
  expect(await listHistorySnapshots(f.projectPath, f.chapterId)).toMatchObject({
    entries: [{ id: f.old.id }],
    unavailable: 1,
  });
  await expect(
    readHistorySnapshot(f.projectPath, f.chapterId, id),
  ).rejects.toMatchObject({ code: "HISTORY_UNAVAILABLE" });
});

it("retains new safety content while normal age/bucket pruning removes old entries", async () => {
  const f = await setup();
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: f.chapterId,
    document: prose("B"),
  });
  const expired = (await createHistorySnapshot({
    ...f,
    document: prose("expired"),
    reason: "before-replace",
    now: "2000-01-01T00:00:00.000Z",
  }))!;
  await saveChapter({ ...f, document: prose("B") });
  await applyHistoryRetention(f.projectPath);
  const entries = (await listHistorySnapshots(f.projectPath, f.chapterId))
    .entries;
  expect(entries).toHaveLength(2);
  expect(entries.some((entry) => entry.id === expired.id)).toBe(false);
  const safety = entries.find((entry) => entry.id !== f.old.id)!;
  expect(
    (await readHistorySnapshot(f.projectPath, f.chapterId, safety.id)).snapshot
      .content,
  ).toEqual(prose("B"));
});

it("failed atomic commit leaves B authoritative and its verified safety snapshot available", async () => {
  const f = await setup();
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: f.chapterId,
    document: prose("B"),
  });
  await expect(
    saveChapter(
      { ...f, document: prose("B") },
      {
        writeChapter: async () => {
          throw new Error("failure");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "CHAPTER_SAVE_FAILED" });
  expect((await loadChapter(f)).content).toEqual(prose("B"));
  const entries = (await listHistorySnapshots(f.projectPath, f.chapterId))
    .entries;
  expect(entries).toHaveLength(2);
  expect(
    (
      await readHistorySnapshot(
        f.projectPath,
        f.chapterId,
        entries.find((entry) => entry.id !== f.old.id)!.id,
      )
    ).snapshot.content,
  ).toEqual(prose("B"));
});

it.each([true, false])(
  "interrupted restore temporary complete=%s uses existing startup recovery and preserves B",
  async (complete) => {
    const f = await setup();
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      document: prose("B"),
    });
    await expect(
      saveChapter(
        { ...f, document: prose("B") },
        {
          writeChapter: async (path, value) => {
            const raw = value as Record<string, unknown>;
            await writeFile(
              `${path}.tmp`,
              complete
                ? JSON.stringify({
                    ...raw,
                    modified: "2099-01-01T00:00:00.000Z",
                  })
                : '{"content":',
            );
            throw new Error("interrupted before rename");
          },
        },
      ),
    ).rejects.toThrow();
    expect((await loadChapter(f)).content).toEqual(prose("B"));
    const scan = await scanRecoveryCandidates(f.projectPath);
    expect(scan.candidates).toHaveLength(complete ? 1 : 0);
    if (complete) {
      const recovery = new RecoveryService();
      const { candidates } = await recovery.scanProject(f.projectPath);
      await recovery.recoverCandidate(candidates[0]!.id);
      expect((await loadChapter(f)).content).toEqual(f.original.content);
    }
    const entries = (await listHistorySnapshots(f.projectPath, f.chapterId))
      .entries;
    const snapshots = await Promise.all(
      entries.map((entry) =>
        readHistorySnapshot(f.projectPath, f.chapterId, entry.id),
      ),
    );
    expect(
      snapshots.some(
        ({ snapshot }) =>
          JSON.stringify(snapshot.content) === JSON.stringify(prose("B")),
      ),
    ).toBe(true);
  },
);

it("restores shared and missing image references without copying or deleting assets", async () => {
  const { importImageAsset, readImageAsset } =
    await import("../src/image-assets.js");
  const { syntheticImage } =
    await import("../../../tests/helpers/synthetic-images.js");
  const f = await setup();
  const sourcePath = join(f.projectPath, "synthetic.png");
  const bytes = await syntheticImage();
  await writeFile(sourcePath, bytes);
  const asset = await importImageAsset({
    projectPath: f.projectPath,
    sourcePath,
  });
  const missing = createUuid();
  const rich = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Unicode ??? caf�",
            marks: [{ type: "bold" }, { type: "italic" }],
          },
        ],
      },
      {
        type: "image",
        attrs: { assetId: asset.id, alt: "Shared", size: "medium" },
      },
      {
        type: "image",
        attrs: { assetId: missing, alt: "Missing", size: "large" },
      },
    ],
  };
  const old = (await createHistorySnapshot({
    ...f,
    document: rich,
    reason: "before-replace",
  }))!;
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: f.chapterId,
    document: prose("B"),
  });
  const preview = await readHistorySnapshot(f.projectPath, f.chapterId, old.id);
  await saveChapter({
    ...f,
    document: prose("B"),
    restore: { snapshotId: old.id, fingerprint: preview.fingerprint },
  });
  expect((await loadChapter(f)).content).toEqual(rich);
  expect((await readImageAsset(f.projectPath, asset.id)).bytes).toEqual(bytes);
  await expect(readImageAsset(f.projectPath, missing)).rejects.toThrow();
});

it("restore advances modified time through clock skew without consuming the selected snapshot", async () => {
  const f = await setup();
  const future = (await createHistorySnapshot({
    ...f,
    document: prose("Future clock OLD"),
    reason: "manual",
    now: "2099-01-01T00:00:00.000Z",
  }))!;
  const selected = await readHistorySnapshot(
    f.projectPath,
    f.chapterId,
    future.id,
  );
  await saveChapter({
    ...f,
    document: f.original.content,
    restore: { snapshotId: future.id, fingerprint: selected.fingerprint },
  });
  expect(JSON.parse(await readFile(f.path, "utf8")).modified).toBe(
    future.created,
  );
  expect((await scanRecoveryCandidates(f.projectPath)).candidates).toEqual([]);
  expect(
    (await readHistorySnapshot(f.projectPath, f.chapterId, future.id)).snapshot,
  ).toEqual(future);
});
