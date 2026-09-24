import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createChapter, createProject, loadChapter } from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("chapter loading", () => {
  it("loads the active chapter document without changing its JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "drelwick-load-"));
    directories.push(root);
    await createProject({
      projectPath: root,
      title: "Book",
      author: "Writer",
      language: "en-GB",
    });
    const created = await createChapter({
      projectPath: root,
      title: "Chapter",
    });
    const path = join(root, "manuscript", `${created.chapter.id}.json`);
    const before = await readFile(path, "utf8");
    const loaded = await loadChapter({
      projectPath: root,
      chapterId: created.chapter.id,
    });
    expect(loaded).toEqual({
      id: created.chapter.id,
      content: created.chapter.content,
    });
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("rejects chapters that are not in the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "drelwick-load-"));
    directories.push(root);
    await createProject({
      projectPath: root,
      title: "Book",
      author: "Writer",
      language: "en-GB",
    });
    await expect(
      loadChapter({
        projectPath: root,
        chapterId: "123e4567-e89b-42d3-a456-426614174001",
      }),
    ).rejects.toMatchObject({ code: "CHAPTER_NOT_FOUND" });
  });
});
