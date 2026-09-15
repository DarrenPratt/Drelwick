import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAPTER_TRASH_DIRECTORY,
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
  const root = await mkdtemp(join(tmpdir(), "bookeditor-delete-"));
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
