import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApplicationError, createIsoDate, createUuid } from "@sarel/shared";
import { ProjectConfigSchema, type ProjectConfig } from "@sarel/project-model";
import {
  CHAPTER_CREATION_LOCK,
  openProject,
  writeJsonAtomically,
  type OpenedProject,
  type ProjectLoadingFileSystem,
} from "./index.js";

export const CHAPTER_TRASH_DIRECTORY = ".history/deleted";

export interface DeleteChapterInput {
  projectPath: string;
  chapterId: string;
}

export interface DeletedChapter {
  chapterId: string;
  session: OpenedProject;
  trashPath: string;
  warning?: string;
}

export interface ChapterDeletionFileSystem extends ProjectLoadingFileSystem {
  mkdir(path: string, options?: { recursive: true }): Promise<unknown>;
  rmdir(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  writeManifest(path: string, project: ProjectConfig): Promise<void>;
}

const defaults: ChapterDeletionFileSystem = {
  lstat,
  readFile,
  realpath,
  mkdir,
  rmdir,
  rename,
  writeJson: writeJsonAtomically,
  writeManifest: writeJsonAtomically,
};

export async function deleteChapter(
  input: DeleteChapterInput,
  overrides: Partial<ChapterDeletionFileSystem> = {},
): Promise<DeletedChapter> {
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
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new ApplicationError(
        "PROJECT_BUSY",
        "Another chapter operation is in progress. Please try again.",
      );
    throw new ApplicationError(
      "CHAPTER_DELETE_FAILED",
      "Unable to acquire the chapter operation lock.",
    );
  }

  let result: DeletedChapter | undefined;
  let moved = false;
  let sourcePath = "";
  let trashPath = "";
  try {
    const session = await openProject(root, {}, fs);
    if (!session.project.manuscript.order.includes(input.chapterId))
      throw new ApplicationError(
        "CHAPTER_NOT_FOUND",
        "The selected chapter is no longer available.",
      );
    sourcePath = join(root, "manuscript", `${input.chapterId}.json`);
    trashPath = join(
      root,
      CHAPTER_TRASH_DIRECTORY,
      `${input.chapterId}-${createUuid()}.json`,
    );
    await fs.mkdir(join(root, CHAPTER_TRASH_DIRECTORY), { recursive: true });
    await fs.rename(sourcePath, trashPath);
    moved = true;

    const manifestPath = join(root, "project.json");
    const source = await fs.readFile(manifestPath, "utf8");
    const raw = JSON.parse(source) as unknown;
    const parsed = ProjectConfigSchema.safeParse(raw);
    if (
      !parsed.success ||
      JSON.stringify(parsed.data) !== JSON.stringify(session.project)
    )
      throw new ApplicationError(
        "PROJECT_CHANGED_DURING_DELETE",
        "The project changed during chapter deletion. The chapter was restored.",
      );
    const project: ProjectConfig = {
      ...parsed.data,
      modified: createIsoDate(),
      manuscript: {
        ...parsed.data.manuscript,
        order: parsed.data.manuscript.order.filter(
          (id) => id !== input.chapterId,
        ),
      },
    };
    await fs.writeManifest(manifestPath, project);
    const updatedSession = await openProject(root, {}, fs);
    result = { chapterId: input.chapterId, session: updatedSession, trashPath };
    return result;
  } catch (error) {
    if (moved) {
      try {
        await fs.rename(trashPath, sourcePath);
        moved = false;
      } catch {
        throw new ApplicationError(
          "CHAPTER_DELETE_RECOVERY_FAILED",
          "Chapter deletion failed and the chapter could not be restored. Preserve the project before retrying.",
        );
      }
    }
    if (
      error instanceof ApplicationError &&
      [
        "PROJECT_BUSY",
        "PROJECT_PATH_INVALID",
        "PROJECT_PATH_ACCESS_FAILED",
        "PROJECT_FILE_MISSING",
        "PROJECT_JSON_INVALID",
        "PROJECT_SCHEMA_INVALID",
        "PROJECT_SCHEMA_UNSUPPORTED",
        "PROJECT_ORDER_INVALID",
        "CHAPTER_NOT_FOUND",
        "PROJECT_CHANGED_DURING_DELETE",
      ].includes(error.code)
    )
      throw error;
    throw new ApplicationError(
      "CHAPTER_DELETE_FAILED",
      "Unable to delete the chapter. The original chapter was preserved.",
    );
  } finally {
    try {
      await fs.rmdir(lock);
    } catch {
      if (result)
        result.warning =
          "The chapter was deleted, but its operation lock could not be removed. Close other project processes and inspect the lock.";
    }
  }
}
