import { mkdir, mkdtemp, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAPTER_TRASH_DIRECTORY,
  CHAPTER_CREATION_LOCK,
  createChapter,
  createProject,
  deleteChapter,
  openProject,
} from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "drelwick-delete-"));
  directories.push(root);
  await createProject({
    projectPath: root,
    title: "Book",
    author: "Writer",
    language: "en-GB",
  });
  const created = await createChapter({ projectPath: root, title: "Original" });
  return { root, chapter: created.chapter };
}

describe("chapter deletion", () => {
  it("preserves an existing operation lock and project bytes until its owner releases it", async () => {
    const { root, chapter } = await fixture();
    const lock = join(root, CHAPTER_CREATION_LOCK);
    const manifestPath = join(root, "project.json");
    const chapterPath = join(root, "manuscript", `${chapter.id}.json`);
    const manifestBefore = await readFile(manifestPath);
    const chapterBefore = await readFile(chapterPath);
    await mkdir(lock);

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        deleteChapter({ projectPath: root, chapterId: chapter.id }),
      ).rejects.toMatchObject({ code: "PROJECT_BUSY" });
      expect(await readdir(lock)).toEqual([]);
      expect(await readFile(manifestPath)).toEqual(manifestBefore);
      expect(await readFile(chapterPath)).toEqual(chapterBefore);
      expect(await readdir(join(root, ".history"))).not.toContain("deleted");
    }

    await rmdir(lock);
    const deleted = await deleteChapter({
      projectPath: root,
      chapterId: chapter.id,
    });
    expect(await readFile(deleted.trashPath)).toEqual(chapterBefore);
    expect(deleted.session.chapters).toEqual([]);
    expect(await readdir(root)).not.toContain(CHAPTER_CREATION_LOCK);
  });

  it("allows successive deletions into the existing trash directory", async () => {
    const { root, chapter } = await fixture();
    const second = await createChapter({ projectPath: root, title: "Second" });
    for (const id of [chapter.id, second.chapter.id]) {
      const before = await readFile(join(root, "manuscript", `${id}.json`));
      const deleted = await deleteChapter({ projectPath: root, chapterId: id });
      expect(await readFile(deleted.trashPath)).toEqual(before);
      expect(await readdir(root)).not.toContain(CHAPTER_CREATION_LOCK);
    }
    expect((await openProject(root)).chapters).toEqual([]);
    expect(await readdir(join(root, CHAPTER_TRASH_DIRECTORY))).toHaveLength(2);
  });

  it("removes the chapter from order and retains its recoverable copy", async () => {
    const { root, chapter } = await fixture();
    const deleted = await deleteChapter({
      projectPath: root,
      chapterId: chapter.id,
    });
    expect(deleted.session.chapters).toEqual([]);
    expect((await openProject(root)).chapters).toEqual([]);
    expect(await readFile(deleted.trashPath, "utf8")).toContain(chapter.id);
    expect(await readdir(join(root, CHAPTER_TRASH_DIRECTORY))).toHaveLength(1);
  });

  it("restores the chapter when manifest persistence fails", async () => {
    const { root, chapter } = await fixture();
    const chapterPath = join(root, "manuscript", `${chapter.id}.json`);
    const before = await readFile(chapterPath, "utf8");
    await expect(
      deleteChapter(
        { projectPath: root, chapterId: chapter.id },
        {
          writeManifest: async () => {
            throw new Error("private filesystem details");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "CHAPTER_DELETE_FAILED",
      message: expect.not.stringContaining("private filesystem details"),
    });
    expect(await readFile(chapterPath, "utf8")).toBe(before);
    expect((await openProject(root)).chapters[0]?.id).toBe(chapter.id);
  });

  it("rejects an unknown chapter without changing the project", async () => {
    const { root } = await fixture();
    await expect(
      deleteChapter({
        projectPath: root,
        chapterId: "123e4567-e89b-42d3-a456-426614174001",
      }),
    ).rejects.toMatchObject({ code: "CHAPTER_NOT_FOUND" });
    expect((await openProject(root)).chapters).toHaveLength(1);
  });
});
