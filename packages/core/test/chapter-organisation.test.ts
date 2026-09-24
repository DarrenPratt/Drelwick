import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import {
  ChapterStatusSchema,
  type ChapterOrganisationRequest,
} from "@drelwick/shared";
import {
  createChapter,
  createProject,
  createHistorySnapshot,
  scanRecoveryCandidates,
  loadChapter,
  openProject,
  openProjectForEditing,
  organiseChapter,
  saveChapter,
} from "../src/index.js";
import {
  splitChapterDocument,
  mergeChapterDocuments,
} from "../src/chapter-semantics.js";
import {
  importImageAsset,
  readImageAsset,
  findImageReferences,
} from "../src/image-assets.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const assetId = "00000000-0000-4000-8000-000000000999";
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [
    { type: "text", text, marks: [{ type: "bold" }, { type: "italic" }] },
  ],
});
const rich = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Heading" }],
    },
    paragraph("The quick brown fox café 🌙"),
    { type: "sceneBreak" },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("List text")] }],
    },
    { type: "blockquote", content: [paragraph("Quoted text")] },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Link",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    },
    { type: "image", attrs: { assetId, alt: "Unicode 月", size: "medium" } },
  ],
};
const text = (node: unknown): string => {
  if (typeof node !== "object" || node === null) return "";
  const value = node as { text?: string; content?: unknown[] };
  return value.text ?? value.content?.map(text).join("") ?? "";
};
async function fixture() {
  const projectPath = await mkdtemp(join(tmpdir(), "drelwick-organise-"));
  roots.push(projectPath);
  const project = await createProject({
    projectPath,
    title: "Book",
    author: "Author",
    language: "en",
  });
  const ids: string[] = [];
  for (const title of ["A", "B", "C"]) {
    const { chapter } = await createChapter({ projectPath, title });
    ids.push(chapter.id);
    await saveChapter({ projectPath, chapterId: chapter.id, document: rich });
  }
  return {
    projectPath,
    projectId: project.project.projectId,
    expectedOrder: ids,
  };
}
async function envelope(root: string, id: string) {
  return JSON.parse(
    await readFile(join(root, "manuscript", `${id}.json`), "utf8"),
  );
}
async function originals(input: Awaited<ReturnType<typeof fixture>>) {
  return Promise.all(
    input.expectedOrder.map((id) => envelope(input.projectPath, id)),
  );
}

it("duplicates rich semantic content with a fresh identity, adjacent order and persistent metadata", async () => {
  const input = await fixture();
  const id = input.expectedOrder[0]!;
  const source = {
    ...(await envelope(input.projectPath, id)),
    status: "review",
    extension: { note: "retained" },
  };
  await writeFile(
    join(input.projectPath, "manuscript", `${id}.json`),
    JSON.stringify(source),
  );
  const { chapterId, session } = await organiseChapter({
    ...input,
    operation: "duplicate",
    chapterId: id,
  });
  expect(chapterId).not.toBe(id);
  expect(session.project.manuscript.order).toEqual([
    id,
    chapterId,
    ...input.expectedOrder.slice(1),
  ]);
  expect(await envelope(input.projectPath, id)).toEqual(source);
  expect(await envelope(input.projectPath, chapterId)).toMatchObject({
    id: chapterId,
    title: "A Copy",
    status: "review",
    content: rich,
    extension: source.extension,
  });
  expect(
    (await openProjectForEditing(input.projectPath)).project.manuscript.order,
  ).toEqual(session.project.manuscript.order);
  expect(new Set(session.chapters.map((chapter) => chapter.id)).size).toBe(4);
});

it.each([9, 10, 20, 35, 37, 42, 55])(
  "splits at semantic position %i conserving every text character and marks",
  (position) => {
    const [first, second] = splitChapterDocument(rich, position);
    expect(text(first) + text(second)).toBe(text(rich));
    expect(text(mergeChapterDocuments(first, second))).toBe(text(rich));
    expect(JSON.stringify([first, second])).toContain(assetId);
  },
);
it("splits formatted runs exactly and keeps marks on both halves", () => {
  const input = { type: "doc", content: [paragraph("brown fox")] };
  expect(splitChapterDocument(input, 7)).toEqual([
    { type: "doc", content: [paragraph("brown ")] },
    { type: "doc", content: [paragraph("fox")] },
  ]);
});

it("splits around scene breaks without duplicating atoms or paragraphs", () => {
  const before = paragraph("One");
  const after = paragraph("Two");
  const scene = { type: "sceneBreak" };
  const document = { type: "doc", content: [before, scene, after] };
  expect(splitChapterDocument(document, 5)).toEqual([
    { type: "doc", content: [before] },
    { type: "doc", content: [scene, after] },
  ]);
  expect(splitChapterDocument(document, 6)).toEqual([
    { type: "doc", content: [before, scene] },
    { type: "doc", content: [after] },
  ]);
});

it.each(["blockquote", "bulletList", "orderedList", "epigraph"])(
  "retains valid %s wrappers and attributes inside formatted text",
  (type) => {
    const wrap = (value: string) =>
      type === "bulletList" || type === "orderedList"
        ? {
            type,
            ...(type === "orderedList" ? { attrs: { start: 3 } } : {}),
            content: [{ type: "listItem", content: [paragraph(value)] }],
          }
        : {
            type,
            ...(type === "epigraph"
              ? { attrs: { attribution: "Author" } }
              : {}),
            content: [paragraph(value)],
          };
    const position = type === "bulletList" || type === "orderedList" ? 5 : 4;
    expect(
      splitChapterDocument({ type: "doc", content: [wrap("ABCD")] }, position),
    ).toEqual([
      { type: "doc", content: [wrap("AB")] },
      { type: "doc", content: [wrap("CD")] },
    ]);
  },
);

it("conserves marks, text and asset/scene atoms at every accepted rich-document position", () => {
  function tokens(value: unknown): string[] {
    const node = value as {
      type: string;
      text?: string;
      marks?: unknown;
      attrs?: unknown;
      content?: unknown[];
    };
    if (node.text)
      return Array.from(node.text).map((character) =>
        JSON.stringify([character, node.marks ?? []]),
      );
    if (
      ["image", "sceneBreak", "horizontalRule", "hardBreak"].includes(node.type)
    )
      return [JSON.stringify(node)];
    return (node.content ?? []).flatMap(tokens);
  }
  let accepted = 0;
  for (let position = 0; position < 160; position++) {
    let parts: ReturnType<typeof splitChapterDocument>;
    try {
      parts = splitChapterDocument(rich, position);
    } catch {
      continue;
    }
    expect(parts.flatMap(tokens)).toEqual(tokens(rich));
    accepted++;
  }
  expect(accepted).toBeGreaterThan(50);
});
it.each([0, 1, 10, 11, -1, 1.2, 999])(
  "rejects empty/start/end/out-of-range position %i",
  (position) => {
    expect(() =>
      splitChapterDocument(
        { type: "doc", content: [paragraph("brown fox")] },
        position,
      ),
    ).toThrow();
  },
);
it("rejects empty documents and surrogate/grapheme splits", () => {
  expect(() =>
    splitChapterDocument({ type: "doc", content: [{ type: "paragraph" }] }, 1),
  ).toThrow();
  expect(() =>
    splitChapterDocument({ type: "doc", content: [paragraph("A🌙B")] }, 3),
  ).toThrow();
  expect(() =>
    splitChapterDocument({ type: "doc", content: [paragraph("AéB")] }, 3),
  ).toThrow();
  expect(() =>
    splitChapterDocument(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Ae" },
              { type: "text", text: "́B", marks: [{ type: "italic" }] },
            ],
          },
        ],
      },
      3,
    ),
  ).toThrow();
});

it("shares real image originals through duplicate, split and merge without copying or deleting assets", async () => {
  const input = await fixture();
  const id = input.expectedOrder[0]!;
  const sourcePath = join(input.projectPath, "source.png");
  const bytes = await syntheticImage();
  await writeFile(sourcePath, bytes);
  const asset = await importImageAsset({
    projectPath: input.projectPath,
    sourcePath,
  });
  const image = {
    type: "image",
    attrs: { assetId: asset.id, alt: "月", size: "medium" },
  };
  const document = {
    type: "doc",
    content: [image, paragraph("Left Right"), image],
  };
  for (const chapterId of input.expectedOrder)
    await saveChapter({
      projectPath: input.projectPath,
      chapterId,
      document,
    });
  const duplicate = await organiseChapter({
    ...input,
    operation: "duplicate",
    chapterId: id,
  });
  const split = await organiseChapter({
    ...input,
    expectedOrder: duplicate.session.project.manuscript.order,
    operation: "split",
    chapterId: id,
    expectedContent: document,
    position: 7,
  });
  const merged = await organiseChapter({
    ...input,
    expectedOrder: split.session.project.manuscript.order,
    operation: "merge",
    chapterIds: [split.chapterId, id],
    confirmed: true,
  });
  expect((await readImageAsset(input.projectPath, asset.id)).bytes).toEqual(
    bytes,
  );
  expect(await readdir(join(input.projectPath, "assets", "images"))).toEqual([
    asset.id,
  ]);
  expect(
    JSON.stringify(await findImageReferences(input.projectPath)),
  ).toContain(asset.id);
  const jpeg = await syntheticImage("jpeg");
  const jpegPath = join(input.projectPath, "source.jpg");
  await writeFile(jpegPath, jpeg);
  const otherAsset = await importImageAsset({
    projectPath: input.projectPath,
    sourcePath: jpegPath,
  });
  const secondId = input.expectedOrder[1]!;
  await saveChapter({
    projectPath: input.projectPath,
    chapterId: secondId,
    document: {
      type: "doc",
      content: [
        { type: "image", attrs: { ...image.attrs, assetId: otherAsset.id } },
      ],
    },
  });
  await organiseChapter({
    ...input,
    expectedOrder: merged.session.project.manuscript.order,
    operation: "merge",
    chapterIds: [secondId, duplicate.chapterId],
    confirmed: true,
  });
  const references = (await findImageReferences(input.projectPath))
    .filter((reference) => reference.chapterId === duplicate.chapterId)
    .map((reference) => reference.assetId);
  expect(references).toEqual([asset.id, asset.id, otherAsset.id]);
  expect(
    (await readImageAsset(input.projectPath, otherAsset.id)).bytes,
  ).toEqual(jpeg);
  expect((await readImageAsset(input.projectPath, asset.id)).bytes).toEqual(
    bytes,
  );
  expect(
    await readdir(join(input.projectPath, "assets", "images")),
  ).toHaveLength(2);
  for (const reference of await findImageReferences(input.projectPath))
    expect(
      (await readImageAsset(input.projectPath, reference.assetId)).bytes.length,
    ).toBeGreaterThan(0);
});
it("splits then reopens, retaining identity, status, order, snapshots and exact semantics", async () => {
  const input = await fixture();
  const id = input.expectedOrder[0]!;
  const before = await envelope(input.projectPath, id);
  const parts = splitChapterDocument(rich, 20);
  const result = await organiseChapter({
    ...input,
    operation: "split",
    chapterId: id,
    expectedContent: rich,
    position: 20,
  });
  const opened = await openProjectForEditing(input.projectPath);
  expect(opened.project.manuscript.order).toEqual([
    id,
    result.chapterId,
    ...input.expectedOrder.slice(1),
  ]);
  expect(await envelope(input.projectPath, id)).toMatchObject({
    id,
    title: "A",
    status: before.status,
    content: parts[0],
  });
  expect(await envelope(input.projectPath, result.chapterId)).toMatchObject({
    id: result.chapterId,
    title: "A Continued",
    status: before.status,
    content: parts[1],
  });
  const history = join(input.projectPath, ".history", "snapshots", id);
  const snapshot = JSON.parse(
    await readFile(join(history, (await readdir(history))[0]!), "utf8"),
  );
  expect(snapshot).toMatchObject({
    reason: "before-restructure",
    chapterId: id,
    content: rich,
  });
});
it("merges reversed explicit selection in canonical order with first identity/title/status", async () => {
  const input = await fixture();
  const [a, b, c] = input.expectedOrder as [string, string, string];
  const second = {
    type: "doc",
    content: [paragraph("Second chapter"), rich.content.at(-1)!],
  };
  await saveChapter({
    projectPath: input.projectPath,
    chapterId: b,
    document: second,
  });
  const result = await organiseChapter({
    ...input,
    operation: "merge",
    chapterIds: [b, a],
    confirmed: true,
  });
  expect(result.chapterId).toBe(a);
  expect(result.session.project.manuscript.order).toEqual([a, c]);
  expect(await envelope(input.projectPath, a)).toMatchObject({
    title: "A",
    status: "draft",
    content: mergeChapterDocuments(rich, second),
  });
  await expect(envelope(input.projectPath, b)).rejects.toThrow();
  await openProjectForEditing(input.projectPath);
  expect(
    text(
      (await loadChapter({ projectPath: input.projectPath, chapterId: a }))
        .content,
    ),
  ).toBe(text(rich) + text(second));
  expect(
    await readdir(join(input.projectPath, ".history", "snapshots", b)),
  ).toHaveLength(1);
});
it("rejects nonadjacent, repeated, unconfirmed, stale order and stale cursor requests without mutation", async () => {
  const input = await fixture();
  const [a, b, c] = input.expectedOrder as [string, string, string];
  const before = await originals(input);
  for (const command of [
    { operation: "merge", chapterIds: [a, c], confirmed: true },
    { operation: "merge", chapterIds: [a, a], confirmed: true },
    { operation: "merge", chapterIds: [a, b], confirmed: false },
    {
      operation: "split",
      chapterId: a,
      position: 20,
      expectedContent: { type: "doc" },
    },
    { operation: "duplicate", chapterId: a, expectedOrder: [b, a, c] },
  ])
    await expect(
      organiseChapter({ ...input, ...command } as ChapterOrganisationRequest & {
        projectPath: string;
      }),
    ).rejects.toThrow();
  expect(await originals(input)).toEqual(before);
  expect(
    (await openProject(input.projectPath)).project.manuscript.order,
  ).toEqual(input.expectedOrder);
});
it("persists every canonical status across reopen without changing content, identity or order", async () => {
  const input = await fixture();
  const id = input.expectedOrder[0]!;
  for (const status of ChapterStatusSchema.options) {
    await organiseChapter({
      ...input,
      operation: "status",
      chapterId: id,
      status,
    });
    const reopened = await openProjectForEditing(input.projectPath);
    expect(reopened.chapters[0]!.status).toBe(status);
    expect(reopened.project.manuscript.order).toEqual(input.expectedOrder);
    expect(await envelope(input.projectPath, id)).toMatchObject({
      id,
      content: rich,
    });
  }
  await expect(
    organiseChapter({
      ...input,
      operation: "status",
      chapterId: id,
      status: "invented",
    } as unknown as ChapterOrganisationRequest & { projectPath: string }),
  ).rejects.toThrow();
});
it.each(["duplicate", "split", "merge"] as const)(
  "rolls back %s when all chapter writes succeed but manifest write fails",
  async (operation) => {
    const input = await fixture();
    const before = await originals(input);
    const [a, b] = input.expectedOrder as [string, string];
    const command: ChapterOrganisationRequest =
      operation === "merge"
        ? { ...input, operation, chapterIds: [b, a], confirmed: true }
        : operation === "split"
          ? {
              ...input,
              operation,
              chapterId: a,
              expectedContent: rich,
              position: 20,
            }
          : { ...input, operation, chapterId: a };
    let reached = false;
    await expect(
      organiseChapter(
        { ...command, projectPath: input.projectPath },
        {
          writeManifest: async () => {
            reached = true;
            const changed = await envelope(input.projectPath, a);
            if (operation === "split")
              expect(changed.content).toEqual(
                splitChapterDocument(rich, 20)[0],
              );
            if (operation === "merge") {
              expect(changed.content).toEqual(
                mergeChapterDocuments(rich, rich),
              );
              await expect(envelope(input.projectPath, b)).rejects.toThrow();
            }
            throw new Error("Injected manifest write failure");
          },
        },
      ),
    ).rejects.toMatchObject({ code: "CHAPTER_OPERATION_FAILED" });
    expect(reached).toBe(true);
    await openProjectForEditing(input.projectPath);
    expect(await originals(input)).toEqual(before);
    expect(
      (await openProject(input.projectPath)).project.manuscript.order,
    ).toEqual(input.expectedOrder);
    expect(
      (await readdir(join(input.projectPath, "manuscript"))).filter((name) =>
        name.endsWith(".json"),
      ),
    ).toHaveLength(3);
  },
);
it.each(["split", "merge"] as const)(
  "cancellation/snapshot failure preserves %s originals",
  async (operation) => {
    const input = await fixture();
    const [a, b] = input.expectedOrder as [string, string];
    const before = await originals(input);
    const command: ChapterOrganisationRequest =
      operation === "merge"
        ? { ...input, operation, chapterIds: [a, b], confirmed: true }
        : {
            ...input,
            operation,
            chapterId: a,
            expectedContent: rich,
            position: 20,
          };
    for (const hooks of [
      { cancelled: () => true },
      {
        snapshot: async () => {
          throw new Error("snapshot failure");
        },
      },
    ]) {
      await expect(
        organiseChapter({ ...command, projectPath: input.projectPath }, hooks),
      ).rejects.toThrow();
      expect(await originals(input)).toEqual(before);
    }
  },
);
it.each(["split", "merge", "duplicate"] as const)(
  "recovers interrupted %s before manifest publication on restart",
  async (operation) => {
    const input = await fixture();
    const [a, b] = input.expectedOrder as [string, string];
    const before = await originals(input);
    const command =
      operation === "merge"
        ? { ...input, operation, chapterIds: [a, b], confirmed: true }
        : operation === "split"
          ? {
              ...input,
              operation,
              chapterId: a,
              position: 20,
              expectedContent: rich,
            }
          : { ...input, operation, chapterId: a };
    const script = `import { organiseChapter } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)}; await organiseChapter(JSON.parse(process.argv[1]), { beforeWrite: async index => { if(index === ${operation === "duplicate" ? 1 : 2}) process.exit(73); } });`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, JSON.stringify(command)],
      { stdio: "ignore", windowsHide: true },
    );
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    expect(code).toBe(73);
    await expect(openProject(input.projectPath)).rejects.toThrow();
    await openProjectForEditing(input.projectPath);
    expect(await originals(input)).toEqual(before);
    expect(
      (await openProject(input.projectPath)).project.manuscript.order,
    ).toEqual(input.expectedOrder);
  },
);

it.each(["split", "merge", "duplicate"] as const)(
  "rolls back %s after manifest publication but before completion",
  async (operation) => {
    const input = await fixture();
    const [a, b] = input.expectedOrder as [string, string];
    const before = await originals(input);
    const command =
      operation === "merge"
        ? { ...input, operation, chapterIds: [a, b], confirmed: true }
        : operation === "split"
          ? {
              ...input,
              operation,
              chapterId: a,
              position: 20,
              expectedContent: rich,
            }
          : { ...input, operation, chapterId: a };
    const script = `import { organiseChapter } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)}; await organiseChapter(JSON.parse(process.argv[1]), { afterWrite: async index => { if(index === ${operation === "duplicate" ? 1 : 2}) process.exit(73); } });`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, JSON.stringify(command)],
      { stdio: "ignore", windowsHide: true },
    );
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    expect(code).toBe(73);
    expect(
      JSON.parse(
        await readFile(join(input.projectPath, "project.json"), "utf8"),
      ).manuscript.order,
    ).not.toEqual(input.expectedOrder);
    await openProjectForEditing(input.projectPath);
    expect(await originals(input)).toEqual(before);
    expect(
      (await openProject(input.projectPath)).project.manuscript.order,
    ).toEqual(input.expectedOrder);
  },
);

it.each(["split", "merge"] as const)(
  "rolls back in-flight cancellation of %s after writes start",
  async (operation) => {
    const input = await fixture();
    const [a, b] = input.expectedOrder as [string, string];
    const before = await originals(input);
    const command: ChapterOrganisationRequest =
      operation === "merge"
        ? { ...input, operation, chapterIds: [a, b], confirmed: true }
        : {
            ...input,
            operation,
            chapterId: a,
            position: 20,
            expectedContent: rich,
          };
    let cancelled = false;
    await expect(
      organiseChapter(
        { ...command, projectPath: input.projectPath },
        {
          cancelled: () => cancelled,
          afterWrite: async (index) => {
            if (index === 1) cancelled = true;
          },
        },
      ),
    ).rejects.toThrow();
    expect(await originals(input)).toEqual(before);
    expect(
      (await openProject(input.projectPath)).project.manuscript.order,
    ).toEqual(input.expectedOrder);
  },
);

it("retains a conflicting external revision and fails closed during structural rollback", async () => {
  const input = await fixture();
  const id = input.expectedOrder[0]!;
  await expect(
    organiseChapter(
      {
        ...input,
        operation: "split",
        chapterId: id,
        position: 20,
        expectedContent: rich,
      },
      {
        afterWrite: async (index) => {
          if (index !== 0) return;
          const changed = await envelope(input.projectPath, id);
          await writeFile(
            join(input.projectPath, "manuscript", id + ".json"),
            JSON.stringify({
              ...changed,
              content: { type: "doc", content: [paragraph("External work")] },
            }),
          );
          throw new Error("Interrupt");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "CHAPTER_RECOVERY_REQUIRED" });
  expect(text((await envelope(input.projectPath, id)).content)).toBe(
    "External work",
  );
  await expect(openProjectForEditing(input.projectPath)).rejects.toThrow();
  expect(
    JSON.parse(
      await readFile(
        join(input.projectPath, ".manuscript-replace.json"),
        "utf8",
      ),
    ).phase,
  ).toBe("pending");
});

it("preserves manifest extension metadata and refuses an existing recovery temporary", async () => {
  const input = await fixture();
  const id = input.expectedOrder[0]!;
  const manifestPath = join(input.projectPath, "project.json");
  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  raw.extension = { value: 7 };
  raw.manuscript.extension = "retained";
  await writeFile(manifestPath, JSON.stringify(raw));
  await writeFile(
    join(input.projectPath, "manuscript", id + ".json.tmp"),
    "Retained recovery data",
  );
  await expect(
    organiseChapter({ ...input, operation: "duplicate", chapterId: id }),
  ).rejects.toThrow();
  expect(
    await readFile(
      join(input.projectPath, "manuscript", id + ".json.tmp"),
      "utf8",
    ),
  ).toBe("Retained recovery data");
  await rm(join(input.projectPath, "manuscript", id + ".json.tmp"));
  await organiseChapter({ ...input, operation: "duplicate", chapterId: id });
  expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
    extension: raw.extension,
    manuscript: { extension: "retained" },
  });
});

it.each([".json", ".json.tmp"])(
  "refuses UUID collision with a retained orphan %s",
  async (suffix) => {
    const input = await fixture();
    const id = input.expectedOrder[0]!;
    const collision = "00000000-0000-4000-8000-000000000777";
    const path = join(input.projectPath, "manuscript", collision + suffix);
    await writeFile(path, "Retained recovery content");
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(collision);
    await expect(
      organiseChapter({ ...input, operation: "duplicate", chapterId: id }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("Retained recovery content");
    expect(
      (await openProject(input.projectPath)).project.manuscript.order,
    ).toEqual(input.expectedOrder);
  },
);

it("never reuses an existing chapter ID and refuses pending manifest recovery", async () => {
  const input = await fixture();
  const id = input.expectedOrder[0]!;
  const before = await originals(input);
  const random = vi
    .spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValue(id as ReturnType<typeof crypto.randomUUID>);
  await expect(
    organiseChapter({
      ...input,
      operation: "split",
      chapterId: id,
      expectedContent: rich,
      position: 20,
    }),
  ).rejects.toThrow();
  random.mockRestore();
  await writeFile(
    join(input.projectPath, "project.json.tmp"),
    "Retained manifest",
  );
  await expect(
    organiseChapter({ ...input, operation: "duplicate", chapterId: id }),
  ).rejects.toThrow();
  expect(await originals(input)).toEqual(before);
  expect(
    await readFile(join(input.projectPath, "project.json.tmp"), "utf8"),
  ).toBe("Retained manifest");
});

it("forces every pre-restructure snapshot and excludes it from newer-content recovery", async () => {
  const input = await fixture();
  const chapterId = input.expectedOrder[0]!;
  for (let index = 0; index < 2; index++)
    expect(
      await createHistorySnapshot({
        projectPath: input.projectPath,
        chapterId,
        document: rich,
        reason: "before-restructure",
        now: "2030-01-01T00:00:00.000Z",
      }),
    ).not.toBeNull();
  expect((await scanRecoveryCandidates(input.projectPath)).candidates).toEqual(
    [],
  );
  expect(
    await readdir(join(input.projectPath, ".history", "snapshots", chapterId)),
  ).toHaveLength(2);
});
