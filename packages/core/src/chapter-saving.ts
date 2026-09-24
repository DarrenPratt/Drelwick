import { lstat, mkdir, readFile, realpath, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApplicationError, createIsoDate } from "@drelwick/shared";
import {
  ChapterFileSchema,
  ManuscriptDocumentSchema,
} from "@drelwick/project-model";
import {
  CHAPTER_CREATION_LOCK,
  loadChapter,
  writeJsonAtomically,
} from "./index.js";

export interface SaveChapterInput {
  projectPath: string;
  chapterId: string;
  document: Record<string, unknown>;
}

export interface SavedChapter {
  id: string;
  modified: string;
  warning?: string;
}

export async function saveChapter(
  input: SaveChapterInput,
  overrides: {
    writeChapter?: typeof writeJsonAtomically;
    releaseLock?: typeof rmdir;
  } = {},
): Promise<SavedChapter> {
  const document = ManuscriptDocumentSchema.safeParse(input.document);
  if (!document.success)
    throw new ApplicationError(
      "CHAPTER_DOCUMENT_INVALID",
      "The chapter document has an unsupported or invalid structure.",
    );
  if (!isAbsolute(input.projectPath))
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  let root: string;
  try {
    root = await realpath(input.projectPath);
  } catch {
    throw new ApplicationError(
      "PROJECT_PATH_ACCESS_FAILED",
      "Unable to access project folder.",
    );
  }
  const lock = join(root, CHAPTER_CREATION_LOCK);
  try {
    await mkdir(lock);
  } catch {
    throw new ApplicationError(
      "PROJECT_BUSY",
      "Unable to acquire the chapter operation lock. Check the project folder before retrying.",
    );
  }
  let result: SavedChapter | undefined;
  try {
    // Membership and every path component are validated before reading/writing.
    await loadChapter({ projectPath: root, chapterId: input.chapterId });
    const path = join(root, "manuscript", `${input.chapterId}.json`);
    const source = await readFile(path, "utf8");
    const raw: unknown = JSON.parse(source);
    const previous = ChapterFileSchema.parse(raw);
    if (
      previous.id !== input.chapterId ||
      !ManuscriptDocumentSchema.safeParse(previous.content).success
    )
      throw new ApplicationError(
        "CHAPTER_DOCUMENT_INVALID",
        "The chapter document has an unsupported or invalid structure.",
      );
    // A stale temporary file may contain recoverable work. Do not overwrite it.
    try {
      await lstat(`${path}.tmp`);
      throw new ApplicationError(
        "CHAPTER_RECOVERY_REQUIRED",
        "A temporary chapter file exists. Preserve it for recovery before retrying.",
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const modified = createIsoDate();
    const chapter = {
      ...(raw as Record<string, unknown>),
      content: document.data,
      modified,
    };
    ChapterFileSchema.parse(chapter);
    await (overrides.writeChapter ?? writeJsonAtomically)(path, chapter);
    // Rename is the commit point; cache refresh must never turn this into failure.
    result = { id: previous.id, modified };
    return result;
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      [
        "CHAPTER_NOT_FOUND",
        "CHAPTER_DOCUMENT_INVALID",
        "CHAPTER_RECOVERY_REQUIRED",
        "PROJECT_PATH_INVALID",
      ].includes(error.code)
    )
      throw error;
    throw new ApplicationError(
      "CHAPTER_SAVE_FAILED",
      "Unable to save the chapter. The previous chapter file was preserved.",
    );
  } finally {
    try {
      await (overrides.releaseLock ?? rmdir)(lock);
    } catch {
      if (result)
        result.warning =
          "The chapter was saved, but its operation lock could not be removed. Inspect the project lock before saving again.";
    }
  }
}
