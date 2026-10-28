import {
  ApplicationError,
  createIsoDate,
  createUuid,
  isSafeRelativePath,
  joinSafeRelativePath,
  countDocumentWords,
} from "@drelwick/shared";
export * from "./chapter-creation.js";
export * from "./references.js";
export * from "./spelling.js";
export * from "./hunspell.js";
export * from "./book-assembly.js";
export * from "./book-presentation.js";
export * from "./publication.js";
export * from "./chapter-deletion.js";
export * from "./chapter-ordering.js";
export * from "./chapter-loading.js";
export * from "./chapter-saving.js";
export * from "./chapter-rename.js";
export * from "./history.js";
export * from "./editorial-anchors.js";
export * from "./editorial-undo.js";
export * from "./editorial-transactions.js";
export * from "./editorial-bundle.js";
export * from "./editorial-service.js";
export * from "./project-archive.js";
export * from "./recovery.js";
export * from "./project-migration.js";
export * from "./image-assets.js";
export * from "./manuscript-import.js";
export * from "./import-parser.js";
export * from "./docx-importer.js";
export * from "./docx-export.js";
export * from "./docx-output.js";
export * from "./epub-export.js";
export * from "./epub-output.js";
export * from "./text-importer.js";
export * from "./manuscript-replacement.js";
import { assertReplacementReadable } from "./manuscript-replacement.js";
export { MIGRATION_DIRECTORY, MIGRATION_ERRORS } from "./migration-state.js";
import {
  assertKnownVersion,
  assertMigrationReadable,
  migrationError,
} from "./migration-state.js";
import {
  BookMetadataSchema,
  ChapterFileSchema,
  ChapterFileV2Schema,
  ChapterSummaryCacheSchema,
  CountedChapterSummarySchema,
  ProjectConfigSchema,
  ProjectConfigV2Schema,
  ProjectFormatCurrentSchema,
  ProjectFormatV2Schema,
  EditorialStateSchema,
  type BookMetadata,
  type ChapterSummaryCache,
  type CountedChapterSummary,
  type ProjectConfig,
} from "@drelwick/project-model";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const PROJECT_DIRECTORIES = [
  "manuscript",
  "frontmatter",
  "backmatter",
  "assets",
  "reference",
  "styles",
  ".history",
] as const;

export type ProjectDirectory = (typeof PROJECT_DIRECTORIES)[number];

export const CHAPTER_SUMMARY_CACHE_FILE = ".chapter-summaries.json";

export interface ProjectLoadingFileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  writeJson(path: string, value: unknown): Promise<void>;
}

const defaultProjectLoadingFileSystem: ProjectLoadingFileSystem = {
  readFile,
  lstat,
  realpath,
  writeJson: writeJsonAtomically,
};

export interface OpenedProject extends CreatedProject {
  chapters: CountedChapterSummary[];
}

export interface OpenProjectOptions {
  rebuildSummaries?: boolean;
}

/** Opens metadata and summaries; cold/stale cache entries are rebuilt sequentially. */
export async function openProject(
  projectPath: string,
  options: OpenProjectOptions = {},
  fileSystem: ProjectLoadingFileSystem = defaultProjectLoadingFileSystem,
): Promise<OpenedProject> {
  await assertReplacementReadable(projectPath);
  return loadProjectFiles(projectPath, options, fileSystem, true);
}

/** Full, read-only validation for snapshots and migration. Never activates an editor. */
export async function validateProjectFiles(
  projectPath: string,
): Promise<OpenedProject> {
  return loadProjectFiles(
    projectPath,
    { rebuildSummaries: true },
    {
      ...defaultProjectLoadingFileSystem,
      writeJson: async () => undefined,
    },
    false,
  );
}

async function loadProjectFiles(
  projectPath: string,
  options: OpenProjectOptions,
  fileSystem: ProjectLoadingFileSystem,
  guardMigration: boolean,
): Promise<OpenedProject> {
  if (!isAbsolute(projectPath)) {
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path",
    );
  }
  let projectRoot: string;
  try {
    projectRoot = await fileSystem.realpath(projectPath);
  } catch {
    throw new ApplicationError(
      "PROJECT_PATH_ACCESS_FAILED",
      "Unable to access project folder",
    );
  }

  // Validate every path component before reading; never follow a project child symlink.
  async function inspect(relativePath: string): Promise<Stats> {
    const parts = relativePath.split("/");
    let path = projectRoot;
    let stats: Stats | undefined;
    for (const [index, part] of parts.entries()) {
      path = join(path, part);
      try {
        stats = await fileSystem.lstat(path);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new ApplicationError(
            "PROJECT_FILE_MISSING",
            `Missing required project file: ${relativePath}`,
          );
        }
        throw new ApplicationError(
          "PROJECT_FILE_READ_FAILED",
          `Unable to access project file: ${relativePath}`,
        );
      }
      if (
        stats.isSymbolicLink() ||
        (index < parts.length - 1 ? !stats.isDirectory() : !stats.isFile())
      ) {
        throw new ApplicationError(
          "PROJECT_PATH_INVALID",
          `Expected a regular project file: ${relativePath}`,
        );
      }
    }
    if (!stats)
      throw new ApplicationError("PROJECT_PATH_INVALID", "Empty project path");
    return stats;
  }

  async function readJson(relativePath: string): Promise<unknown> {
    await inspect(relativePath);
    let source: string;
    try {
      source = await fileSystem.readFile(
        resolveProjectPath(projectRoot, relativePath),
        "utf8",
      );
    } catch {
      throw new ApplicationError(
        "PROJECT_FILE_READ_FAILED",
        `Unable to read project file: ${relativePath}`,
      );
    }
    try {
      return JSON.parse(source) as unknown;
    } catch {
      // Parser errors can contain source text; do not retain them as causes.
      throw new ApplicationError(
        "PROJECT_JSON_INVALID",
        `Invalid JSON in project file: ${relativePath}`,
      );
    }
  }

  const rawProject = await readJson("project.json");
  assertKnownVersion(rawProject, 3);
  const migration = guardMigration
    ? await assertMigrationReadable(projectRoot, fileSystem)
    : null;
  const parsedProject = ProjectConfigSchema.safeParse(rawProject);
  if (!parsedProject.success) {
    const invalidOrder = parsedProject.error.issues.some(
      (issue) => issue.path[0] === "manuscript",
    );
    throw new ApplicationError(
      invalidOrder ? "PROJECT_ORDER_INVALID" : "PROJECT_SCHEMA_INVALID",
      invalidOrder
        ? "Invalid manuscript chapter order in project.json"
        : "Invalid project configuration in project.json",
    );
  }
  const project = parsedProject.data;
  if (
    migration &&
    (project.schemaVersion < 2 ||
      project.schemaVersion > 3 ||
      project.projectId !== migration.projectId)
  )
    throw migrationError("MIGRATION_STATE_INVALID");
  if (project.schemaVersion === 2 || project.schemaVersion === 3) {
    const rawFormat = await readJson(project.formatFile);
    assertKnownVersion(rawFormat, project.schemaVersion === 3 ? 2 : 1);
    if (project.schemaVersion === 3) {
      const editorial = EditorialStateSchema.safeParse(
        await readJson(project.editorialFile),
      );
      if (
        !editorial.success ||
        editorial.data.projectId !== project.projectId ||
        editorial.data.generation !== project.generation
      )
        throw new ApplicationError(
          "PROJECT_SCHEMA_INVALID",
          "Invalid editorial state.",
        );
      const formatV2 = ProjectFormatV2Schema.safeParse(rawFormat);
      if (!formatV2.success || formatV2.data.projectId !== project.projectId)
        throw new ApplicationError(
          "PROJECT_SCHEMA_INVALID",
          "Invalid project format descriptor.",
        );
    }
    if (typeof rawFormat === "object" && rawFormat !== null) {
      for (const key of [
        "bookSchemaVersion",
        "chapterSchemaVersion",
      ] as const) {
        assertKnownVersion(
          {
            schemaVersion:
              key in rawFormat
                ? rawFormat[key as keyof typeof rawFormat]
                : undefined,
          },
          project.schemaVersion === 3 && key === "chapterSchemaVersion" ? 2 : 1,
        );
      }
    }
    const format = ProjectFormatCurrentSchema.safeParse(rawFormat);
    if (!format.success || format.data.projectId !== project.projectId)
      throw new ApplicationError(
        "PROJECT_SCHEMA_INVALID",
        "Invalid project format descriptor.",
      );
  }
  const rawBook = await readJson(project.bookFile);
  assertKnownVersion(rawBook, 1);
  const parsedBook = BookMetadataSchema.safeParse(rawBook);
  if (!parsedBook.success) {
    throw new ApplicationError(
      "PROJECT_SCHEMA_INVALID",
      "Invalid book metadata in book.json",
    );
  }

  let cache: ChapterSummaryCache | undefined;
  if (!options.rebuildSummaries) {
    try {
      const parsed = ChapterSummaryCacheSchema.safeParse(
        await readJson(CHAPTER_SUMMARY_CACHE_FILE),
      );
      if (parsed.success && parsed.data.projectId === project.projectId)
        cache = parsed.data;
    } catch {
      // Optional cache failures must not prevent recovery from authoritative files.
    }
  }
  const cachedEntries = new Map(
    cache?.entries.map((entry) => [entry.summary.id, entry]),
  );
  const entries: ChapterSummaryCache["entries"] = [];
  const editorialChapters: import("@drelwick/project-model").ChapterFileV2[] =
    [];
  for (const id of project.manuscript.order) {
    const relativePath = `manuscript/${id}.json`;
    let before: Stats;
    try {
      before = await inspect(relativePath);
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        error.code === "PROJECT_FILE_MISSING"
      ) {
        throw new ApplicationError(
          "PROJECT_ORDER_INVALID",
          `Manuscript order references missing chapter: ${id}`,
        );
      }
      throw error;
    }
    const cached = cachedEntries.get(id);
    if (
      project.schemaVersion !== 3 &&
      cached &&
      sameFingerprint(cached, before)
    ) {
      entries.push(cached);
      continue;
    }
    const rawChapter = await readJson(relativePath);
    assertKnownVersion(rawChapter, project.schemaVersion === 3 ? 2 : 1);
    const parsed =
      project.schemaVersion === 3
        ? ChapterFileV2Schema.safeParse(rawChapter)
        : ChapterFileSchema.safeParse(rawChapter);
    if (!parsed.success) {
      throw new ApplicationError(
        "PROJECT_SCHEMA_INVALID",
        `Invalid chapter in ${relativePath}`,
      );
    }
    if (parsed.data.id !== id) {
      throw new ApplicationError(
        "PROJECT_ORDER_INVALID",
        `Chapter ID does not match manuscript order: ${id}`,
      );
    }
    if (project.schemaVersion === 3)
      editorialChapters.push(
        parsed.data as import("@drelwick/project-model").ChapterFileV2,
      );
    if (!sameFingerprint(before, await inspect(relativePath))) {
      throw new ApplicationError(
        "PROJECT_CHANGED_DURING_OPEN",
        "A chapter changed while opening the project; retry opening",
      );
    }
    entries.push({
      size: before.size,
      mtimeMs: before.mtimeMs,
      ctimeMs: before.ctimeMs,
      summary: CountedChapterSummarySchema.parse({
        ...parsed.data,
        schemaVersion: 1,
        wordCount: countDocumentWords(parsed.data.content),
      }),
    });
  }
  if (project.schemaVersion === 3) {
    const rawEditorial = await readJson(project.editorialFile);
    const editorial = EditorialStateSchema.parse(rawEditorial);
    const { validateEditorialBundle } = await import("./editorial-bundle.js");
    validateEditorialBundle({
      projectId: project.projectId,
      generation: project.generation,
      chapterOrder: project.manuscript.order,
      chapters: editorialChapters,
      state: editorial,
    });
  }
  const nextCache: ChapterSummaryCache = {
    schemaVersion: 1,
    projectId: project.projectId,
    entries,
  };
  if (JSON.stringify(cache) !== JSON.stringify(nextCache)) {
    try {
      await fileSystem.writeJson(
        resolveProjectPath(projectRoot, CHAPTER_SUMMARY_CACHE_FILE),
        nextCache,
      );
    } catch {
      // Opening read-only projects remains useful; the next open can rebuild again.
    }
  }
  return {
    projectPath: projectRoot,
    project,
    book: parsedBook.data,
    chapters: entries.map((entry) => entry.summary),
  };
}

function sameFingerprint(
  left: { size: number; mtimeMs: number; ctimeMs: number },
  right: { size: number; mtimeMs: number; ctimeMs: number },
): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export interface AtomicWriterFileSystem {
  open(path: string, flags: "wx"): Promise<FileHandle>;
  rename(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface ProjectCreationFileSystem {
  pathExists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  writeJson(path: string, value: unknown): Promise<void>;
  remove(path: string): Promise<void>;
}

const defaultAtomicWriterFileSystem: AtomicWriterFileSystem = {
  open,
  rename,
  unlink,
};

const defaultProjectCreationFileSystem: ProjectCreationFileSystem = {
  pathExists: projectPathExists,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readdir: async (path) => readdir(path),
  writeJson: writeJsonAtomically,
  remove: async (path) => {
    await import("node:fs/promises").then(({ rm }) =>
      rm(path, { recursive: true, force: true }),
    );
  },
};

export function resolveProjectPath(
  projectRoot: string,
  relativePath: string,
): string {
  if (!isAbsolute(projectRoot) || !isSafeRelativePath(relativePath)) {
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project paths must use an absolute root and safe relative child path",
    );
  }

  return resolve(projectRoot, joinSafeRelativePath(relativePath));
}

export async function createProjectLayout(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) {
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path",
    );
  }

  try {
    await mkdir(projectRoot, { recursive: true });
    const existingEntries = await readdir(projectRoot);
    if (existingEntries.length > 0) {
      throw new ApplicationError(
        "PROJECT_DESTINATION_NOT_EMPTY",
        "Project destination must be empty",
      );
    }

    await Promise.all(
      PROJECT_DIRECTORIES.map((directory) =>
        mkdir(resolveProjectPath(projectRoot, directory), { recursive: true }),
      ),
    );
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Unknown filesystem error";
    throw new ApplicationError(
      "PROJECT_LAYOUT_CREATE_FAILED",
      `Unable to create project directory structure: ${message}`,
      { cause: error },
    );
  }
}

export async function projectPathExists(projectRoot: string): Promise<boolean> {
  try {
    await access(projectRoot);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw new ApplicationError(
      "PROJECT_PATH_ACCESS_FAILED",
      "Unable to access project path",
      { cause: error },
    );
  }
}

export function projectDirectoryPath(
  projectRoot: string,
  directory: ProjectDirectory,
): string {
  return resolveProjectPath(projectRoot, directory);
}

export async function writeJsonAtomically(
  filePath: string,
  value: unknown,
  fileSystem: AtomicWriterFileSystem = defaultAtomicWriterFileSystem,
): Promise<void> {
  await writeJsonAtomicallyAt(filePath, `${filePath}.tmp`, value, fileSystem);
}

export async function writeJsonAtomicallyAt(
  filePath: string,
  temporaryPath: string,
  value: unknown,
  fileSystem: AtomicWriterFileSystem = defaultAtomicWriterFileSystem,
): Promise<void> {
  let fileHandle: FileHandle | undefined;
  let ownsTemporaryFile = false;

  try {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    fileHandle = await fileSystem.open(temporaryPath, "wx");
    ownsTemporaryFile = true;
    await fileHandle.writeFile(serialized, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await fileSystem.rename(temporaryPath, filePath);
  } catch (error) {
    if (fileHandle) {
      await fileHandle.close();
    }

    try {
      if (ownsTemporaryFile) await fileSystem.unlink(temporaryPath);
    } catch (cleanupError) {
      if (
        !(cleanupError instanceof Error) ||
        !("code" in cleanupError) ||
        cleanupError.code !== "ENOENT"
      ) {
        throw new ApplicationError(
          "PROJECT_TEMPORARY_FILE_CLEANUP_FAILED",
          "Unable to clean up temporary project file",
          { cause: cleanupError },
        );
      }
    }

    throw new ApplicationError(
      "PROJECT_FILE_WRITE_FAILED",
      `Unable to atomically write project file: ${
        error instanceof Error ? error.message : "Unknown filesystem error"
      }`,
      { cause: error },
    );
  }
}

export interface CreateProjectInput {
  title: string;
  author: string;
  language: string;
  projectPath: string;
}

export interface CreatedProject {
  projectPath: string;
  project: ProjectConfig;
  book: BookMetadata;
}

export async function createProject(
  input: CreateProjectInput,
  fileSystem: ProjectCreationFileSystem = defaultProjectCreationFileSystem,
): Promise<CreatedProject> {
  if (!isAbsolute(input.projectPath)) {
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path",
    );
  }

  const projectRoot = resolve(input.projectPath);
  const rootExisted = await fileSystem.pathExists(projectRoot);
  const createdPaths: string[] = [];

  try {
    await fileSystem.mkdir(projectRoot);
    if (!rootExisted) {
      createdPaths.push(projectRoot);
    }

    const existingEntries = await fileSystem.readdir(projectRoot);
    if (existingEntries.length > 0) {
      throw new ApplicationError(
        "PROJECT_DESTINATION_NOT_EMPTY",
        "Project destination must be empty",
      );
    }

    for (const directory of PROJECT_DIRECTORIES) {
      const directoryPath = resolveProjectPath(projectRoot, directory);
      await fileSystem.mkdir(directoryPath);
      createdPaths.push(directoryPath);
    }

    const timestamp = createIsoDate();
    const project: ProjectConfig = ProjectConfigV2Schema.parse({
      schemaVersion: 2,
      formatFile: "format.json",
      projectId: createUuid(),
      created: timestamp,
      modified: timestamp,
      bookFile: "book.json",
      manuscript: { order: [] },
    });
    const book: BookMetadata = BookMetadataSchema.parse({
      schemaVersion: 1,
      title: input.title,
      author: input.author,
      language: input.language,
      created: timestamp,
      modified: timestamp,
    });

    const projectFilePath = join(projectRoot, "project.json");
    const bookFilePath = join(projectRoot, "book.json");
    await fileSystem.writeJson(projectFilePath, project);
    createdPaths.push(projectFilePath);
    await fileSystem.writeJson(bookFilePath, book);
    createdPaths.push(bookFilePath);
    const formatPath = join(projectRoot, "format.json");
    await fileSystem.writeJson(formatPath, {
      schemaVersion: 1,
      projectId: project.projectId,
      bookSchemaVersion: 1,
      chapterSchemaVersion: 1,
    });
    createdPaths.push(formatPath);

    return { projectPath: projectRoot, project, book };
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      createdPaths.reverse().map(async (path) => {
        await fileSystem.remove(path);
      }),
    );
    const cleanupFailure = cleanupResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (cleanupFailure) {
      throw new ApplicationError(
        "PROJECT_CREATE_CLEANUP_FAILED",
        "Project creation failed and cleanup was incomplete",
        { cause: cleanupFailure.reason },
      );
    }

    if (error instanceof ApplicationError) {
      throw error;
    }

    throw new ApplicationError(
      "PROJECT_CREATE_FAILED",
      `Unable to create project: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error },
    );
  }
}

export * from "./chapter-organisation.js";

export * from "./print-configuration.js";
export * from "./print-preflight.js";

export * from "./export-output.js";
