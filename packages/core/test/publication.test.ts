import { join, dirname } from "node:path";
import {
  readFile,
  readdir,
  writeFile,
  open,
  unlink,
  mkdir,
} from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
import { createMatterPage, PublicationSchema } from "@drelwick/project-model";
import { renderBook } from "@drelwick/renderer";
import { createUuid } from "@drelwick/shared";
import { fixture as semanticFixture } from "../../renderer/test/fixture.js";
import {
  loadPublication,
  savePublication,
  replacePublicationCover,
  openProject,
  assembleBook,
  writeJsonAtomically,
  readImageAsset,
  createProjectArchive,
  restoreProjectArchive,
} from "../src/index.js";
const copies: FixtureCopy[] = [];

it("creates, edits, orders and changes matter types without loss; inclusion feeds the shared renderer", async () => {
  const f = await setup();
  const before = await chapterBytes(f.projectPath);
  let state = await loadPublication(f.projectPath, f.projectId);
  const data = structuredClone(state.data);
  data.metadata = {
    title: '<script>alert("title")</script>',
    author: "Tom & Jane",
    language: "en-GB",
    description: '5 < 10 & "quotes" 日本語',
    identifiers: [{ scheme: "isbn", value: "9781234567890" }],
  };
  data.pages = (
    ["title", "copyright", "dedication", "acknowledgements", "author"] as const
  ).map((type) => createMatterPage(type, createUuid(), data.metadata));
  const preserved = structuredClone(data.pages[2]!);
  data.pages[2]!.type = "copyright";
  data.pages[2]!.inclusion = { navigation: false, ebook: false, print: true };
  data.pages.reverse();
  data.body[0]!.inclusion = { navigation: true, ebook: true, print: false };
  state = await savePublication({
    ...f,
    expectedRevision: state.revision,
    data,
  });
  expect(
    state.data.pages.find((page) => page.id === preserved.id)?.document,
  ).toEqual(preserved.document);
  expect(await chapterBytes(f.projectPath)).toEqual(before);
  expect(await loadPublication(f.projectPath, f.projectId)).toEqual(state);
  const assembled = await assembleBook(f.projectPath);
  const expected = [
    ...data.pages
      .filter((page) => page.placement === "front")
      .map((page) => page.id),
    ...data.body.map((entry) => entry.id),
    ...data.pages
      .filter((page) => page.placement === "back")
      .map((page) => page.id),
  ];
  expect(assembled.book.chapters.map((chapter) => chapter.id)).toEqual(
    expected,
  );
  expect(assembled.book.metadata).toEqual(data.metadata);
  const ebook = renderBook(assembled.book, {
    target: "ebook",
    resolveAsset: () => undefined,
  });
  const print = renderBook(assembled.book, {
    target: "print",
    resolveAsset: () => undefined,
  });
  expect(ebook.chapters.some((chapter) => chapter.id === preserved.id)).toBe(
    false,
  );
  expect(print.chapters.some((chapter) => chapter.id === preserved.id)).toBe(
    true,
  );
  expect(
    print.chapters.some((chapter) => chapter.id === data.body[0]!.id),
  ).toBe(false);
  expect(
    ebook.chapters.find((chapter) => chapter.id === data.body[0]!.id)
      ?.publication?.inclusion.navigation,
  ).toBe(true);
  const title = ebook.chapters.find(
    (chapter) => chapter.publication?.kind === "title",
  )!;
  expect(title.xhtml).toContain("&lt;script&gt;");
  expect(title.xhtml).not.toContain("<script>");
  expect(title.publication?.inclusion.navigation).toBe(false);
  expect(
    (await loadPublication(f.projectPath, f.projectId)).data.pages,
  ).toHaveLength(5);
  const edited = structuredClone(state.data);
  edited.pages[0]!.document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Edited matter", marks: [{ type: "bold" }] },
        ],
      },
    ],
  };
  const final = await savePublication({
    ...f,
    expectedRevision: state.revision,
    data: edited,
  });
  expect(final.data.pages[0]!.id).toBe(state.data.pages[0]!.id);
  expect(final.data.pages[0]!.document).toEqual(edited.pages[0]!.document);
});

it("rejects stale writers, deletion-by-settings, invalid content and recovery evidence", async () => {
  const f = await setup();
  let state = await loadPublication(f.projectPath, f.projectId);
  state.data.pages.push(
    createMatterPage("title", createUuid(), state.data.metadata),
  );
  state = await savePublication({
    ...f,
    expectedRevision: state.revision,
    data: state.data,
  });
  const before = await readFile(join(f.projectPath, "publication.json"));
  await expect(
    savePublication({
      ...f,
      expectedRevision: "0".repeat(64),
      data: state.data,
    }),
  ).rejects.toMatchObject({ code: "PUBLICATION_CONFLICT" });
  await expect(
    savePublication({
      ...f,
      expectedRevision: state.revision,
      data: { ...state.data, pages: [] },
    }),
  ).rejects.toMatchObject({ code: "PUBLICATION_INVALID" });
  const invalid = structuredClone(state.data);
  invalid.pages[0]!.document = { type: "script", content: [] };
  expect(PublicationSchema.safeParse(invalid).success).toBe(false);
  await expect(
    savePublication({ ...f, expectedRevision: state.revision, data: invalid }),
  ).rejects.toMatchObject({ code: "PUBLICATION_INVALID" });
  await writeFile(
    join(f.projectPath, "publication.json.tmp"),
    "retained recovery",
  );
  await expect(
    loadPublication(f.projectPath, f.projectId),
  ).rejects.toMatchObject({ code: "PUBLICATION_RECOVERY_REQUIRED" });
  expect(await readFile(join(f.projectPath, "publication.json"))).toEqual(
    before,
  );
});

it("preserves publication and chapters when atomic rename fails", async () => {
  const f = await setup();
  const state = await loadPublication(f.projectPath, f.projectId);
  const before = await readFile(join(f.projectPath, "publication.json"));
  const chapters = await chapterBytes(f.projectPath);
  let attempted = false;
  await expect(
    savePublication(
      {
        ...f,
        expectedRevision: state.revision,
        data: {
          ...state.data,
          metadata: { ...state.data.metadata, title: "New" },
        },
      },
      {
        write: (path, value) =>
          writeJsonAtomically(path, value, {
            open,
            unlink,
            rename: async () => {
              attempted = true;
              throw new Error("Failed rename");
            },
          }),
      },
    ),
  ).rejects.toThrow();
  expect(attempted).toBe(true);
  expect(await readFile(join(f.projectPath, "publication.json"))).toEqual(
    before,
  );
  expect(await chapterBytes(f.projectPath)).toEqual(chapters);
});

it("imports/replaces a managed cover and preserves the source and previous selection on failure", async () => {
  const f = await setup();
  let state = await loadPublication(f.projectPath, f.projectId);
  const sourcePath = join(f.projectPath, "source.png");
  const source = await syntheticImage();
  await writeFile(sourcePath, source);
  state = await replacePublicationCover({
    ...f,
    expectedRevision: state.revision,
    sourcePath,
  });
  const previous = state.data.coverAssetId!;
  expect((await readImageAsset(f.projectPath, previous)).bytes).toEqual(source);
  expect(await readFile(sourcePath)).toEqual(source);
  await expect(
    replacePublicationCover(
      { ...f, expectedRevision: state.revision, sourcePath },
      {
        write: async () => {
          throw new Error("Failed reference commit");
        },
      },
    ),
  ).rejects.toThrow();
  expect(
    (await loadPublication(f.projectPath, f.projectId)).data.coverAssetId,
  ).toBe(previous);
  const bad = join(f.projectPath, "bad.png");
  await writeFile(bad, "<script>not an image</script>");
  await expect(
    replacePublicationCover({
      ...f,
      expectedRevision: state.revision,
      sourcePath: bad,
    }),
  ).rejects.toThrow();
  expect(
    (await loadPublication(f.projectPath, f.projectId)).data.coverAssetId,
  ).toBe(previous);
  state = await replacePublicationCover({
    ...f,
    expectedRevision: state.revision,
    sourcePath,
  });
  expect(state.data.coverAssetId).not.toBe(previous);
  expect((await readImageAsset(f.projectPath, previous)).bytes).toEqual(source);
  expect(await readFile(sourcePath)).toEqual(source);
  const assembled = await assembleBook(f.projectPath);
  const archivePath = join(dirname(f.projectPath), "publication.zip");
  const destinationParent = join(dirname(f.projectPath), "restored");
  await mkdir(destinationParent);
  await createProjectArchive({ projectPath: f.projectPath, archivePath });
  const restored = await restoreProjectArchive({
    archivePath,
    destinationParent,
  });
  expect(await loadPublication(restored.projectPath, f.projectId)).toEqual(
    state,
  );
  expect(
    (await readImageAsset(restored.projectPath, state.data.coverAssetId!))
      .bytes,
  ).toEqual(source);
  expect(await chapterBytes(restored.projectPath)).toEqual(
    await chapterBytes(f.projectPath),
  );
  const options = {
    resolveAsset: () => ({
      kind: "relative" as const,
      value: "images/cover.png",
    }),
  };
  expect(
    renderBook(assembled.book, { ...options, target: "ebook" }).chapters[0]!
      .publication?.kind,
  ).toBe("cover");
  expect(
    renderBook(assembled.book, { ...options, target: "print" }).chapters.some(
      (chapter) => chapter.publication?.kind === "cover",
    ),
  ).toBe(false);
});

it("preserves malformed, future and foreign publication components without repairing or overwriting them", async () => {
  const f = await setup();
  const state = await loadPublication(f.projectPath, f.projectId);
  for (const bytes of [
    "{",
    JSON.stringify({ ...state.data, schemaVersion: 2 }),
    JSON.stringify({ ...state.data, projectId: createUuid() }),
  ]) {
    const path = join(f.projectPath, "publication.json");
    await writeFile(path, bytes);
    await expect(
      loadPublication(f.projectPath, f.projectId),
    ).rejects.toMatchObject({ code: "PUBLICATION_INVALID" });
    await expect(assembleBook(f.projectPath)).rejects.toMatchObject({
      code: "PUBLICATION_INVALID",
    });
    expect(await readFile(path, "utf8")).toBe(bytes);
    await openProject(f.projectPath);
  }
});
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function setup() {
  const copy = await copyFixture("multi-chapter-book");
  copies.push(copy);
  const session = await openProject(copy.projectPath);
  return {
    projectPath: copy.projectPath,
    projectId: session.project.projectId,
  };
}
async function chapterBytes(root: string) {
  return Promise.all(
    (await readdir(join(root, "manuscript")))
      .sort()
      .map(async (file) => [
        file,
        (await readFile(join(root, "manuscript", file))).toString("base64"),
      ]),
  );
}

it("migrates v1 with verified snapshots and exact chapter identities/order/bytes", async () => {
  const f = await setup();
  const original = await openProject(f.projectPath);
  const chapterPath = join(
    f.projectPath,
    "manuscript",
    `${original.project.manuscript.order[0]}.json`,
  );
  const chapter = JSON.parse(await readFile(chapterPath, "utf8"));
  chapter.content = semanticFixture().chapters[0]!.document;
  await writeFile(chapterPath, JSON.stringify(chapter));
  const before = await chapterBytes(f.projectPath);
  const legacy = await readFile(join(f.projectPath, "book.json"));
  const order = (await openProject(f.projectPath)).project.manuscript.order;
  const state = await loadPublication(f.projectPath, f.projectId);
  expect((await openProject(f.projectPath)).project.schemaVersion).toBe(2);
  expect(state.data.body.map((entry) => entry.id)).toEqual(order);
  expect((await openProject(f.projectPath)).project.manuscript.order).toEqual(
    order,
  );
  expect(await chapterBytes(f.projectPath)).toEqual(before);
  expect(await readFile(join(f.projectPath, "book.json"))).toEqual(legacy);
  const backup = (
    await readdir(join(f.projectPath, ".drelwick-publication-migration"))
  ).find((name) => name.startsWith("backup-"))!;
  expect(
    await chapterBytes(
      join(f.projectPath, ".drelwick-publication-migration", backup),
    ),
  ).toEqual(before);
  expect(await loadPublication(f.projectPath, f.projectId)).toEqual(state);
});

it("keeps all eight inclusion combinations independent and coordinates with assembly", async () => {
  const f = await setup();
  let state = await loadPublication(f.projectPath, f.projectId);
  state.data.pages = Array.from({ length: 8 }, (_, bits) => ({
    ...createMatterPage("dedication", createUuid(), state.data.metadata),
    inclusion: {
      navigation: Boolean(bits & 1),
      ebook: Boolean(bits & 2),
      print: Boolean(bits & 4),
    },
  }));
  state = await savePublication({
    ...f,
    expectedRevision: state.revision,
    data: state.data,
  });
  let checked = false;
  const book = await assembleBook(f.projectPath, {
    checkpoint: async () => {
      if (checked) return;
      checked = true;
      await expect(
        savePublication({
          ...f,
          expectedRevision: state.revision,
          data: state.data,
        }),
      ).rejects.toMatchObject({ code: "PROJECT_BUSY" });
    },
  });
  for (const target of ["ebook", "print"] as const) {
    const output = renderBook(book.book, {
      target,
      resolveAsset: () => undefined,
    });
    expect(
      output.chapters
        .filter((chapter) => chapter.publication?.kind === "dedication")
        .map((chapter) => ({
          id: chapter.id,
          inclusion: chapter.publication!.inclusion,
        })),
    ).toEqual(
      state.data.pages
        .filter((page) => page.inclusion[target])
        .map((page) => ({ id: page.id, inclusion: page.inclusion })),
    );
  }
  expect((await loadPublication(f.projectPath, f.projectId)).data).toEqual(
    state.data,
  );
});
for (const boundary of [
  "after-backup",
  "before-commit",
  "after-commit",
] as const)
  it(`reopens interrupted additive migration at ${boundary}`, async () => {
    const f = await setup();
    const before = await chapterBytes(f.projectPath);
    await expect(
      loadPublication(f.projectPath, f.projectId, {
        checkpoint: async (point) => {
          if (point === boundary) throw new Error("Interrupted");
        },
      }),
    ).rejects.toThrow();
    expect(
      (await loadPublication(f.projectPath, f.projectId)).data.schemaVersion,
    ).toBe(1);
    expect(await chapterBytes(f.projectPath)).toEqual(before);
  });
