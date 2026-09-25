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
import { createHistorySnapshot, readHistorySnapshot } from "./history.js";

export interface SaveChapterInput {
  projectPath: string;
  chapterId: string;
  document: Record<string, unknown>;
  restore?: { snapshotId: string; fingerprint: string };
}

export interface SavedChapter {
  id: string;
  modified: string;
  warning?: string;
  restoredContent?: Record<string, unknown>;
}

export async function saveChapter(
  input: SaveChapterInput,
  overrides: {
    writeChapter?: typeof writeJsonAtomically;
    releaseLock?: typeof rmdir;
    snapshot?: typeof createHistorySnapshot;
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
    let content = document.data;
    let historicalTimestamp = 0;
    if (input.restore) {
      if (JSON.stringify(previous.content) !== JSON.stringify(document.data))
        throw new ApplicationError(
          "HISTORY_CURRENT_CHANGED",
          "The current chapter changed. Save your edits and refresh Chapter History before restoring.",
        );
      const selected = await readHistorySnapshot(
        root,
        input.chapterId,
        input.restore.snapshotId,
      );
      if (selected.fingerprint !== input.restore.fingerprint)
        throw new ApplicationError(
          "HISTORY_UNAVAILABLE",
          "The selected snapshot changed. Preview it again before restoring.",
        );
      const safety = await (overrides.snapshot ?? createHistorySnapshot)({
        projectPath: root,
        chapterId: input.chapterId,
        document: document.data,
        reason: "before-replace",
      });
      if (!safety)
        throw new ApplicationError(
          "HISTORY_SNAPSHOT_WRITE_FAILED",
          "Unable to preserve current content. Restore was cancelled.",
        );
      const verified = await readHistorySnapshot(
        root,
        input.chapterId,
        safety.id,
      );
      if (
        JSON.stringify(verified.snapshot.content) !==
        JSON.stringify(document.data)
      )
        throw new ApplicationError(
          "HISTORY_SNAPSHOT_WRITE_FAILED",
          "Unable to verify preserved content. Restore was cancelled.",
        );
      content = ManuscriptDocumentSchema.parse(selected.snapshot.content);
      historicalTimestamp = Date.parse(selected.snapshot.created);
    }
    const now = createIsoDate();
    const modified = input.restore
      ? new Date(
          Math.max(
            Date.parse(now),
            Date.parse(previous.modified),
            historicalTimestamp,
          ),
        ).toISOString()
      : now;
    const chapter = {
      ...(raw as Record<string, unknown>),
      content,
      modified,
    };
    ChapterFileSchema.parse(chapter);
    await (overrides.writeChapter ?? writeJsonAtomically)(path, chapter);
    // Rename is the commit point; cache refresh must never turn this into failure.
    result = {
      id: previous.id,
      modified,
      ...(input.restore ? { restoredContent: content } : {}),
    };
    return result;
  } catch (error) {
    if (
      (error instanceof ApplicationError &&
        [
          "CHAPTER_NOT_FOUND",
          "CHAPTER_DOCUMENT_INVALID",
          "CHAPTER_RECOVERY_REQUIRED",
          "PROJECT_PATH_INVALID",
        ].includes(error.code)) ||
      (error instanceof ApplicationError && error.code.startsWith("HISTORY_"))
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
