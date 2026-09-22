import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  mkdir,
  open,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ChapterFileSchema, ProjectConfigSchema } from "@sarel/project-model";
import {
  CHAPTER_CREATION_LOCK,
  createChapter,
  createProject,
  openProject,
  writeJsonAtomically,
} from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sarel-chapter-"));
  directories.push(root);
  await createProject({
    projectPath: root,
    title: "Book",
    author: "Writer",
    language: "en-GB",
  });
  return root;
}
const input = (projectPath: string, title = "Beginning") => ({
  projectPath,
  title,
});

it.each([".json", ".json.tmp"])(
  "never overwrites or deletes an existing UUID%s file",
  async (suffix) => {
    const root = await fixture();
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const path = join(root, "manuscript", `${id}${suffix}`);
    await writeFile(path, "preserve recoverable file");
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(id);
    await expect(createChapter(input(root))).rejects.toMatchObject({
      code: "CHAPTER_CREATE_FAILED",
    });
    expect(await readFile(path, "utf8")).toBe("preserve recoverable file");
    expect((await openProject(root)).project.manuscript.order).toEqual([]);
  },
);

it("retains the previous valid manifest when replacement rename fails", async () => {
  const root = await fixture();
  const manifestPath = join(root, "project.json");
  const before = await readFile(manifestPath, "utf8");
  await expect(
    createChapter(input(root), {
      writeManifest: (path, project) =>
        writeJsonAtomically(path, project, {
          open,
          rename: async () => {
            throw new Error("rename failed: private details");
          },
          unlink,
        }),
    }),
  ).rejects.toMatchObject({
    code: "CHAPTER_CREATE_FAILED",
    message: expect.not.stringContaining("private details"),
  });
  expect(await readFile(manifestPath, "utf8")).toBe(before);
  expect(await readdir(root)).not.toContain("project.json.tmp");
  expect((await openProject(root)).chapters).toEqual([]);
  expect(await readdir(join(root, "manuscript"))).toHaveLength(1);
});

it("returns and rebuilds new summaries even when the optional cache cannot be written", async () => {
  const root = await fixture();
  const created = await createChapter(input(root), {
    writeJson: async () => {
      throw new Error("cache unavailable");
    },
  });
  expect(created.session.chapters).toHaveLength(1);
  expect((await openProject(root)).chapters).toEqual(created.session.chapters);
});

it("creates valid UUID chapters with defaults, appends order and returns summaries that survive reopening", async () => {
  const root = await fixture();
  const originalBook = await readFile(join(root, "book.json"), "utf8");
  const first = await createChapter(input(root, "  Beginning  "));
  const firstFile = await readFile(
    join(root, "manuscript", `${first.chapter.id}.json`),
    "utf8",
  );
  expect(ChapterFileSchema.parse(JSON.parse(firstFile))).toEqual(first.chapter);
  expect(first.chapter).toMatchObject({
    type: "chapter",
    status: "draft",
    title: "Beginning",
    schemaVersion: 1,
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  expect(first.chapter.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(first.chapter.created).toBe(first.chapter.modified);
  const second = await createChapter(input(root, "Next"));
  expect(second.session.project.manuscript.order).toEqual([
    first.chapter.id,
    second.chapter.id,
  ]);
  expect(second.chapter.id).not.toBe(first.chapter.id);
  expect(
    second.session.chapters.map(({ id, wordCount }) => ({ id, wordCount })),
  ).toEqual([
    { id: first.chapter.id, wordCount: 0 },
    { id: second.chapter.id, wordCount: 0 },
  ]);
  expect(second.session.chapters[0]).not.toHaveProperty("content");
  expect((await openProject(root)).chapters).toEqual(second.session.chapters);
  expect(await readFile(join(root, "book.json"), "utf8")).toBe(originalBook);
  expect(
    await readFile(
      join(root, "manuscript", `${first.chapter.id}.json`),
      "utf8",
    ),
  ).toBe(firstFile);
  expect(await readdir(root)).not.toContain(CHAPTER_CREATION_LOCK);
});

it("preserves unknown manifest fields while atomically appending the order", async () => {
  const root = await fixture();
  const path = join(root, "project.json");
  const raw = JSON.parse(await readFile(path, "utf8"));
  await writeJsonAtomically(path, {
    ...raw,
    extension: { value: "keep" },
    manuscript: { ...raw.manuscript, annotation: "keep too" },
  });
  await createChapter(input(root));
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved).toMatchObject({
    extension: { value: "keep" },
    manuscript: { annotation: "keep too" },
  });
  expect(ProjectConfigSchema.safeParse(saved).success).toBe(true);
  expect(await readdir(root)).not.toContain("project.json.tmp");
});

it.each(["chapter", "manifest"])(
  "preserves a consistent project after %s write failure",
  async (stage) => {
    const root = await fixture();
    const before = await readFile(join(root, "project.json"), "utf8");
    const fail = async () => {
      throw new Error("private file contents");
    };
    await expect(
      createChapter(
        input(root),
        stage === "chapter" ? { writeChapter: fail } : { writeManifest: fail },
      ),
    ).rejects.toMatchObject({ code: "CHAPTER_CREATE_FAILED" });
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(before);
    expect((await openProject(root)).chapters).toEqual([]);
    const files = await readdir(join(root, "manuscript"));
    expect(files).toHaveLength(stage === "chapter" ? 0 : 1);
    if (files[0])
      expect(
        ChapterFileSchema.safeParse(
          JSON.parse(
            await readFile(join(root, "manuscript", files[0]), "utf8"),
          ),
        ).success,
      ).toBe(true);
    expect(await readdir(root)).not.toContain(CHAPTER_CREATION_LOCK);
    const retried = await createChapter(input(root));
    expect((await openProject(root)).project.manuscript.order).toEqual([
      retried.chapter.id,
    ]);
  },
);

it("keeps an existing manifest temporary file and previous manifest when atomic writing cannot start", async () => {
  const root = await fixture();
  const path = join(root, "project.json");
  const before = await readFile(path, "utf8");
  await writeFile(`${path}.tmp`, "recoverable previous temporary data");
  await expect(createChapter(input(root))).rejects.toMatchObject({
    code: "CHAPTER_CREATE_FAILED",
  });
  expect(await readFile(path, "utf8")).toBe(before);
  expect(await readFile(`${path}.tmp`, "utf8")).toBe(
    "recoverable previous temporary data",
  );
});

it("detects an external manifest edit and preserves both it and the unreferenced chapter", async () => {
  const root = await fixture();
  const path = join(root, "project.json");
  const original = JSON.parse(await readFile(path, "utf8"));
  await expect(
    createChapter(input(root), {
      writeChapter: async (chapterPath, chapter) => {
        await writeJsonAtomically(chapterPath, chapter);
        await writeJsonAtomically(path, { ...original, externalChange: true });
      },
    }),
  ).rejects.toMatchObject({ code: "PROJECT_CHANGED_DURING_CREATE" });
  expect(JSON.parse(await readFile(path, "utf8"))).toHaveProperty(
    "externalChange",
    true,
  );
  expect((await openProject(root)).chapters).toEqual([]);
  expect(await readdir(join(root, "manuscript"))).toHaveLength(1);
});

it("rejects competing creation through a root alias and permits retry after lock release", async () => {
  const root = await fixture();
  const aliasParent = await mkdtemp(join(tmpdir(), "sarel-alias-"));
  directories.push(aliasParent);
  const alias = join(aliasParent, "book");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  let finish!: () => void;
  const first = createChapter(input(root), {
    writeManifest: async (path, project) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      await writeJsonAtomically(path, project);
    },
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await expect(createChapter(input(alias))).rejects.toMatchObject({
    code: "PROJECT_BUSY",
  });
  finish();
  const created = await first;
  const second = await createChapter(input(alias));
  expect(second.session.project.manuscript.order).toEqual([
    created.chapter.id,
    second.chapter.id,
  ]);
});

it.each(["before", "after"])(
  "survives a process exit %s manifest commit without broken references",
  async (stage) => {
    const root = await fixture();
    const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
    const script = `import { createChapter, writeJsonAtomically } from ${JSON.stringify(moduleUrl)};
    await createChapter({ projectPath: process.argv[1], title: "Interrupted" }, {
      writeManifest: async (path, project) => {
        if (process.argv[2] === "after") await writeJsonAtomically(path, project);
        process.exit(71);
      }
    });`;
    await expect(
      promisify(execFile)(process.execPath, [
        "--input-type=module",
        "--eval",
        script,
        root,
        stage,
      ]),
    ).rejects.toMatchObject({ code: 71 });
    const reopened = await openProject(root);
    expect(reopened.chapters).toHaveLength(stage === "before" ? 0 : 1);
    expect(await readdir(join(root, "manuscript"))).toHaveLength(1);
    await expect(createChapter(input(root))).rejects.toMatchObject({
      code: "PROJECT_BUSY",
    });
    await rmdir(join(root, CHAPTER_CREATION_LOCK));
    expect((await createChapter(input(root))).session.chapters).toHaveLength(
      stage === "before" ? 1 : 2,
    );
  },
);

it("reports lock cleanup failure as a warning after a successful commit", async () => {
  const root = await fixture();
  const result = await createChapter(input(root), {
    rmdir: async () => {
      throw new Error("private details");
    },
  });
  expect(result.warning).toContain("chapter was created");
  expect((await openProject(root)).project.manuscript.order).toEqual([
    result.chapter.id,
  ]);
  expect(JSON.stringify(result)).not.toContain("private details");
});

it("rejects invalid input, missing projects and linked manuscript directories without writing chapters", async () => {
  await expect(createChapter(input("relative"))).rejects.toMatchObject({
    code: "PROJECT_PATH_INVALID",
  });
  const root = await fixture();
  await expect(createChapter(input(root, "  "))).rejects.toMatchObject({
    code: "CHAPTER_INPUT_INVALID",
  });
  await expect(
    createChapter(input(join(root, "missing"))),
  ).rejects.toMatchObject({ code: "PROJECT_PATH_ACCESS_FAILED" });
  const target = join(root, "outside");
  await mkdir(target);
  await rmdir(join(root, "manuscript"));
  await symlink(
    target,
    join(root, "manuscript"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(createChapter(input(root))).rejects.toMatchObject({
    code: "PROJECT_PATH_INVALID",
  });
  expect(await readdir(target)).toEqual([]);
});
