import {
  ApplicationError,
  createIsoDate,
  createUuid,
  isSafeRelativePath,
  joinSafeRelativePath,
} from "@bookeditor/shared";
import {
  BookMetadataSchema,
  ProjectConfigSchema,
  type BookMetadata,
  type ProjectConfig,
} from "@bookeditor/project-model";
import { access, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
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
