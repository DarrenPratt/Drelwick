import {
  ApplicationError,
  isSafeRelativePath,
  joinSafeRelativePath,
} from "@bookeditor/shared";
import { access, mkdir, readdir } from "node:fs/promises";
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
