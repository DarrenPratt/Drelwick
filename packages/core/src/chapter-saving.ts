import { lstat, mkdir, readFile, realpath, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { ApplicationError, createIsoDate } from "@drelwick/shared";
import {
  ChapterFileSchema,
  ChapterFileV2Schema,
  EditorialStateSchema,
  ProjectConfigSchema,
  type EditorialState,
  ManuscriptDocumentSchema,
} from "@drelwick/project-model";
import {
  CHAPTER_CREATION_LOCK,
  loadChapter,
  writeJsonAtomically,
} from "./index.js";
import { createHistorySnapshot, readHistorySnapshot } from "./history.js";
import { commitEditorialTransaction } from "./editorial-transactions.js";
import { orphanEditorialAnchors } from "./editorial-anchors.js";

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
  const project = ProjectConfigSchema.safeParse(
    JSON.parse(await readFile(join(root, "project.json"), "utf8")) as unknown,
  );
  if (project.success && project.data.schemaVersion === 3)
    return saveEditorialChapter(root, input, document.data);
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

async function saveEditorialChapter(
  root: string,
  input: SaveChapterInput,
  content: Record<string, unknown>,
): Promise<SavedChapter> {
  const session = await import("./index.js").then(({ openProject }) =>
    openProject(root, { rebuildSummaries: true }),
  );
  if (
    session.project.schemaVersion !== 3 ||
    !session.project.manuscript.order.includes(input.chapterId)
  )
    throw new ApplicationError(
      "CHAPTER_NOT_FOUND",
      "The selected chapter is no longer available.",
    );
  const chapterPath = join(root, "manuscript", `${input.chapterId}.json`);
  const chapterBytes = await readFile(chapterPath);
  const previous = ChapterFileV2Schema.parse(
    JSON.parse(chapterBytes.toString("utf8")) as unknown,
  );
  if (previous.review.pending.length || previous.review.mode !== "off")
    throw new ApplicationError(
      "EDITORIAL_UNSUPPORTED",
      "Pending revisions require a newer compatible editor.",
    );
  let nextContent = content;
  if (input.restore) {
    if (JSON.stringify(previous.content) !== JSON.stringify(content))
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
    const safety = await createHistorySnapshot({
      projectPath: root,
      chapterId: input.chapterId,
      document: content,
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
    if (JSON.stringify(verified.snapshot.content) !== JSON.stringify(content))
      throw new ApplicationError(
        "HISTORY_SNAPSHOT_WRITE_FAILED",
        "Unable to verify preserved content. Restore was cancelled.",
      );
    nextContent = ManuscriptDocumentSchema.parse(selected.snapshot.content);
  }
  const stateBytes = await readFile(join(root, session.project.editorialFile));
  const state = EditorialStateSchema.parse(
    JSON.parse(stateBytes.toString("utf8")) as unknown,
  );
  if (
    state.generation !== session.project.generation ||
    state.projectId !== session.project.projectId
  )
    throw new ApplicationError(
      "EDITORIAL_STALE",
      "The project changed while saving. Your edits remain unsaved.",
    );
  const modified = createIsoDate();
  const nextChapter = ChapterFileV2Schema.parse({
    ...previous,
    modified,
    revision: previous.revision + 1,
    content: nextContent,
    review: {
      schemaVersion: 1,
      mode: "off",
      proposed: nextContent,
      pending: [],
    },
  });
  const affected = state.anchors.filter((anchor) =>
    anchor.segments.some((segment) => segment.chapterId === input.chapterId),
  );
  const nextState: EditorialState = {
    ...state,
    generation: state.generation + 1,
    anchors: input.restore
      ? orphanEditorialAnchors(
          state.anchors,
          input.chapterId,
          (anchor) => anchor.original,
          "history-restore",
        )
      : state.anchors.map((anchor) => {
          if (!affected.some((item) => item.id === anchor.id)) return anchor;
          return { ...anchor, modified, status: "unverified" };
        }),
  };
  const nextProject = {
    ...session.project,
    modified,
    generation: session.project.generation + 1,
  };
  await commitEditorialTransaction({
    projectPath: root,
    projectId: session.project.projectId,
    kind: "edit",
    expectedGeneration: session.project.generation,
    expectedBefore: {
      [`manuscript/${input.chapterId}.json`]: createHash("sha256")
        .update(chapterBytes)
        .digest("hex"),
      [session.project.editorialFile]: createHash("sha256")
        .update(stateBytes)
        .digest("hex"),
    },
    changes: [
      {
        path: `manuscript/${input.chapterId}.json`,
        after: Buffer.from(`${JSON.stringify(nextChapter, null, 2)}\n`),
      },
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
    id: nextChapter.id,
    modified,
    ...(affected.length
      ? {
          warning: input.restore
            ? "Affected annotations were orphaned by the history restore. Their original evidence is preserved; reattach them explicitly."
            : "Affected annotations are marked unverified and require explicit reattachment.",
        }
      : {}),
    ...(input.restore ? { restoredContent: nextContent } : {}),
  };
}
