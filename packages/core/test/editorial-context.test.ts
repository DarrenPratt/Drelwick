import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import {
  openProjectForEditing,
  migrateProjectToEditorialV3,
  openProject,
  saveBookTheme,
  loadPrintConfiguration,
  savePrintConfiguration,
  readPublication,
  loadPublication,
  savePublication,
  recoverEditorialTransactions,
} from "../src/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    mkdir: vi.fn(actual.mkdir),
  };
});
const copies: FixtureCopy[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function fixture() {
  const copy = await copyFixture("minimal-book");
  copies.push(copy);
  await openProjectForEditing(copy.projectPath);
  await migrateProjectToEditorialV3(copy.projectPath);
  const session = await openProject(copy.projectPath);
  return {
    projectPath: copy.projectPath,
    projectId: session.project.projectId,
  };
}
async function generation(root: string) {
  const project = JSON.parse(
    await fs.readFile(join(root, "project.json"), "utf8"),
  );
  const state = JSON.parse(
    await fs.readFile(join(root, "editorial/state.json"), "utf8"),
  );
  expect(state.generation).toBe(project.generation);
  return project.generation as number;
}

it("saves v3 theme and legacy print separation in one generation without touching chapters", async () => {
  const f = await fixture();
  const session = await openProject(f.projectPath);
  const chapter = join(
    f.projectPath,
    "manuscript",
    `${session.project.manuscript.order[0]}.json`,
  );
  const original = await fs.readFile(chapter);
  const print = await loadPrintConfiguration(f.projectPath, f.projectId);
  const before = await generation(f.projectPath);
  await saveBookTheme({ ...f, themeId: "modern" });
  expect(await generation(f.projectPath)).toBe(before + 1);
  expect(await fs.readFile(chapter)).toEqual(original);
  const separated = await loadPrintConfiguration(f.projectPath, f.projectId);
  expect(separated.editions).toEqual(print.editions);
  await saveBookTheme({ ...f, themeId: "modern" });
  expect(await generation(f.projectPath)).toBe(before + 1);
  const journals = await fs.readdir(
    join(f.projectPath, ".editorial/transactions"),
  );
  const transactions = await Promise.all(
    journals.map(async (id) =>
      JSON.parse(
        await fs.readFile(
          join(
            f.projectPath,
            ".editorial/transactions",
            id,
            "transaction.json",
          ),
          "utf8",
        ),
      ),
    ),
  );
  const theme = transactions.find((tx) =>
    tx.files.some(
      (file: { path: string }) => file.path === "presentation.json",
    ),
  );
  expect(theme.phase).toBe("complete");
  expect(theme.files.map((file: { path: string }) => file.path)).toEqual([
    "editorial/state.json",
    "presentation.json",
    "print.json",
    "project.json",
  ]);
});

it("advances v3 print and publication generations, survives reopen and rejects stale print revisions", async () => {
  const f = await fixture();
  const before = await generation(f.projectPath);
  const print = await loadPrintConfiguration(f.projectPath, f.projectId);
  const request = {
    ...f,
    expectedRevision: print.revision,
    settings: { ...print.settings, chapterStart: "recto" as const },
  };
  await savePrintConfiguration(request);
  expect(await generation(f.projectPath)).toBe(before + 1);
  await expect(savePrintConfiguration(request)).rejects.toMatchObject({
    code: "PRINT_CONFIGURATION_STALE",
  });
  expect(await generation(f.projectPath)).toBe(before + 1);
  const publication = await loadPublication(f.projectPath, f.projectId);
  expect(await generation(f.projectPath)).toBe(before + 2);
  await loadPublication(f.projectPath, f.projectId);
  expect(await generation(f.projectPath)).toBe(before + 2);
  const saved = await savePublication({
    ...f,
    expectedRevision: publication.revision,
    data: {
      ...publication.data,
      metadata: {
        ...publication.data.metadata,
        title: "Synthetic revised title",
      },
    },
  });
  expect(await generation(f.projectPath)).toBe(before + 3);
  expect(await loadPublication(f.projectPath, f.projectId)).toEqual(saved);
  expect((await openProject(f.projectPath)).project.schemaVersion).toBe(3);
}, 20_000);

it.each(["theme", "print", "publication"] as const)(
  "recovers interrupted v3 %s settings and generation",
  async (kind) => {
    const f = await fixture();
    const print = await loadPrintConfiguration(f.projectPath, f.projectId);
    const session = await openProject(f.projectPath);
    const publication = await readPublication(f.projectPath, session);
    const save = () =>
      kind === "theme"
        ? saveBookTheme({ ...f, themeId: "modern" })
        : kind === "print"
          ? savePrintConfiguration({
              ...f,
              expectedRevision: print.revision,
              settings: { ...print.settings, chapterStart: "recto" },
            })
          : savePublication({
              ...f,
              expectedRevision: publication.revision,
              data: {
                ...publication.data,
                metadata: {
                  ...publication.data.metadata,
                  title: "Synthetic settings failure",
                },
              },
            });
    const beforeProject = await fs.readFile(
      join(f.projectPath, "project.json"),
    );
    const beforeState = await fs.readFile(
      join(f.projectPath, "editorial/state.json"),
    );
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let injected = false;
    vi.mocked(fs.rename).mockImplementation(async (...args) => {
      if (
        !injected &&
        String(args[1]) === join(f.projectPath, "project.json")
      ) {
        injected = true;
        throw Object.assign(new Error("Synthetic disk fault"), { code: "EIO" });
      }
      return actual.rename(...args);
    });
    await expect(save()).rejects.toThrow();
    expect(injected).toBe(true);
    await recoverEditorialTransactions(f.projectPath);
    expect(await fs.readFile(join(f.projectPath, "project.json"))).toEqual(
      beforeProject,
    );
    expect(
      await fs.readFile(join(f.projectPath, "editorial/state.json")),
    ).toEqual(beforeState);
    for (const name of ["presentation.json", "print.json", "publication.json"])
      await expect(
        fs.readFile(join(f.projectPath, name)),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    await save();
    expect(await generation(f.projectPath)).toBe(2);
  },
);

it.each(["theme", "print", "publication", "initialize-publication"] as const)(
  "refuses a concurrent v3 upgrade before the legacy %s writer publishes",
  async (kind) => {
    const copy = await copyFixture("minimal-book");
    copies.push(copy);
    await openProjectForEditing(copy.projectPath);
    const session = await openProject(copy.projectPath);
    const f = {
      projectPath: copy.projectPath,
      projectId: session.project.projectId,
    };
    const print = await loadPrintConfiguration(f.projectPath, f.projectId);
    const publication = await readPublication(f.projectPath, session);
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let upgraded = false;
    vi.mocked(fs.mkdir).mockImplementation(async (...args) => {
      if (
        !upgraded &&
        String(args[0]) === join(f.projectPath, ".chapter-create.lock")
      ) {
        upgraded = true;
        await migrateProjectToEditorialV3(f.projectPath);
      }
      return actual.mkdir(...args);
    });
    const save = () =>
      kind === "theme"
        ? saveBookTheme({ ...f, themeId: "modern" })
        : kind === "print"
          ? savePrintConfiguration({
              ...f,
              expectedRevision: print.revision,
              settings: print.settings,
            })
          : kind === "publication"
            ? savePublication({
                ...f,
                expectedRevision: publication.revision,
                data: publication.data,
              })
            : loadPublication(f.projectPath, f.projectId);
    await expect(save()).rejects.toThrow();
    expect(upgraded).toBe(true);
    expect(await generation(f.projectPath)).toBe(1);
    for (const name of ["presentation.json", "print.json", "publication.json"])
      await expect(
        fs.readFile(join(f.projectPath, name)),
      ).rejects.toMatchObject({ code: "ENOENT" });
  },
);
