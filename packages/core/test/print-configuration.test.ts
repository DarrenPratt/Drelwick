import { join, dirname } from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import {
  PRINT_TRIM_PRESETS,
  defaultPrintSettings,
  type PrintSettings,
} from "@drelwick/shared";
import {
  loadPrintConfiguration,
  savePrintConfiguration,
  openProject,
  openProjectForEditing,
  assembleBook,
  saveBookTheme,
  createProjectArchive,
  restoreProjectArchive,
  writeJsonAtomically,
  CHAPTER_CREATION_LOCK,
} from "../src/index.js";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function setup() {
  const copy = await copyFixture("public-example");
  copies.push(copy);
  const projectId = (await openProject(copy.projectPath)).project.projectId;
  return { projectPath: copy.projectPath, projectId };
}
async function sourceBytes(root: string) {
  const names = [
    "project.json",
    "book.json",
    "publication.json",
    "presentation.json",
    ...(await readdir(join(root, "manuscript"))).map(
      (name) => `manuscript/${name}`,
    ),
  ];
  return Promise.all(
    names.map(async (name) => [
      name,
      (await readFile(join(root, name))).toString("base64"),
    ]),
  );
}
it("defaults without writing; v1 migration leaves print defaults and chapters intact", async () => {
  const copy = await copyFixture("multi-chapter-book");
  copies.push(copy);
  const id = (await openProject(copy.projectPath)).project.projectId;
  const before = await loadPrintConfiguration(copy.projectPath, id);
  expect(before.settings).toEqual(defaultPrintSettings());
  await expect(
    readFile(join(copy.projectPath, "print.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await openProjectForEditing(copy.projectPath);
  expect(await loadPrintConfiguration(copy.projectPath, id)).toEqual(before);
});
it("persists representative presets/custom geometry and every semantic option without changing ebook or manuscript", async () => {
  const f = await setup();
  const bytes = await sourceBytes(f.projectPath);
  const book = await assembleBook(f.projectPath);
  let state = await loadPrintConfiguration(f.projectPath, f.projectId);
  for (const [preset, size] of Object.entries(PRINT_TRIM_PRESETS)) {
    const settings: PrintSettings = {
      ...state.settings,
      unit: "mm",
      trim: {
        preset: preset as PrintSettings["trim"]["preset"],
        width: size.width,
        height: size.height,
      },
      chapterStart: "recto",
      headers: {
        verso: "chapter-title",
        recto: "author",
        showOnChapterOpening: true,
      },
      pageNumbers: {
        enabled: true,
        position: "footer-outside",
        bodyStart: 7,
        frontMatter: "none",
        showOnChapterOpening: false,
      },
    };
    state = await savePrintConfiguration({
      ...f,
      expectedRevision: state.revision,
      settings,
    });
    expect(await loadPrintConfiguration(f.projectPath, f.projectId)).toEqual(
      state,
    );
    expect(
      JSON.parse(await readFile(join(f.projectPath, "print.json"), "utf8")),
    ).toEqual({ schemaVersion: 1, projectId: f.projectId, settings });
  }
  const settings: PrintSettings = {
    ...state.settings,
    trim: { preset: "custom", width: 155123, height: 231456 },
    margins: {
      ...state.settings.margins,
      inside: 21000,
      outside: 16000,
      gutter: 4000,
    },
  };
  state = await savePrintConfiguration({
    ...f,
    expectedRevision: state.revision,
    settings,
  });
  expect(
    (await loadPrintConfiguration(f.projectPath, f.projectId)).settings,
  ).toEqual(settings);
  expect(await sourceBytes(f.projectPath)).toEqual(bytes);
  expect((await assembleBook(f.projectPath)).book).toEqual(book.book);
  expect((await assembleBook(f.projectPath)).presentation).toEqual(
    book.presentation,
  );
  await saveBookTheme({ ...f, themeId: "modern" });
  expect(await loadPrintConfiguration(f.projectPath, f.projectId)).toEqual(
    state,
  );
  const archivePath = join(dirname(f.projectPath), "print.zip");
  const destinationParent = join(dirname(f.projectPath), "restored");
  await mkdir(destinationParent);
  await createProjectArchive({ projectPath: f.projectPath, archivePath });
  const restored = await restoreProjectArchive({
    archivePath,
    destinationParent,
  });
  expect(
    await loadPrintConfiguration(restored.projectPath, f.projectId),
  ).toEqual(state);
});
it("preserves previous bytes on invalid, stale and atomic replacement failure; permits retry", async () => {
  const f = await setup();
  let state = await loadPrintConfiguration(f.projectPath, f.projectId);
  state = await savePrintConfiguration({
    ...f,
    expectedRevision: state.revision,
    settings: state.settings,
  });
  const path = join(f.projectPath, "print.json");
  const bytes = await readFile(path);
  const source = await sourceBytes(f.projectPath);
  const request = {
    ...f,
    expectedRevision: state.revision,
    settings: { ...state.settings, chapterStart: "recto" as const },
  };
  await expect(
    savePrintConfiguration({
      ...request,
      settings: {
        ...request.settings,
        margins: {
          ...request.settings.margins,
          inside: 100000,
          outside: 100000,
        },
      },
    }),
  ).rejects.toMatchObject({ code: "PRINT_CONFIGURATION_INVALID" });
  await expect(
    savePrintConfiguration({ ...request, expectedRevision: "a".repeat(64) }),
  ).rejects.toMatchObject({ code: "PRINT_CONFIGURATION_STALE" });
  let attempted = false;
  await expect(
    savePrintConfiguration(request, {
      write: (path, value) =>
        writeJsonAtomically(path, value, {
          open,
          unlink,
          rename: async () => {
            attempted = true;
            throw new Error("synthetic");
          },
        }),
    }),
  ).rejects.toMatchObject({ code: "PRINT_CONFIGURATION_SAVE_FAILED" });
  expect(attempted).toBe(true);
  expect(await readFile(path)).toEqual(bytes);
  expect(await sourceBytes(f.projectPath)).toEqual(source);
  expect(await loadPrintConfiguration(f.projectPath, f.projectId)).toEqual(
    state,
  );
  expect((await savePrintConfiguration(request)).settings.chapterStart).toBe(
    "recto",
  );
});
it("refuses unknown, newer, foreign or damaged configuration and retained recovery files", async () => {
  const f = await setup();
  const state = await loadPrintConfiguration(f.projectPath, f.projectId);
  const path = join(f.projectPath, "print.json");
  const data = {
    schemaVersion: 1,
    projectId: f.projectId,
    settings: state.settings,
  };
  for (const bytes of [
    "{",
    JSON.stringify({ ...data, schemaVersion: 2 }),
    JSON.stringify({ ...data, future: true }),
    JSON.stringify({
      ...data,
      projectId: "00000000-0000-4000-8000-000000000999",
    }),
  ]) {
    await writeFile(path, bytes);
    await expect(
      savePrintConfiguration({
        ...f,
        settings: state.settings,
        expectedRevision: state.revision,
      }),
    ).rejects.toMatchObject({ code: "PRINT_CONFIGURATION_INVALID" });
    expect(await readFile(path, "utf8")).toBe(bytes);
  }
  await writeFile(path, JSON.stringify(data));
  await writeFile(`${path}.tmp`, "recovery evidence");
  await expect(
    loadPrintConfiguration(f.projectPath, f.projectId),
  ).rejects.toMatchObject({ code: "PRINT_CONFIGURATION_RECOVERY_REQUIRED" });
  await expect(
    savePrintConfiguration({
      ...f,
      settings: state.settings,
      expectedRevision: state.revision,
    }),
  ).rejects.toMatchObject({ code: "PRINT_CONFIGURATION_RECOVERY_REQUIRED" });
  expect(await readFile(`${path}.tmp`, "utf8")).toBe("recovery evidence");
});
it("honors the project lock and reports post-commit cleanup as saved with warning", async () => {
  const f = await setup();
  const state = await loadPrintConfiguration(f.projectPath, f.projectId);
  const request = {
    ...f,
    settings: state.settings,
    expectedRevision: state.revision,
  };
  await assembleBook(f.projectPath, {
    checkpoint: async () => {
      await expect(savePrintConfiguration(request)).rejects.toMatchObject({
        code: "PROJECT_BUSY",
      });
    },
  });
  const saved = await savePrintConfiguration(request, {
    releaseLock: async () => {
      throw new Error("synthetic");
    },
  });
  expect(saved.warning).toContain("saved");
  expect(await loadPrintConfiguration(f.projectPath, f.projectId)).toEqual({
    settings: saved.settings,
    revision: saved.revision,
  });
  expect(await readdir(f.projectPath)).toContain(CHAPTER_CREATION_LOCK);
});
