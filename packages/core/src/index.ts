import {
  ApplicationError,
  isSafeRelativePath,
  joinSafeRelativePath,
} from "@bookeditor/shared";
import { access, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

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

const defaultAtomicWriterFileSystem: AtomicWriterFileSystem = {
  open,
  rename,
  unlink,
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
