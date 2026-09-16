import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  rmdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CHAPTER_CREATION_LOCK,
  createChapter,
  createProject,
  loadChapter,
  openProject,
  saveChapter,
  writeJsonAtomically,
} from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bookeditor-save-"));
  directories.push(root);
  await createProject({
    projectPath: root,
    title: "Book",
    author: "Author",
    language: "en-GB",
  });
  const { chapter } = await createChapter({
    projectPath: root,
    title: "Chapter",
  });
  const path = join(root, "manuscript", `${chapter.id}.json`);
  return {
    root,
    chapter,
    path,
    input: { projectPath: root, chapterId: chapter.id, document },
  };
}
const document = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Bold and italic",
          marks: [{ type: "bold" }, { type: "italic" }],
        },
        { type: "hardBreak" },
        { type: "text", text: "Next line" },
      ],
    },
    { type: "sceneBreak" },
    {
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Quotation" }] },
      ],
    },
  ],
};

it("atomically round trips formatting and preserves chapter metadata and manifest", async () => {
  const { root, chapter, path, input } = await fixture();
  await writeJsonAtomically(path, { ...chapter, extra: { preserved: true } });
  const manifest = await readFile(join(root, "project.json"), "utf8");
  const writeChapter = vi.fn(writeJsonAtomically);
  const saved = await saveChapter(input, { writeChapter });
  expect(writeChapter).toHaveBeenCalledOnce();
  expect(saved.id).toBe(chapter.id);
  const reloaded = await loadChapter({
    projectPath: root,
    chapterId: chapter.id,
  });
  expect(reloaded.content).toEqual(document);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    ...chapter,
    extra: { preserved: true },
    content: document,
    modified: saved.modified,
  });
  expect(await readFile(join(root, "project.json"), "utf8")).toBe(manifest);
  expect((await openProject(root)).chapters[0]?.wordCount).toBe(6);
  await expect(lstat(`${path}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  { type: "doc", content: [{ type: "text", text: "outside paragraph" }] },
  {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "paragraph" }] }],
  },
  { type: "doc", content: [{ type: "unknown" }] },
  {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "", marks: [{ type: "bold" }] }],
      },
    ],
  },
  {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "text", marks: [{ type: "unknown" }] }],
      },
    ],
  },
  {
    type: "doc",
    content: [
      { type: "sceneBreak", content: [{ type: "text", text: "decoration" }] },
    ],
  },
])("rejects malformed documents without changing files", async (invalid) => {
  const { path, input } = await fixture();
  const before = await readFile(path, "utf8");
  await expect(
    saveChapter({ ...input, document: invalid }),
  ).rejects.toMatchObject({ code: "CHAPTER_DOCUMENT_INVALID" });
  expect(await readFile(path, "utf8")).toBe(before);
  const chapter = JSON.parse(before) as Record<string, unknown>;
  await writeJsonAtomically(path, { ...chapter, content: invalid });
  await expect(loadChapter(input)).rejects.toMatchObject({
    code: "CHAPTER_DOCUMENT_INVALID",
  });
});

it("preserves the previous file on an atomic replacement failure and allows retry", async () => {
  const { path, input } = await fixture();
  const before = await readFile(path, "utf8");
  const { open, unlink } = await import("node:fs/promises");
  await expect(
    saveChapter(input, {
      writeChapter: (path, value) =>
        writeJsonAtomically(path, value, {
          open,
          unlink,
          rename: async () => {
            throw new Error("private filesystem details");
          },
        }),
    }),
  ).rejects.toMatchObject({
    code: "CHAPTER_SAVE_FAILED",
    message:
      "Unable to save the chapter. The previous chapter file was preserved.",
  });
  expect(await readFile(path, "utf8")).toBe(before);
  await saveChapter(input);
  expect((await loadChapter(input)).content).toEqual(document);
});

it("rejects nonmember chapters, traversal and competing chapter operations", async () => {
  const { root, input } = await fixture();
  for (const chapterId of ["123e4567-e89b-42d3-a456-426614174001", "../book"]) {
    await expect(saveChapter({ ...input, chapterId })).rejects.toMatchObject({
      code: "CHAPTER_NOT_FOUND",
    });
  }
  await mkdir(join(root, CHAPTER_CREATION_LOCK));
  await expect(saveChapter(input)).rejects.toMatchObject({
    code: "PROJECT_BUSY",
  });
  await rmdir(join(root, CHAPTER_CREATION_LOCK));
});

it("preserves recoverable temporary files", async () => {
  const { path, input } = await fixture();
  const before = await readFile(path, "utf8");
  await writeFile(`${path}.tmp`, "recoverable work");
  await expect(saveChapter(input)).rejects.toMatchObject({
    code: "CHAPTER_RECOVERY_REQUIRED",
  });
  expect(await readFile(path, "utf8")).toBe(before);
  expect(await readFile(`${path}.tmp`, "utf8")).toBe("recoverable work");
});

it("rejects a linked manuscript directory without touching its contents", async () => {
  const { root, path, input } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "bookeditor-outside-"));
  directories.push(outside);
  const before = await readFile(path, "utf8");
  await writeFile(join(outside, `${input.chapterId}.json`), before);
  await rm(join(root, "manuscript"), { recursive: true });
  await symlink(outside, join(root, "manuscript"), "junction");
  await expect(saveChapter(input)).rejects.toMatchObject({
    code: "PROJECT_PATH_INVALID",
  });
  expect(await readFile(join(outside, `${input.chapterId}.json`), "utf8")).toBe(
    before,
  );
});

it("reports a lock cleanup warning after commit without reporting a failed save", async () => {
  const { input } = await fixture();
  const saved = await saveChapter(input, {
    releaseLock: async () => {
      throw new Error("failure");
    },
  });
  expect(saved.warning).toContain("chapter was saved");
  expect((await loadChapter(input)).content).toEqual(document);
});
