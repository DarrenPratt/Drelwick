import { afterEach, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  compareSnapshots,
  captureComparisonSource,
  type ComparisonInput,
} from "../src/index.js";
import {
  captureNamedSnapshot,
  listManuscriptSnapshots,
  migrateProjectToEditorialV3,
  openProjectForEditing,
  openProject,
  saveChapter,
} from "../src/index.js";
import { copyFixture } from "../../../tests/helpers/fixture-projects.js";
import { createUuid } from "@drelwick/shared";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const doc = (
  text: string,
  marks?: { type: string; attrs?: Record<string, unknown> }[],
) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: text
        ? [{ type: "text", text, ...(marks ? { marks } : {}) }]
        : [],
    },
  ],
});
function input(
  document: Record<string, unknown> = doc("red fox"),
): ComparisonInput {
  return {
    source: {
      kind: "snapshot",
      id: id(1),
      projectId: id(2),
      generation: 1,
      inventoryHash: "a".repeat(64),
      manifestHash: "b".repeat(64),
      label: "Synthetic",
      created: "2026-10-01T00:00:00.000Z",
      projection: "proposed",
    },
    chapters: [{ id: id(3), title: "Chapter", status: "draft", document }],
    assets: {},
    metadata: {},
  };
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

it("C01 identical versions yield no changes; repeated text ties delete before insertion deterministically", async () => {
  const a = input(doc("aba")),
    b = input(doc("baa"));
  expect((await compareSnapshots(a, structuredClone(a))).changes).toEqual([]);
  const diff = await compareSnapshots(a, b);
  expect(diff.complete).toBe(true);
  expect(
    diff.changes.map((c) => [
      c.kind,
      c.oldLocation?.from,
      c.oldLocation?.to,
      c.newLocation?.from,
      c.newLocation?.to,
    ]),
  ).toEqual([
    ["text-delete", 1, 2, 1, 1],
    ["text-insert", 4, 4, 3, 4],
  ]);
  expect(await compareSnapshots(a, b)).toEqual(diff);
  expect(diff.changes[0]!.before).toEqual({
    type: "slice",
    value: { content: [{ type: "text", text: "a" }], openStart: 0, openEnd: 0 },
  });
});

it("C01 formatting-only changes retain prose; heading/list/link attributes and all supported marks are visible", async () => {
  const marks = ["bold", "italic", "strike", "underline", "code"];
  for (const type of marks) {
    const diff = await compareSnapshots(
      input(),
      input(doc("red fox", [{ type }])),
    );
    expect(diff.changes.map((c) => c.kind)).toEqual(["mark-change"]);
    expect(diff.changes[0]!.oldLocation).toEqual({
      nodePath: [0, 0],
      from: 1,
      to: 8,
    });
    expect(JSON.stringify(diff.changes[0]!.after)).toContain(type);
  }
  const ordered = input(doc("red fox", [{ type: "bold" }, { type: "italic" }]));
  const reordered = input(
    doc("red fox", [{ type: "italic" }, { type: "bold" }]),
  );
  const sameMarks = await compareSnapshots(ordered, reordered);
  expect(sameMarks.complete).toBe(true);
  expect(sameMarks.changes).toEqual([]);
  const link = (href: string) =>
    input(doc("red fox", [{ type: "link", attrs: { href } }]));
  expect(
    (
      await compareSnapshots(
        link("https://example.org/old"),
        link("https://example.org/new"),
      )
    ).changes.map((c) => c.kind),
  ).toEqual(["mark-change"]);
  const heading = (level: number) =>
    input({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level },
          content: [{ type: "text", text: "red fox" }],
        },
      ],
    });
  expect(
    (await compareSnapshots(heading(1), heading(2))).changes.map((c) => c.kind),
  ).toEqual(["attribute-change"]);
  const list = (start: number) => ({
    ...input(),
    chapters: [
      {
        ...input().chapters[0]!,
        document: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              attrs: { start },
              content: [{ type: "listItem", content: doc("red fox").content }],
            },
          ],
        },
      },
    ],
  });
  expect(
    (await compareSnapshots(list(1), list(7))).changes.map((c) => c.kind),
  ).toEqual(["attribute-change"]);
});

it("C01 grapheme positions preserve joined emoji and combining sequences across marked runs without normalization", async () => {
  const a = input(doc("A👩‍💻e\u0301Z")),
    b = input(doc("A👩‍🚀éZ"));
  const diff = await compareSnapshots(a, b);
  expect(
    diff.changes.map((c) => [
      c.kind,
      c.oldLocation?.from,
      c.oldLocation?.to,
      c.newLocation?.from,
      c.newLocation?.to,
    ]),
  ).toEqual([["text-replace", 2, 9, 2, 8]]);
  const split = input();
  split.chapters[0]!.document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "e" },
          { type: "text", text: "\u0301", marks: [{ type: "bold" }] },
        ],
      },
    ],
  };
  const marked = await compareSnapshots(input(doc("e\u0301")), split);
  expect(
    marked.changes.map((c) => [c.kind, c.oldLocation?.from, c.oldLocation?.to]),
  ).toEqual([["mark-change", 1, 3]]);
});

it("C01 retains scene breaks, hard breaks, images and structural formatting, and compares asset bytes", async () => {
  const a = input(),
    b = input();
  a.chapters[0]!.document = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "line" }] }],
  };
  b.chapters[0]!.document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "line" }, { type: "hardBreak" }],
      },
      { type: "sceneBreak" },
      {
        type: "image",
        attrs: { assetId: id(8), alt: "Picture", size: "medium" },
      },
    ],
  };
  b.assets[id(8)] = "c".repeat(64);
  const diff = await compareSnapshots(a, b);
  expect(diff.changes.map((c) => c.kind)).toEqual([
    "node-change",
    "node-change",
    "asset-change",
  ]);
  expect(JSON.stringify(diff.changes)).toContain("sceneBreak");
  expect(JSON.stringify(diff.changes)).toContain("hardBreak");
  const c = structuredClone(b);
  c.assets[id(8)] = "d".repeat(64);
  expect(
    (await compareSnapshots(b, c)).changes.map((change) => change.kind),
  ).toEqual(["asset-change"]);
  c.chapters[0]!.document = {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: { assetId: id(8), alt: "Changed", size: "large" },
      },
    ],
  };
  expect(
    (await compareSnapshots(b, c)).changes.some(
      (change) => change.kind === "asset-change",
    ),
  ).toBe(true);
});

it("C01 aligns chapter UUIDs, orders additions/removals/survivors, and reports moves alongside content/title/status", async () => {
  const a = input();
  a.chapters = [3, 4, 5].map((n) => ({
    ...a.chapters[0]!,
    id: id(n),
    title: "Same title",
  }));
  const b = structuredClone(a);
  b.chapters = [
    b.chapters[2]!,
    { ...b.chapters[0]!, id: id(6) },
    b.chapters[0]!,
  ];
  b.chapters[0] = {
    ...b.chapters[0]!,
    title: "Renamed",
    status: "final",
    document: doc("red dog"),
  };
  const diff = await compareSnapshots(a, b);
  expect(diff.changes.slice(0, 2).map((c) => [c.kind, c.chapterId])).toEqual([
    ["chapter-added", id(6)],
    ["chapter-removed", id(4)],
  ]);
  expect(
    diff.changes.filter((c) => c.chapterId === id(5)).map((c) => c.kind),
  ).toEqual([
    "chapter-moved",
    "title",
    "status",
    "text-replace",
    "text-replace",
  ]);
  expect(diff.changes.map((c) => c.ordinal)).toEqual(
    diff.changes.map((_, i) => i),
  );
});

it("C02 missing assets and invalid documents never claim equality; limits retain completed chapters with fixed diagnostics", async () => {
  const a = input(),
    b = input();
  a.assets[id(8)] = null;
  b.assets[id(8)] = null;
  const unavailable = await compareSnapshots(a, b);
  expect(unavailable.complete).toBe(false);
  expect(unavailable.diagnostics).toEqual(
    ["left", "right"].map((source) => ({
      source,
      chapterId: null,
      assetId: id(8),
      code: "MISSING_ASSET",
    })),
  );
  const c = input();
  c.chapters[0]!.document = { type: "doc", content: [{ type: "unsupported" }] };
  expect((await compareSnapshots(input(), c)).diagnostics[0]!.code).toBe(
    "INVALID_SOURCE",
  );
  const d = input(doc("blue fox"));
  d.chapters.push({
    ...d.chapters[0]!,
    id: id(4),
    document: doc("very long ".repeat(100)),
  });
  const e = input();
  e.chapters.push({ ...e.chapters[0]!, id: id(4) });
  const limited = await compareSnapshots(e, d, { limits: { tokens: 100 } });
  expect(limited.complete).toBe(false);
  expect(limited.changes[0]!.chapterId).toBe(id(3));
  expect(limited.diagnostics).toContainEqual({
    source: "right",
    chapterId: id(4),
    assetId: null,
    code: "LIMIT",
  });
  expect(
    (
      await compareSnapshots(
        input(doc("a".repeat(1000))),
        input(doc("b".repeat(1000))),
        { limits: { expansions: 10 } },
      )
    ).complete,
  ).toBe(false);
});

it("C02 cooperatively cancels real token/diff work and rejects revoked authorization", async () => {
  const controller = new AbortController();
  const work = compareSnapshots(
    input(doc("a".repeat(100_000))),
    input(doc("b".repeat(100_000))),
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 10);
  await expect(work).rejects.toMatchObject({ code: "COMPARISON_CANCELLED" });
  await expect(
    compareSnapshots(input(), input(), { authorized: () => false }),
  ).rejects.toMatchObject({ code: "COMPARISON_CANCELLED" });
});

async function inventory(
  root: string,
  prefix = "",
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await inventory(root, path));
    else
      result[path] = createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex");
  }
  return result;
}
it("C01/C02 captures immutable saved-current and snapshot projections with zero source byte changes", async () => {
  const f = await copyFixture("multi-chapter-book");
  cleanups.push(f.cleanup);
  await openProjectForEditing(f.projectPath);
  await migrateProjectToEditorialV3(f.projectPath);
  const session = await openProject(f.projectPath),
    projectId = session.project.projectId;
  const snapshot = await captureNamedSnapshot({
    projectPath: f.projectPath,
    projectId,
    operationId: createUuid(),
    label: "Baseline",
    expected: (await listManuscriptSnapshots(f.projectPath, projectId)).source,
  });
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: session.project.manuscript.order[0]!,
    document: doc("Current 👩‍💻"),
  });
  const before = await inventory(f.projectPath);
  const left = await captureComparisonSource(f.projectPath, projectId, {
    kind: "snapshot",
    ...snapshot,
    projection: "accepted",
  });
  const right = await captureComparisonSource(f.projectPath, projectId, {
    kind: "captured-current",
    projection: "proposed",
  });
  expect(right.source.kind).toBe("captured-current");
  expect(left.source.label).toBe("Baseline");
  expect((await compareSnapshots(left, right)).changes.length).toBeGreaterThan(
    0,
  );
  expect(await inventory(f.projectPath)).toEqual(before);
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: session.project.manuscript.order[0]!,
    document: doc("Later"),
  });
  expect(JSON.stringify(right.chapters)).toContain("Current 👩‍💻");
  const selected = join(
    f.projectPath,
    "snapshots/manuscript",
    snapshot.snapshotId,
    "files/project.json",
  );
  const saved = await readFile(selected);
  await writeFile(selected, JSON.stringify({ schemaVersion: 999 }));
  await expect(
    captureComparisonSource(f.projectPath, projectId, {
      kind: "snapshot",
      ...snapshot,
      projection: "proposed",
    }),
  ).rejects.toThrow();
  expect(await readFile(selected, "utf8")).toBe(
    JSON.stringify({ schemaVersion: 999 }),
  );
  await writeFile(selected, saved);
  const manifestPath = join(
    f.projectPath,
    "snapshots/manuscript",
    snapshot.snapshotId,
    "snapshot.json",
  );
  const originalManifest = await readFile(manifestPath);
  const unsupported = Buffer.from(
    JSON.stringify({
      ...JSON.parse(originalManifest.toString()),
      schemaVersion: 999,
    }),
  );
  await writeFile(manifestPath, unsupported);
  await expect(
    captureComparisonSource(f.projectPath, projectId, {
      kind: "snapshot",
      snapshotId: snapshot.snapshotId,
      manifestHash: createHash("sha256").update(unsupported).digest("hex"),
      projection: "accepted",
    }),
  ).rejects.toMatchObject({ code: "COMPARISON_UNSUPPORTED_VERSION" });
  expect(await readFile(manifestPath)).toEqual(unsupported);
  await writeFile(manifestPath, originalManifest);
  await rm(
    join(
      f.projectPath,
      "snapshots/manuscript",
      snapshot.snapshotId,
      "files/book.json",
    ),
  );
  await expect(
    captureComparisonSource(f.projectPath, projectId, {
      kind: "snapshot",
      ...snapshot,
      projection: "proposed",
    }),
  ).rejects.toThrow();
});

it("C02 locates a missing immutable snapshot image and preserves unsupported pending review bytes", async () => {
  const f = await copyFixture("public-example");
  cleanups.push(f.cleanup);
  await openProjectForEditing(f.projectPath);
  await migrateProjectToEditorialV3(f.projectPath);
  const session = await openProject(f.projectPath),
    projectId = session.project.projectId;
  const snapshot = await captureNamedSnapshot({
    projectPath: f.projectPath,
    projectId,
    operationId: createUuid(),
    label: "With image",
    expected: (await listManuscriptSnapshots(f.projectPath, projectId)).source,
  });
  const directory = join(
    f.projectPath,
    "snapshots/manuscript",
    snapshot.snapshotId,
  );
  const manifest = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  ) as { files: { path: string }[] };
  const image = manifest.files.find((file) =>
    /original\.(png|jpg)$/.test(file.path),
  )!;
  await rm(join(directory, "files", image.path));
  await expect(
    captureComparisonSource(f.projectPath, projectId, {
      kind: "snapshot",
      ...snapshot,
      projection: "proposed",
    }),
  ).rejects.toMatchObject({
    component: `managed image ${image.path.split("/")[2]}`,
  });
  const chapterPath = join(
    f.projectPath,
    "manuscript",
    `${session.chapters[0]!.id}.json`,
  );
  const chapter = JSON.parse(await readFile(chapterPath, "utf8"));
  chapter.review.schemaVersion = 999;
  const pending = JSON.stringify(chapter);
  await writeFile(chapterPath, pending);
  await expect(
    captureComparisonSource(f.projectPath, projectId, {
      kind: "captured-current",
      projection: "accepted",
    }),
  ).rejects.toThrow();
  expect(await readFile(chapterPath, "utf8")).toBe(pending);
});

it("C02 benchmarks a representative 300,000-word novel with deterministic sparse semantic edits", async () => {
  const a = input();
  a.chapters = Array.from({ length: 60 }, (_, chapter) => ({
    id: id(chapter + 100),
    title: `Chapter ${chapter + 1}`,
    status: "draft",
    document: {
      type: "doc",
      content: Array.from({ length: 50 }, (_, paragraph) => ({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 100 },
              (_, word) => `word${(chapter + paragraph + word) % 97}`,
            ).join(" "),
          },
        ],
      })),
    },
  }));
  const b = structuredClone(a);
  b.chapters[30]!.document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Inserted 👩‍💻 paragraph",
            marks: [{ type: "bold" }],
          },
        ],
      },
      ...(a.chapters[30]!.document["content"] as Record<string, unknown>[]),
    ],
  };
  const start = performance.now(),
    diff = await compareSnapshots(a, b),
    elapsed = performance.now() - start;
  expect(diff.complete).toBe(true);
  expect(diff.changes.every((c) => c.chapterId === id(130))).toBe(true);
  expect(diff.changes.length).toBeGreaterThan(0);
  process.stdout.write(
    `Synthetic 300000-word semantic comparison: ${Math.round(elapsed)}ms; changes=${diff.changes.length}\n`,
  );
}, 60_000);
