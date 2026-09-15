import {
  ApplicationError,
  createIsoDate,
  createUuid,
  isSafeRelativePath,
  joinSafeRelativePath,
} from "@bookeditor/shared";
export * from "./chapter-creation.js";
export * from "./chapter-rename.js";
import {
  BookMetadataSchema,
  ChapterFileSchema,
  ChapterSummaryCacheSchema,
  CountedChapterSummarySchema,
  ProjectConfigSchema,
  type BookMetadata,
  type ChapterSummaryCache,
  type CountedChapterSummary,
  type ProjectConfig,
} from "@bookeditor/project-model";
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
  assertSupportedVersion(rawProject, "project.json");
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
  const rawBook = await readJson(project.bookFile);
  assertSupportedVersion(rawBook, project.bookFile);
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
    if (cached && sameFingerprint(cached, before)) {
      entries.push(cached);
      continue;
    }
    const rawChapter = await readJson(relativePath);
    assertSupportedVersion(rawChapter, relativePath);
    const parsed = ChapterFileSchema.safeParse(rawChapter);
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
        wordCount: countDocumentWords(parsed.data.content),
      }),
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

function assertSupportedVersion(value: unknown, relativePath: string): void {
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number" &&
    value.schemaVersion !== 1
  ) {
    throw new ApplicationError(
      "PROJECT_SCHEMA_UNSUPPORTED",
      `Unsupported schema version in ${relativePath}; supported version is 1`,
    );
  }
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

function countDocumentWords(document: unknown): number {
  const fragments: string[] = [];
  const pending: unknown[] = [document];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === "\n") {
      fragments.push("\n");
      continue;
    }
    if (typeof node !== "object" || node === null) continue;
    if (
      "type" in node &&
      node.type === "text" &&
      "text" in node &&
      typeof node.text === "string"
    ) {
      fragments.push(node.text);
    } else if ("content" in node && Array.isArray(node.content)) {
      pending.push("\n");
      for (let index = node.content.length - 1; index >= 0; index--)
        pending.push(node.content[index]);
    } else {
      fragments.push("\n");
    }
  }
  return fragments.join("").match(/\S+/gu)?.length ?? 0;
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
  const temporaryPath = `${filePath}.tmp`;
  let fileHandle: FileHandle | undefined;

  try {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    fileHandle = await fileSystem.open(temporaryPath, "wx");
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
      await fileSystem.unlink(temporaryPath);
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
    const project: ProjectConfig = ProjectConfigSchema.parse({
      schemaVersion: 1,
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
