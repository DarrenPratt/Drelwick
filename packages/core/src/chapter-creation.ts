import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApplicationError, createIsoDate, createUuid } from "@drelwick/shared";
import {
  ChapterFileSchema,
  ChapterFileV2Schema,
  CountedChapterSummarySchema,
  EditorialStateSchema,
  ProjectConfigSchema,
  ProjectConfigV3Schema,
  type ChapterFile,
  type ProjectConfig,
} from "@drelwick/project-model";
import {
  openProject,
  writeJsonAtomically,
  type OpenedProject,
  type ProjectLoadingFileSystem,
} from "./index.js";
import { commitEditorialTransaction } from "./editorial-transactions.js";

export const CHAPTER_CREATION_LOCK = ".chapter-create.lock";

export interface CreateChapterInput {
  projectPath: string;
  title: string;
}

export interface CreatedChapter {
  chapter: ChapterFile | import("@drelwick/project-model").ChapterFileV2;
  session: OpenedProject;
  warning?: string;
}

export interface ChapterCreationFileSystem extends ProjectLoadingFileSystem {
  mkdir(path: string): Promise<unknown>;
  rmdir(path: string): Promise<void>;
  writeChapter(path: string, chapter: ChapterFile): Promise<void>;
  writeManifest(path: string, project: ProjectConfig): Promise<void>;
}

const defaults: ChapterCreationFileSystem = {
  lstat,
  readFile,
  realpath,
  mkdir,
  rmdir,
  writeJson: writeJsonAtomically,
  writeManifest: (path, project) => writeCreationJson(path, project, false),
  writeChapter: (path, chapter) => writeCreationJson(path, chapter, true),
};

async function writeCreationJson(
  path: string,
  value: unknown,
  exclusive: boolean,
): Promise<void> {
  let ownsTemporary = false;
  await writeJsonAtomically(path, value, {
    open: async (temporary, flags) => {
      const handle = await open(temporary, flags);
      ownsTemporary = true;
      return handle;
    },
    // Hard-link publication fails if the destination already exists; rename may overwrite it.
    rename: async (source, destination) => {
      if (exclusive) {
        await link(source, destination);
        await unlink(source);
      } else await rename(source, destination);
    },
    unlink: async (temporary) => {
      if (ownsTemporary) await unlink(temporary);
    },
  });
}

/** The manifest is the commit point; unreferenced new chapters remain recoverable on failure. */
export async function createChapter(
  input: CreateChapterInput,
  overrides: Partial<ChapterCreationFileSystem> = {},
): Promise<CreatedChapter> {
  if (typeof input.title !== "string" || !input.title.trim())
    throw new ApplicationError(
      "CHAPTER_INPUT_INVALID",
      "Enter a chapter title.",
    );
  if (!isAbsolute(input.projectPath))
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  const fs = { ...defaults, ...overrides };
  let root: string;
  try {
    root = await fs.realpath(input.projectPath);
  } catch {
    throw new ApplicationError(
      "PROJECT_PATH_ACCESS_FAILED",
      "Unable to access project folder.",
    );
  }
  const lock = join(root, CHAPTER_CREATION_LOCK);
  const header = ProjectConfigSchema.safeParse(
    JSON.parse(
      await fs.readFile(join(root, "project.json"), "utf8"),
    ) as unknown,
  );
  if (header.success && header.data.schemaVersion === 3)
    return createEditorialChapter(root, input.title.trim());
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new ApplicationError(
        "PROJECT_BUSY",
        "Chapter creation is locked. Wait for the current operation, or check for an interrupted creation before retrying.",
      );
    throw new ApplicationError(
      "CHAPTER_CREATE_FAILED",
      "Unable to acquire the chapter creation lock.",
    );
  }

  let result: CreatedChapter | undefined;
  try {
    const session = await openProject(root, {}, fs);
    const manuscriptPath = join(root, "manuscript");
    const directory = await fs.lstat(manuscriptPath);
    if (directory.isSymbolicLink() || !directory.isDirectory())
      throw new ApplicationError(
        "PROJECT_PATH_INVALID",
        "Expected a regular manuscript directory.",
      );
    const manifestPath = join(root, "project.json");
    const source = await fs.readFile(manifestPath, "utf8");
    // The loader validated this shape; compare again to reject changes since it loaded.
    const raw = JSON.parse(source) as ProjectConfig;
    const parsed = ProjectConfigSchema.safeParse(raw);
    if (
      !parsed.success ||
      JSON.stringify(parsed.data) !== JSON.stringify(session.project)
    )
      throw new ApplicationError(
        "PROJECT_CHANGED_DURING_CREATE",
        "The project changed during chapter creation. Reopen it before retrying.",
      );
    const now = createIsoDate();
    const chapter = ChapterFileSchema.parse({
      schemaVersion: 1,
      id: createUuid(),
      title: input.title.trim(),
      type: "chapter",
      status: "draft",
      created: now,
      modified: now,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const project: ProjectConfig = {
      ...raw,
      modified: now,
      manuscript: {
        ...raw.manuscript,
        order: [...raw.manuscript.order, chapter.id],
      },
    };
    if (!ProjectConfigSchema.safeParse(project).success)
      throw new ApplicationError(
        "CHAPTER_CREATE_FAILED",
        "Unable to assign a unique chapter identifier. Try again.",
      );
    await fs.writeChapter(join(manuscriptPath, `${chapter.id}.json`), chapter);
    const manifestStats = await fs.lstat(manifestPath);
    if (
      manifestStats.isSymbolicLink() ||
      !manifestStats.isFile() ||
      (await fs.readFile(manifestPath, "utf8")) !== source
    )
      throw new ApplicationError(
        "PROJECT_CHANGED_DURING_CREATE",
        "The project changed during chapter creation. The new chapter file was preserved for recovery.",
      );
    await fs.writeManifest(manifestPath, project);
    result = {
      chapter,
      session: {
        ...session,
        project,
        chapters: [
          ...session.chapters,
          CountedChapterSummarySchema.parse({ ...chapter, wordCount: 0 }),
        ],
      },
    };
    return result;
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      [
        "PROJECT_PATH_INVALID",
        "PROJECT_CHANGED_DURING_CREATE",
        "PROJECT_ORDER_INVALID",
        "PROJECT_SCHEMA_INVALID",
        "PROJECT_SCHEMA_UNSUPPORTED",
        "PROJECT_FILE_MISSING",
        "PROJECT_JSON_INVALID",
      ].includes(error.code)
    )
      throw error;
    throw new ApplicationError(
      "CHAPTER_CREATE_FAILED",
      "Unable to create the chapter. Reopen the project and inspect unreferenced manuscript files before retrying.",
    );
  } finally {
    try {
      await fs.rmdir(lock);
    } catch {
      if (result)
        result.warning =
          "The chapter was created, but its creation lock could not be removed. Close other project processes and inspect the lock before creating another chapter.";
    }
  }
}

async function createEditorialChapter(
  root: string,
  title: string,
): Promise<CreatedChapter> {
  const session = await openProject(root, { rebuildSummaries: true });
  if (session.project.schemaVersion !== 3)
    throw new ApplicationError(
      "PROJECT_CHANGED_DURING_CREATE",
      "The project changed during chapter creation.",
    );
  const now = createIsoDate();
  const id = createUuid();
  for (const suffix of [".json", ".json.tmp"]) {
    try {
      await lstat(join(root, "manuscript", `${id}${suffix}`));
      throw new ApplicationError(
        "CHAPTER_ID_COLLISION",
        "Unable to allocate a chapter identity. Retry the operation.",
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  const content = { type: "doc", content: [{ type: "paragraph" }] };
  const chapter = ChapterFileV2Schema.parse({
    schemaVersion: 2,
    id,
    title,
    type: "chapter",
    status: "draft",
    created: now,
    modified: now,
    revision: 1,
    content,
    review: { schemaVersion: 1, mode: "off", proposed: content, pending: [] },
  });
  const state = EditorialStateSchema.parse(
    JSON.parse(
      await readFile(join(root, session.project.editorialFile), "utf8"),
    ) as unknown,
  );
  const nextState = { ...state, generation: state.generation + 1 };
  const nextProject = ProjectConfigV3Schema.parse({
    ...session.project,
    modified: now,
    generation: session.project.generation + 1,
    manuscript: {
      ...session.project.manuscript,
      order: [...session.project.manuscript.order, id],
    },
  });
  const path = `manuscript/${id}.json`;
  await commitEditorialTransaction({
    projectPath: root,
    projectId: session.project.projectId,
    kind: "structure",
    expectedGeneration: session.project.generation,
    expectedBefore: { [path]: null },
    changes: [
      { path, after: Buffer.from(`${JSON.stringify(chapter, null, 2)}\n`) },
      {
        path: session.project.editorialFile,
        after: Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`),
      },
      {
        path: "project.json",
        after: Buffer.from(`${JSON.stringify(nextProject, null, 2)}\n`),
      },
    ],
  });
  return {
    chapter,
    session: await openProject(root, { rebuildSummaries: true }),
  };
}
