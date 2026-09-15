import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuid } from "@bookeditor/shared";
import { ChapterSummaryCacheSchema } from "@bookeditor/project-model";
import {
  CHAPTER_SUMMARY_CACHE_FILE,
  createProject,
  openProject,
  writeJsonAtomically,
  type ProjectLoadingFileSystem,
} from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(chapterCount = 2) {
  const root = await mkdtemp(join(tmpdir(), "bookeditor-open-"));
  directories.push(root);
  const created = await createProject({
    projectPath: root,
    title: "Example",
    author: "Author",
    language: "en-GB",
  });
  const chapters = Array.from({ length: chapterCount }, (_, index) => ({
    schemaVersion: 1,
    id: createUuid(),
    type: "chapter",
    title: `Chapter ${index}`,
    status: "draft",
    created: created.project.created,
    modified: created.project.modified,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hel" },
            { type: "text", text: "lo world", marks: [{ type: "bold" }] },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Next" },
                { type: "hardBreak" },
                { type: "text", text: "line" },
              ],
            },
          ],
        },
      ],
    },
  }));
  const project = {
    ...created.project,
    manuscript: { order: chapters.map((chapter) => chapter.id).reverse() },
  };
  await writeJsonAtomically(join(root, "project.json"), project);
  for (const chapter of chapters)
    await writeJsonAtomically(
      join(root, "manuscript", `${chapter.id}.json`),
      chapter,
    );
  const fileSystem = {
    readFile: vi.fn((path: string, encoding: "utf8") =>
      readFile(path, encoding),
    ),
    lstat,
    realpath,
    writeJson: vi.fn(writeJsonAtomically),
  } satisfies ProjectLoadingFileSystem;
  return { root, project, book: created.book, chapters, fileSystem };
}

describe("existing project loading", () => {
  it("loads optional publication metadata and reports missing book.json", async () => {
    const { root, book } = await fixture(0);
    const metadata = {
      ...book,
      subtitle: "Subtitle",
      publisher: "Publisher",
      isbn: "Example ISBN",
      description: "Description",
      series: { name: "Series", number: 2 },
    };
    await writeJsonAtomically(join(root, "book.json"), metadata);
    expect((await openProject(root)).book).toEqual(metadata);
    await rm(join(root, "book.json"));
    await expect(openProject(root)).rejects.toMatchObject({
      code: "PROJECT_FILE_MISSING",
      message: "Missing required project file: book.json",
    });
  });

  it("counts empty and Unicode text without counting JSON attributes", async () => {
    const { root, chapters } = await fixture(1);
    const chapter = chapters[0];
    if (!chapter) throw new Error("Fixture chapter missing");
    const path = join(root, "manuscript", `${chapter.id}.json`);
    await writeJsonAtomically(path, { ...chapter, content: { type: "doc" } });
    expect((await openProject(root)).chapters[0]?.wordCount).toBe(0);
    await writeJsonAtomically(path, {
      ...chapter,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { note: "not counted" },
            content: [{ type: "text", text: "café\u00a0世界\nhello" }],
          },
        ],
      },
    });
    expect(
      (await openProject(root, { rebuildSummaries: true })).chapters[0]
        ?.wordCount,
    ).toBe(3);
  });

  it("opens a newly created empty project", async () => {
    const { root, project, book } = await fixture(0);
    expect(await openProject(root)).toEqual({
      projectPath: await realpath(root),
      project,
      book,
      chapters: [],
    });
  });

  it("loads metadata and ordered summaries; a warm open never reads chapter bodies", async () => {
    const { root, project, book, fileSystem } = await fixture();
    const opened = await openProject(root, {}, fileSystem);
    expect(opened.book).toEqual(book);
    expect(opened.project).toEqual(project);
    expect(opened.chapters.map((chapter) => chapter.id)).toEqual(
      project.manuscript.order,
    );
    expect(opened.chapters.map((chapter) => chapter.wordCount)).toEqual([4, 4]);
    expect(JSON.stringify(opened)).not.toContain('"content"');
    const persisted = ChapterSummaryCacheSchema.parse(
      JSON.parse(
        await readFile(join(root, CHAPTER_SUMMARY_CACHE_FILE), "utf8"),
      ),
    );
    expect(persisted.entries).toHaveLength(2);
    expect(JSON.stringify(persisted)).not.toContain("Hello world");
    fileSystem.readFile.mockClear();
    fileSystem.writeJson.mockClear();
    expect(await openProject(root, {}, fileSystem)).toEqual(opened);
    expect(fileSystem.readFile.mock.calls.map(([path]) => path)).toEqual([
      join(root, "project.json"),
      join(root, "book.json"),
      join(root, CHAPTER_SUMMARY_CACHE_FILE),
    ]);
    expect(fileSystem.writeJson).not.toHaveBeenCalled();
  });

  it("reports a missing manifest with a useful error", async () => {
    const { root } = await fixture();
    await rm(join(root, "project.json"));
    await expect(openProject(root)).rejects.toMatchObject({
      code: "PROJECT_FILE_MISSING",
      message: "Missing required project file: project.json",
    });
  });

  it.each(["project.json", "book.json", "chapter"])(
    "rejects malformed JSON in %s without leaking source text",
    async (file) => {
      const { root, project } = await fixture();
      const path =
        file === "chapter"
          ? `manuscript/${project.manuscript.order[0]}.json`
          : file;
      await writeFile(join(root, path), '{"secret manuscript excerpt', "utf8");
      const error: unknown = await openProject(root).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ code: "PROJECT_JSON_INVALID" });
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("secret manuscript excerpt");
    },
  );

  it.each(["project.json", "book.json", "chapter"])(
    "reports unsupported versions in %s",
    async (file) => {
      const { root, project } = await fixture();
      const path =
        file === "chapter"
          ? `manuscript/${project.manuscript.order[0]}.json`
          : file;
      await writeJsonAtomically(join(root, path), { schemaVersion: 2 });
      await expect(openProject(root)).rejects.toMatchObject({
        code: "PROJECT_SCHEMA_UNSUPPORTED",
      });
    },
  );

  it.each(["project.json", "book.json", "chapter"])(
    "rejects invalid schemas in %s",
    async (file) => {
      const { root, project } = await fixture();
      const path =
        file === "chapter"
          ? `manuscript/${project.manuscript.order[0]}.json`
          : file;
      await writeJsonAtomically(join(root, path), {
        schemaVersion: 1,
        manuscript: { order: [] },
      });
      await expect(openProject(root)).rejects.toMatchObject({
        code: "PROJECT_SCHEMA_INVALID",
      });
    },
  );

  it.each(["duplicate", "invalid UUID", "missing chapter"])(
    "rejects %s in manuscript order",
    async (kind) => {
      const { root, project } = await fixture();
      const id = project.manuscript.order[0];
      const order =
        kind === "duplicate"
          ? [id, id]
          : kind === "invalid UUID"
            ? ["../escape"]
            : [createUuid()];
      await writeJsonAtomically(join(root, "project.json"), {
        ...project,
        manuscript: { order },
      });
      await expect(openProject(root)).rejects.toMatchObject({
        code: "PROJECT_ORDER_INVALID",
      });
    },
  );

  it("rejects chapter IDs that disagree with filenames", async () => {
    const { root, project, chapters } = await fixture();
    await writeJsonAtomically(
      join(root, "manuscript", `${project.manuscript.order[0]}.json`),
      { ...chapters[0], id: createUuid() },
    );
    await expect(openProject(root)).rejects.toMatchObject({
      code: "PROJECT_ORDER_INVALID",
    });
  });

  it.each([
    "absent",
    "malformed",
    "unsupported",
    "wrong project",
    "invalid entries",
  ])("rebuilds a %s cache", async (kind) => {
    const { root, fileSystem } = await fixture();
    await openProject(root);
    const cachePath = join(root, CHAPTER_SUMMARY_CACHE_FILE);
    if (kind === "absent") await rm(cachePath);
    else if (kind === "malformed") await writeFile(cachePath, "{", "utf8");
    else {
      const cache = ChapterSummaryCacheSchema.parse(
        JSON.parse(await readFile(cachePath, "utf8")),
      );
      await writeJsonAtomically(cachePath, {
        ...cache,
        ...(kind === "unsupported"
          ? { schemaVersion: 99 }
          : kind === "wrong project"
            ? { projectId: createUuid() }
            : { entries: [{ summary: {} }] }),
      });
    }
    expect((await openProject(root, {}, fileSystem)).chapters).toHaveLength(2);
    expect(
      fileSystem.readFile.mock.calls.filter(([path]) =>
        path.includes(`${join("manuscript", "")}`),
      ),
    ).toHaveLength(2);
  });

  it("rebuilds only changed chapters, including same-size external edits", async () => {
    const { root, project, fileSystem } = await fixture();
    await openProject(root);
    const changed = join(
      root,
      "manuscript",
      `${project.manuscript.order[0]}.json`,
    );
    const source = await readFile(changed, "utf8");
    await writeFile(changed, source.replace("Chapter", "Updated"), "utf8");
    await utimes(changed, new Date(), new Date(Date.now() + 5000));
    const opened = await openProject(root, {}, fileSystem);
    expect(opened.chapters[0]?.title).toContain("Updated");
    expect(
      fileSystem.readFile.mock.calls.filter(([path]) =>
        path.includes("manuscript"),
      ),
    ).toEqual([[changed, "utf8"]]);
  });

  it("revalidates source on forced rebuilding and when cached chapters disappear", async () => {
    const { root, project, fileSystem } = await fixture();
    await openProject(root);
    await openProject(root, { rebuildSummaries: true }, fileSystem);
    expect(
      fileSystem.readFile.mock.calls.filter(([path]) =>
        path.includes("manuscript"),
      ),
    ).toHaveLength(2);
    await rm(join(root, "manuscript", `${project.manuscript.order[0]}.json`));
    await expect(openProject(root)).rejects.toMatchObject({
      code: "PROJECT_ORDER_INVALID",
    });
  });

  it("opens read-only projects when cache writes fail and preserves source files", async () => {
    const { root, project, fileSystem } = await fixture();
    const paths = [
      "project.json",
      "book.json",
      ...project.manuscript.order.map((id) => `manuscript/${id}.json`),
    ];
    const before = await Promise.all(
      paths.map((path) => readFile(join(root, path), "utf8")),
    );
    fileSystem.writeJson.mockRejectedValue(new Error("read-only"));
    expect((await openProject(root, {}, fileSystem)).chapters).toHaveLength(2);
    expect(
      await Promise.all(
        paths.map((path) => readFile(join(root, path), "utf8")),
      ),
    ).toEqual(before);
  });

  it("reports filesystem read errors without their raw payload", async () => {
    const { root, fileSystem } = await fixture();
    fileSystem.readFile.mockRejectedValue(new Error("private content"));
    await expect(openProject(root, {}, fileSystem)).rejects.toMatchObject({
      code: "PROJECT_FILE_READ_FAILED",
      message: "Unable to read project file: project.json",
    });
  });

  it("rejects relative roots and non-file chapter paths", async () => {
    await expect(openProject("relative/path")).rejects.toMatchObject({
      code: "PROJECT_PATH_INVALID",
    });
    const { root, project } = await fixture();
    const path = join(
      root,
      "manuscript",
      `${project.manuscript.order[0]}.json`,
    );
    await rm(path);
    await mkdir(path);
    await expect(openProject(root)).rejects.toMatchObject({
      code: "PROJECT_PATH_INVALID",
    });
  });

  it("rejects a manuscript directory symlink/junction", async () => {
    const { root } = await fixture(0);
    const other = await fixture(1);
    await rm(join(root, "manuscript"), { recursive: true });
    await symlink(
      join(other.root, "manuscript"),
      join(root, "manuscript"),
      "junction",
    );
    await writeJsonAtomically(join(root, "project.json"), other.project);
    await expect(openProject(root)).rejects.toMatchObject({
      code: "PROJECT_PATH_INVALID",
    });
  });

  it("detects a chapter changing during rebuilding", async () => {
    const { root, fileSystem } = await fixture();
    fileSystem.readFile.mockImplementation(async (path, encoding) => {
      const source = await readFile(path, encoding);
      if (path.includes("manuscript"))
        await utimes(path, new Date(), new Date(Date.now() + 10000));
      return source;
    });
    await expect(openProject(root, {}, fileSystem)).rejects.toMatchObject({
      code: "PROJECT_CHANGED_DURING_OPEN",
    });
    expect(fileSystem.writeJson).not.toHaveBeenCalled();
  });

  it("leaves unreferenced chapters untouched and uses manifest order after reorder", async () => {
    const { root, project } = await fixture();
    await openProject(root);
    const extra = join(root, "manuscript", `${createUuid()}.json`);
    await writeFile(extra, "recoverable orphan", "utf8");
    project.manuscript.order.reverse();
    await writeJsonAtomically(join(root, "project.json"), project);
    expect(
      (await openProject(root)).chapters.map((chapter) => chapter.id),
    ).toEqual(project.manuscript.order);
    expect(await readFile(extra, "utf8")).toBe("recoverable orphan");
  });
});
