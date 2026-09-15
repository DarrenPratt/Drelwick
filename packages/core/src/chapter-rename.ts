import { lstat, mkdir, readFile, realpath, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApplicationError, createIsoDate } from "@bookeditor/shared";
import { ChapterFileSchema, type ChapterFile } from "@bookeditor/project-model";
import {
  CHAPTER_CREATION_LOCK,
  openProject,
  writeJsonAtomically,
  type OpenedProject,
  type ProjectLoadingFileSystem,
} from "./index.js";

export interface RenameChapterInput {
  projectPath: string;
  chapterId: string;
  title: string;
}

export interface RenamedChapter {
  chapter: ChapterFile;
  session: OpenedProject;
  warning?: string;
}

export interface ChapterRenameFileSystem extends ProjectLoadingFileSystem {
  mkdir(path: string): Promise<unknown>;
  rmdir(path: string): Promise<void>;
  writeChapter(path: string, chapter: ChapterFile): Promise<void>;
}

const defaults: ChapterRenameFileSystem = {
  lstat,
  readFile,
  realpath,
  mkdir,
  rmdir,
  writeJson: writeJsonAtomically,
  writeChapter: writeJsonAtomically,
};

export async function renameChapter(
  input: RenameChapterInput,
  overrides: Partial<ChapterRenameFileSystem> = {},
): Promise<RenamedChapter> {
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
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new ApplicationError(
        "PROJECT_BUSY",
        "Another chapter operation is in progress. Please try again.",
      );
    throw new ApplicationError(
      "CHAPTER_RENAME_FAILED",
      "Unable to acquire the chapter operation lock.",
    );
  }

  let result: RenamedChapter | undefined;
  try {
    const session = await openProject(root, {}, fs);
    if (!session.project.manuscript.order.includes(input.chapterId))
      throw new ApplicationError(
        "CHAPTER_NOT_FOUND",
        "The selected chapter is no longer available.",
      );

    const chapterPath = join(root, "manuscript", `${input.chapterId}.json`);
    const raw = JSON.parse(await fs.readFile(chapterPath, "utf8")) as unknown;
    const parsed = ChapterFileSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== input.chapterId)
      throw new ApplicationError(
        "PROJECT_SCHEMA_INVALID",
        "The selected chapter has an invalid format.",
      );

    const chapter = ChapterFileSchema.parse({
      ...parsed.data,
      title: input.title.trim(),
      modified: createIsoDate(),
    });
    await fs.writeChapter(chapterPath, chapter);
    const updatedSession = await openProject(root, {}, fs);
    result = { chapter, session: updatedSession };
    return result;
  } catch (error) {
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
      ].includes(error.code)
    )
      throw error;
    throw new ApplicationError(
      "CHAPTER_RENAME_FAILED",
      "Unable to rename the chapter. The previous chapter file was preserved.",
    );
  } finally {
    try {
      await fs.rmdir(lock);
    } catch {
      if (result)
        result.warning =
          "The chapter was renamed, but its operation lock could not be removed. Close other project processes and inspect the lock before trying again.";
    }
  }
}
