import { join, dirname } from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  symlink,
  open,
  unlink,
} from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import {
  assembleBook,
  loadBookTheme,
  saveBookTheme,
  openProject,
  openProjectForEditing,
  CHAPTER_CREATION_LOCK,
  createProjectArchive,
  restoreProjectArchive,
  writeJsonAtomically,
} from "../src/index.js";
import {
  generateThemeStyles,
  getBookTheme,
  renderBook,
} from "@drelwick/renderer";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function setup() {
  const copy = await copyFixture("multi-chapter-book");
  copies.push(copy);
  const projectPath = copy.projectPath;
  const projectId = (await openProject(projectPath)).project.projectId;
  return { projectPath, projectId, themeId: "modern" as const };
}
async function chapters(root: string) {
  const names = (await readdir(join(root, "manuscript"))).sort();
  return Promise.all(
    names.map(async (name) => [
      name,
      (await readFile(join(root, "manuscript", name))).toString("base64"),
    ]),
  );
}
it("defaults older projects without writes, migrates, switches presentation only and survives reopen/portable backup", async () => {
  const f = await setup();
  const before = await chapters(f.projectPath);
  expect(await loadBookTheme(f.projectPath, f.projectId)).toEqual({
    savedThemeId: "classic",
    themeId: "classic",
  });
  await expect(
    readFile(join(f.projectPath, "presentation.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await openProjectForEditing(f.projectPath);
  expect(await chapters(f.projectPath)).toEqual(before);
  const first = await assembleBook(f.projectPath);
  const markup = renderBook(first.book, { resolveAsset: () => undefined });
  await saveBookTheme(f);
  const next = await assembleBook(f.projectPath);
  expect(next.book).toEqual(first.book);
  expect(renderBook(next.book, { resolveAsset: () => undefined })).toEqual(
    markup,
  );
  expect(generateThemeStyles(getBookTheme("classic"), "ebook").css).not.toBe(
    generateThemeStyles(getBookTheme("modern"), "ebook").css,
  );
  expect(await chapters(f.projectPath)).toEqual(before);
  await openProjectForEditing(f.projectPath);
  expect((await loadBookTheme(f.projectPath, f.projectId)).themeId).toBe(
    "modern",
  );
  const archivePath = join(dirname(f.projectPath), "book.zip");
  const destinationParent = join(dirname(f.projectPath), "restored");
  await mkdir(destinationParent);
  await createProjectArchive({ projectPath: f.projectPath, archivePath });
  const restored = await restoreProjectArchive({
    archivePath,
    destinationParent,
  });
  expect((await loadBookTheme(restored.projectPath, f.projectId)).themeId).toBe(
    "modern",
  );
  expect(await chapters(restored.projectPath)).toEqual(before);
});
it("preserves unavailable saved identity and prose while presenting the deterministic fallback", async () => {
  const f = await setup();
  const before = await chapters(f.projectPath);
  const path = join(f.projectPath, "presentation.json");
  const bytes = JSON.stringify({
    schemaVersion: 1,
    projectId: f.projectId,
    themeId: "unavailable-theme",
  });
  await writeFile(path, bytes);
  await openProjectForEditing(f.projectPath);
  expect(await loadBookTheme(f.projectPath, f.projectId)).toEqual({
    savedThemeId: "unavailable-theme",
    themeId: "classic",
    warning: "unavailable-theme",
  });
  expect(await readFile(path, "utf8")).toBe(bytes);
  expect(await chapters(f.projectPath)).toEqual(before);
});
it("keeps previous authoritative configuration and manuscript on atomic write failure", async () => {
  const f = await setup();
  await saveBookTheme(f);
  const path = join(f.projectPath, "presentation.json");
  const previous = await readFile(path);
  const before = await chapters(f.projectPath);
  let renameAttempted = false;
  await expect(
    saveBookTheme(
      { ...f, themeId: "literary" },
      {
        write: (path, value) =>
          writeJsonAtomically(path, value, {
            open,
            unlink,
            rename: async () => {
              renameAttempted = true;
              throw new Error("synthetic failure");
            },
          }),
      },
    ),
  ).rejects.toMatchObject({ code: "BOOK_PRESENTATION_SAVE_FAILED" });
  expect(renameAttempted).toBe(true);
  expect(await readFile(path)).toEqual(previous);
  expect(await chapters(f.projectPath)).toEqual(before);
  expect((await loadBookTheme(f.projectPath, f.projectId)).themeId).toBe(
    "modern",
  );
});
it("shares assembly's lock and captures a coherent presentation without changing semantic revision", async () => {
  const f = await setup();
  await assembleBook(f.projectPath, {
    checkpoint: async () => {
      await expect(saveBookTheme(f)).rejects.toMatchObject({
        code: "PROJECT_BUSY",
      });
    },
  });
  await saveBookTheme(f);
  expect((await assembleBook(f.projectPath)).presentation.themeId).toBe(
    "modern",
  );
});
it("refuses recovery files, malformed/future/foreign configuration and unsafe IDs without overwriting evidence", async () => {
  const f = await setup();
  const path = join(f.projectPath, "presentation.json");
  for (const bytes of [
    "{",
    JSON.stringify({
      schemaVersion: 2,
      projectId: f.projectId,
      themeId: "classic",
    }),
    JSON.stringify({
      schemaVersion: 1,
      projectId: "00000000-0000-4000-8000-000000000999",
      themeId: "classic",
    }),
  ]) {
    await writeFile(path, bytes);
    await expect(saveBookTheme(f)).rejects.toMatchObject({
      code: "BOOK_PRESENTATION_INVALID",
    });
    expect(await readFile(path, "utf8")).toBe(bytes);
    await openProject(f.projectPath); // authoring remains available
  }
  await rm(path);
  await writeFile(`${path}.tmp`, "recovery evidence");
  await expect(saveBookTheme(f)).rejects.toMatchObject({
    code: "BOOK_PRESENTATION_RECOVERY_REQUIRED",
  });
  expect(await readFile(`${path}.tmp`, "utf8")).toBe("recovery evidence");
  await expect(
    saveBookTheme({ ...f, themeId: "../secret" as "modern" }),
  ).rejects.toMatchObject({ code: "BOOK_THEME_INVALID" });
});

it("detects externally changed presentation during assembly", async () => {
  const f = await setup();
  await expect(
    assembleBook(f.projectPath, {
      checkpoint: async () => {
        await writeFile(
          join(f.projectPath, "presentation.json"),
          JSON.stringify({
            schemaVersion: 1,
            projectId: f.projectId,
            themeId: "modern",
          }),
        );
      },
    }),
  ).rejects.toMatchObject({ code: "BOOK_REVISION_CHANGED" });
});
it("rejects linked project directories and reports a committed selection if lock cleanup fails", async () => {
  const f = await setup();
  const alias = join(dirname(f.projectPath), "linked-project");
  await symlink(f.projectPath, alias, "junction");
  await expect(loadBookTheme(alias, f.projectId)).rejects.toThrow();
  const saved = await saveBookTheme(f, {
    releaseLock: async () => {
      throw new Error("cleanup failed");
    },
  });
  expect(saved.selection.themeId).toBe("modern");
  expect(saved.warning).toContain("saved");
  await rm(join(f.projectPath, CHAPTER_CREATION_LOCK), { recursive: true });
  expect((await loadBookTheme(f.projectPath, f.projectId)).themeId).toBe(
    "modern",
  );
});
