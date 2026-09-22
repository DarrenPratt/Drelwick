import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createChapter,
  createProject,
  openProject,
  renameChapter,
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
  const root = await mkdtemp(join(tmpdir(), "sarel-rename-"));
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

describe("chapter rename", () => {
  it("changes only the title, preserves the UUID and content, and survives reopening", async () => {
    const { root, chapter } = await fixture();
    const path = join(root, "manuscript", `${chapter.id}.json`);
    const before = JSON.parse(await readFile(path, "utf8"));
    const renamed = await renameChapter({
      projectPath: root,
      chapterId: chapter.id,
      title: "  Renamed  ",
    });

    expect(renamed.chapter.id).toBe(chapter.id);
    expect(renamed.chapter.title).toBe("Renamed");
    expect(renamed.chapter.content).toEqual(before.content);
    expect((await openProject(root)).chapters[0]?.title).toBe("Renamed");
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      id: chapter.id,
      title: "Renamed",
      content: before.content,
    });
  });

  it("rejects empty titles without changing the chapter", async () => {
    const { root, chapter } = await fixture();
    await expect(
      renameChapter({
        projectPath: root,
        chapterId: chapter.id,
        title: " \t ",
      }),
    ).rejects.toMatchObject({ code: "CHAPTER_INPUT_INVALID" });
    expect((await openProject(root)).chapters[0]?.title).toBe("Original");
  });

  it("preserves the previous chapter when the write fails", async () => {
    const { root, chapter } = await fixture();
    const path = join(root, "manuscript", `${chapter.id}.json`);
    const before = await readFile(path, "utf8");
    await expect(
      renameChapter(
        { projectPath: root, chapterId: chapter.id, title: "Renamed" },
        {
          writeChapter: async () => {
            throw new Error("private filesystem details");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "CHAPTER_RENAME_FAILED",
      message: expect.not.stringContaining("private filesystem details"),
    });
    expect(await readFile(path, "utf8")).toBe(before);
  });
});
