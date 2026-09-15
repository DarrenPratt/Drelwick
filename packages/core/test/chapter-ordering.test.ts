import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createChapter,
  createProject,
  openProject,
  reorderChapters,
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
  const root = await mkdtemp(join(tmpdir(), "bookeditor-order-"));
  directories.push(root);
  await createProject({
    projectPath: root,
    title: "Book",
    author: "Writer",
    language: "en-GB",
  });
  const first = await createChapter({ projectPath: root, title: "First" });
  const second = await createChapter({ projectPath: root, title: "Second" });
  return { root, first: first.chapter, second: second.chapter };
}

describe("chapter ordering", () => {
  it("reorders manifest IDs without changing chapter file bytes or order after reopening", async () => {
    const { root, first, second } = await fixture();
    const firstPath = join(root, "manuscript", `${first.id}.json`);
    const secondPath = join(root, "manuscript", `${second.id}.json`);
    const firstBefore = await readFile(firstPath, "utf8");
    const secondBefore = await readFile(secondPath, "utf8");

    const reordered = await reorderChapters({
      projectPath: root,
      chapterIds: [second.id, first.id],
    });

    expect(reordered.session.chapters.map(({ id }) => id)).toEqual([
      second.id,
      first.id,
    ]);
    expect((await openProject(root)).chapters.map(({ id }) => id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(await readFile(firstPath, "utf8")).toBe(firstBefore);
    expect(await readFile(secondPath, "utf8")).toBe(secondBefore);
  });

  it.each([
    ["duplicate", ["first", "first"]],
    ["unknown", ["first", "unknown"]],
    ["missing", ["first"]],
  ])("rejects %s IDs without changing the existing order", async (_, ids) => {
    const { root, first, second } = await fixture();
    const chapterIds = ids.map((id) => (id === "first" ? first.id : id));
    await expect(
      reorderChapters({ projectPath: root, chapterIds }),
    ).rejects.toMatchObject({ code: "PROJECT_ORDER_INVALID" });
    expect((await openProject(root)).chapters.map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("preserves the previous order when manifest persistence fails", async () => {
    const { root, first, second } = await fixture();
    await expect(
      reorderChapters(
        { projectPath: root, chapterIds: [second.id, first.id] },
        {
          writeManifest: async () => {
            throw new Error("private filesystem details");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "CHAPTER_REORDER_FAILED",
      message: expect.not.stringContaining("private filesystem details"),
    });
    expect((await openProject(root)).chapters.map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
  });
});
