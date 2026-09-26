import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import {
  createProjectArchive,
  assembleBook,
  loadPublication,
  savePublication,
  replacePublicationCover,
  loadBookTheme,
  saveBookTheme,
  importImageAsset,
  readImageAsset,
  createProject,
  createChapter,
  deleteChapter,
  loadChapter,
  saveChapter,
  listHistorySnapshots,
  readHistorySnapshot,
  replaceManuscript,
  organiseChapter,
  openProject,
  openProjectForEditing,
  MIGRATION_ERRORS,
  reorderChapters,
  restoreProjectArchive,
  renameChapter,
  type ReorderChaptersInput,
  type RenameChapterInput,
} from "@drelwick/core";
import {
  ApplicationError,
  createUuid,
  CreateProjectRequestSchema,
  IPC,
  IpcRequestSchemas,
  ReplacementReceiptSchema,
  noopLogger,
  safeErrorContext,
  type ProjectLocation,
  type ProjectOperationResult,
  type ProjectWorkspace,
  type SafeLogger,
} from "@drelwick/shared";
import type { RecentProjects } from "../recent-projects.js";
import { HistoryRuntime } from "../history-runtime.js";
import {
  prepareBookPreview,
  presentBookPreview,
  type PreparedBookPreview,
} from "../book-preview.js";
import { basename, dirname, join } from "node:path";

interface HistoryTasks {
  scheduleSnapshot(input: {
    projectPath: string;
    projectId: string;
    chapterId: string;
    document: Record<string, unknown>;
  }): void;
  scheduleRetention(input: { projectPath: string; projectId: string }): void;
  settleProject(projectPath: string): Promise<void>;
  closeProject(projectPath: string): Promise<void>;
  settleAll(): Promise<void>;
  shutdown(): Promise<void>;
}

interface Dependencies {
  selectImage(window: BrowserWindow): Promise<string | null>;
  importImage: typeof importImageAsset;
  readImage: typeof readImageAsset;
  startupBlocked(): boolean;
  selectFolder(window: BrowserWindow): Promise<string | null>;
  create: typeof createProject;
  createChapter: typeof createChapter;
  selectExistingFolder(window: BrowserWindow): Promise<string | null>;
  selectBackupDestination(
    window: BrowserWindow,
    projectPath: string,
  ): Promise<string | null>;
  selectBackupArchive(window: BrowserWindow): Promise<string | null>;
  selectRestoreParent(window: BrowserWindow): Promise<string | null>;
  createArchive: typeof createProjectArchive;
  restoreArchive: typeof restoreProjectArchive;
  open: (path: string) => ReturnType<typeof openProject>;
  rename: typeof renameChapter;
  delete: typeof deleteChapter;
  loadChapter: typeof loadChapter;
  saveChapter: typeof saveChapter;
  reorder: typeof reorderChapters;
  recents?: RecentProjects;
  logger: SafeLogger;
  history?: HistoryTasks;
}

const dependencies: Dependencies = {
  selectImage: async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Import a local image",
      buttonLabel: "Import image",
      properties: ["openFile"],
      filters: [
        { name: "PNG and JPEG images", extensions: ["png", "jpg", "jpeg"] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  importImage: importImageAsset,
  readImage: readImageAsset,
  startupBlocked: () => false,
  selectFolder: async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose an empty folder for your book",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  create: createProject,
  createChapter,
  selectExistingFolder: async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Open a Drelwick project",
      buttonLabel: "Open project",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  selectBackupDestination: async (window, projectPath) => {
    const result = await dialog.showSaveDialog(window, {
      title: "Back Up Drelwick Project",
      buttonLabel: "Create backup",
      defaultPath: join(
        dirname(projectPath),
        `${basename(projectPath)}.drelwick.zip`,
      ),
      filters: [{ name: "Drelwick project backup", extensions: ["zip"] }],
    });
    return result.canceled ? null : result.filePath;
  },
  selectBackupArchive: async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose a Drelwick project backup",
      buttonLabel: "Choose backup",
      properties: ["openFile"],
      filters: [{ name: "Drelwick project backup", extensions: ["zip"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  selectRestoreParent: async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose where to restore the project",
      buttonLabel: "Restore here",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  createArchive: createProjectArchive,
  restoreArchive: restoreProjectArchive,
  open: openProjectForEditing,
  rename: renameChapter,
  delete: deleteChapter,
  loadChapter,
  saveChapter,
  reorder: reorderChapters,
  logger: noopLogger,
};

const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
});

function backupFailure(error: unknown): ProjectOperationResult<never> {
  if (error instanceof ApplicationError) {
    const messages: Record<string, string> = {
      PROJECT_ARCHIVE_IN_PROJECT:
        "Choose a backup location outside the open project folder.",
      PROJECT_ARCHIVE_SYMLINK:
        "The project or backup contains a symbolic link. Remove it and try again.",
      PROJECT_ARCHIVE_CHANGED:
        "The project changed while the backup was being created. Save and try again.",
      PROJECT_ARCHIVE_TOO_LARGE:
        "The project or backup exceeds the supported size limit.",
      PROJECT_ARCHIVE_TOO_MANY_FILES:
        "The project contains more files than the backup format supports.",
      PROJECT_ARCHIVE_INVALID:
        "This file is not a valid Drelwick project backup.",
      PROJECT_ARCHIVE_PATH_INVALID:
        "The selected path or a path in the backup is unsafe or unavailable.",
      PROJECT_ARCHIVE_CHECKSUM_INVALID:
        "A backup file failed its integrity check. No project was restored.",
      PROJECT_ARCHIVE_DESTINATION_IN_PROJECT:
        "Choose a restore location outside all existing Drelwick project folders.",
      PROJECT_ARCHIVE_DISK_SPACE:
        "There is not enough disk space to complete the operation. Free space and try again.",
      PROJECT_ARCHIVE_READ_FAILED:
        "Unable to read the selected backup. Check its location and try again.",
      PROJECT_ARCHIVE_CREATE_FAILED:
        "Unable to create the backup. Check folder permissions and available disk space.",
      PROJECT_ARCHIVE_RESTORE_FAILED:
        "Unable to restore the backup. Check folder permissions and disk space; no existing project was replaced.",
      PROJECT_FILE_MISSING:
        "The open project is incomplete. Restore its missing project files before backing it up.",
      PROJECT_JSON_INVALID:
        "The open project contains invalid JSON. Repair or restore it before backing it up.",
      PROJECT_SCHEMA_INVALID:
        "The open project has an invalid format. Repair or restore it before backing it up.",
      PROJECT_SCHEMA_UNSUPPORTED:
        "This project format cannot be backed up by this version of Drelwick.",
      PROJECT_ORDER_INVALID:
        "The manuscript chapter order is invalid. Repair the project before backing it up.",
    };
    return failure(
      error.code,
      Object.hasOwn(messages, error.code)
        ? messages[error.code]!
        : "Unable to complete the project backup operation. Check the project and try again.",
    );
  }
  return failure(
    "PROJECT_ARCHIVE_FAILED",
    "Unable to complete the project backup operation. Check folder permissions and available disk space.",
  );
}

/** Folder grants belong to the trusted top-level frame and are never renderer paths. */
export function registerProjectHandlers(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl: string,
  overrides: Partial<Dependencies> = {},
): {
  authorizeImport(
    event: IpcMainInvokeEvent,
    operationId: string,
    path: string,
    projectId: string,
  ): void;
  settleHistory(): Promise<void>;
  stopHistory(): Promise<void>;
} {
  const services = { ...dependencies, ...overrides };
  const history =
    services.history ?? new HistoryRuntime({ logger: services.logger });
  let location:
    | { owner: IpcMainInvokeEvent["senderFrame"]; token: string; path: string }
    | undefined;
  let busy = false;
  let replacementCancellation: { cancelled: boolean } | undefined;
  let activeProjectPath: string | undefined;
  let activeProjectId: string | undefined;
  let preparedPreview: PreparedBookPreview | undefined;
  // Foreground preview actions wait for a read-only currency check rather than
  // failing when focus returns from the iframe and starts that check first.
  let previewStatusSettled = Promise.resolve();
  const trusted = (event: IpcMainInvokeEvent) => {
    const window = getWindow();
    return (
      !services.startupBlocked() &&
      window &&
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame?.url === rendererUrl
    );
  };

  for (const channel of [
    IPC.PUBLICATION_GET,
    IPC.PUBLICATION_SAVE,
    IPC.PUBLICATION_COVER,
  ] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[channel].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Invalid publication request.");
      if (!activeProjectPath || parsed.data.projectId !== activeProjectId)
        return failure(
          "PROJECT_NOT_OPEN",
          "Reopen the project before editing publication settings.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Wait for the current operation and retry.",
        );
      busy = true;
      try {
        await history.settleProject(activeProjectPath);
        let value;
        if (channel === IPC.PUBLICATION_GET)
          value = await loadPublication(
            activeProjectPath,
            parsed.data.projectId,
          );
        else if (channel === IPC.PUBLICATION_SAVE)
          value = await savePublication({
            ...IpcRequestSchemas[IPC.PUBLICATION_SAVE].parse(payload),
            projectPath: activeProjectPath,
          });
        else {
          const sourcePath = await services.selectImage(getWindow()!);
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project access is not permitted.",
            );
          if (!sourcePath) return { ok: true, value: null };
          value = await replacePublicationCover({
            ...IpcRequestSchemas[IPC.PUBLICATION_COVER].parse(payload),
            projectPath: activeProjectPath,
            sourcePath,
          });
        }
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        preparedPreview = undefined;
        return { ok: true, value };
      } catch (error) {
        return failure(
          error instanceof ApplicationError ? error.code : "PUBLICATION_FAILED",
          "Publication changes could not finish. Your edits and previous saved data are preserved. Check project access or recovery files; reopen if another operation changed the publication.",
        );
      } finally {
        busy = false;
      }
    });
  }

  ipcMain.handle(IPC.BOOK_PREVIEW, async (event, payload: unknown) => {
    await previewStatusSettled;
    if (!trusted(event))
      return failure(
        "PROJECT_ACCESS_DENIED",
        "Project access is not permitted.",
      );
    const parsed = IpcRequestSchemas[IPC.BOOK_PREVIEW].safeParse(payload);
    if (!parsed.success)
      return failure("PROJECT_INPUT_INVALID", "Invalid preview request.");
    if (!activeProjectPath || parsed.data.projectId !== activeProjectId)
      return failure(
        "PROJECT_NOT_OPEN",
        "Reopen the project before previewing.",
      );
    if (busy)
      return failure(
        "PROJECT_BUSY",
        "Wait for the current project operation and retry.",
      );
    busy = true;
    try {
      await history.settleProject(activeProjectPath);
      const prepared = await prepareBookPreview(
        activeProjectPath,
        parsed.data.projectId,
      );
      const value = presentBookPreview(prepared);
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      preparedPreview = prepared;
      return { ok: true, value };
    } catch {
      // Do not forward filesystem errors, schema payloads or rendered prose.
      return failure(
        "BOOK_PREVIEW_FAILED",
        "Unable to preview the book. Save pending edits and resolve any project recovery or access problems before retrying.",
      );
    } finally {
      busy = false;
    }
  });

  for (const channel of [
    IPC.BOOK_PREVIEW_SIMULATE,
    IPC.BOOK_PREVIEW_STATUS,
  ] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (channel === IPC.BOOK_PREVIEW_SIMULATE) await previewStatusSettled;
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[channel].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Invalid preview request.");
      if (!activeProjectPath || parsed.data.projectId !== activeProjectId)
        return failure(
          "PROJECT_NOT_OPEN",
          "Reopen the project before previewing.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Wait for the current project operation and retry.",
        );
      if (
        !preparedPreview ||
        preparedPreview.projectId !== parsed.data.projectId ||
        preparedPreview.revision !== parsed.data.revision
      )
        return failure(
          "BOOK_PREVIEW_EXPIRED",
          "Refresh the preview to capture a new revision.",
        );
      busy = true;
      let statusFinished: (() => void) | undefined;
      if (channel === IPC.BOOK_PREVIEW_STATUS)
        previewStatusSettled = new Promise<void>((resolve) => {
          statusFinished = resolve;
        });
      try {
        if (channel === IPC.BOOK_PREVIEW_SIMULATE) {
          const request =
            IpcRequestSchemas[IPC.BOOK_PREVIEW_SIMULATE].parse(payload);
          return {
            ok: true,
            value: presentBookPreview(
              preparedPreview,
              preparedPreview.selection,
              request.simulation,
            ),
          };
        }
        await history.settleProject(activeProjectPath);
        // Comparison only: never replace the captured preview or mix its chapters
        // with current sources. Reuse the same consistent assembly boundary.
        const current = await assembleBook(activeProjectPath);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          value: {
            stale:
              current.book.revision !== preparedPreview.revision ||
              current.presentation.themeId !==
                preparedPreview.selection.savedThemeId,
          },
        };
      } catch {
        return failure(
          "BOOK_PREVIEW_FAILED",
          "Unable to check or present the captured preview. Refresh after resolving project recovery or access problems. Editing and saved data are preserved.",
        );
      } finally {
        busy = false;
        statusFinished?.();
      }
    });
  }

  for (const channel of [IPC.BOOK_THEME_GET, IPC.BOOK_THEME_SET] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      await previewStatusSettled;
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[channel].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Invalid theme request.");
      if (!activeProjectPath || parsed.data.projectId !== activeProjectId)
        return failure(
          "PROJECT_NOT_OPEN",
          "Reopen the project before changing its theme.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Wait for the current project operation and retry.",
        );
      busy = true;
      try {
        if (channel === IPC.BOOK_THEME_GET) {
          const value = await loadBookTheme(
            activeProjectPath,
            parsed.data.projectId,
          );
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project access is not permitted.",
            );
          return { ok: true, value };
        }
        const request = IpcRequestSchemas[IPC.BOOK_THEME_SET].parse(payload);
        if (
          request.previewRevision &&
          (preparedPreview?.projectId !== request.projectId ||
            preparedPreview.revision !== request.previewRevision)
        )
          return failure(
            "BOOK_PREVIEW_EXPIRED",
            "Close and reopen the preview before changing its theme.",
          );
        await history.settleProject(activeProjectPath);
        const saved = await saveBookTheme({
          projectPath: activeProjectPath,
          projectId: request.projectId,
          themeId: request.themeId,
        });
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        if (preparedPreview) preparedPreview.selection = saved.selection;
        return {
          ok: true,
          value: {
            selection: saved.selection,
            ...(request.previewRevision && preparedPreview
              ? {
                  preview: presentBookPreview(preparedPreview, saved.selection),
                }
              : {}),
          },
          ...(saved.warning ? { warning: saved.warning } : {}),
        };
      } catch {
        return failure(
          "BOOK_THEME_FAILED",
          "Unable to access book presentation settings. Existing settings and manuscript files were preserved. Check project access or recovery files before retrying.",
        );
      } finally {
        busy = false;
      }
    });
  }

  for (const channel of [
    IPC.HISTORY_LIST,
    IPC.HISTORY_PREVIEW,
    IPC.HISTORY_RESTORE,
  ] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[channel].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Invalid history request.");
      if (!activeProjectPath || parsed.data.projectId !== activeProjectId)
        return failure(
          "PROJECT_NOT_OPEN",
          "Reopen the project before accessing Chapter History.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Wait for the current project operation and try again.",
        );
      busy = true;
      try {
        const projectPath = activeProjectPath;
        // Stop old saved-content timers during restore, otherwise they could publish
        // pre-restore content after the commit with a newer recovery timestamp.
        if (channel === IPC.HISTORY_RESTORE)
          await history.closeProject(projectPath);
        else await history.settleProject(projectPath);
        const session = await openProject(projectPath);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        if (session.project.projectId !== parsed.data.projectId)
          return failure(
            "PROJECT_NOT_OPEN",
            "The project identity changed. Reopen it before continuing.",
          );
        const chapter = session.chapters.find(
          (entry) => entry.id === parsed.data.chapterId,
        );
        if (channel === IPC.HISTORY_LIST) {
          const listed = await listHistorySnapshots(
            projectPath,
            parsed.data.chapterId,
          );
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project access is not permitted.",
            );
          return {
            ok: true,
            value: {
              ...listed,
              chapterId: parsed.data.chapterId,
              title: chapter?.title ?? null,
            },
          };
        }
        if (channel === IPC.HISTORY_PREVIEW) {
          const selection =
            IpcRequestSchemas[IPC.HISTORY_PREVIEW].parse(payload);
          const selected = await readHistorySnapshot(
            projectPath,
            parsed.data.chapterId,
            selection.snapshotId,
          );
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project access is not permitted.",
            );
          return {
            ok: true,
            value: {
              content: selected.snapshot.content,
              fingerprint: selected.fingerprint,
            },
          };
        }
        if (!chapter)
          return failure(
            "CHAPTER_NOT_FOUND",
            "This chapter no longer exists. Its snapshots cannot be restored in place.",
          );
        const restore = IpcRequestSchemas[IPC.HISTORY_RESTORE].parse(payload);
        const saved = await services.saveChapter({
          projectPath,
          chapterId: parsed.data.chapterId,
          document: restore.document,
          restore: {
            snapshotId: restore.snapshotId,
            fingerprint: restore.fingerprint,
          },
        });
        history.scheduleRetention({
          projectPath,
          projectId: parsed.data.projectId,
        });
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          value: { id: saved.id, content: saved.restoredContent! },
          ...(saved.warning ? { warning: saved.warning } : {}),
        };
      } catch (error) {
        // Never serialize parser or filesystem errors containing manuscript data.
        const code =
          error instanceof ApplicationError ? error.code : "HISTORY_FAILED";
        const messages: Record<string, string> = {
          HISTORY_UNAVAILABLE:
            "This snapshot is missing, changed or unsupported. Refresh history and preview it again before restoring.",
          HISTORY_CURRENT_CHANGED:
            "The chapter changed since your edits were saved. Close history and reload the chapter before restoring; your current edits are retained.",
          HISTORY_SNAPSHOT_WRITE_FAILED:
            "Unable to preserve the current chapter in a safety snapshot. Restore was cancelled. Check disk space and permissions, then retry.",
          CHAPTER_NOT_FOUND:
            "This chapter no longer exists. Its history cannot be restored in place.",
          CHAPTER_RECOVERY_REQUIRED:
            "A temporary chapter file needs recovery. Restore was cancelled. Preserve the project and recovery files before retrying.",
          CHAPTER_SAVE_FAILED:
            "Unable to persist the restored chapter. Your current edits and safety snapshot remain available. Check disk space and permissions before retrying.",
        };
        return failure(
          code,
          Object.hasOwn(messages, code)
            ? messages[code]!
            : "Chapter History could not complete the operation. Current edits remain available; check project access, refresh history and retry. Preserve any recovery files if saving remains blocked.",
        );
      } finally {
        busy = false;
      }
    });
  }

  for (const channel of [IPC.IMAGE_IMPORT, IPC.IMAGE_READ] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[channel].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Invalid image request.");
      if (!activeProjectPath || parsed.data.projectId !== activeProjectId)
        return failure(
          "PROJECT_NOT_OPEN",
          "Reopen the project before accessing images.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "The project is busy. Retry after the current operation finishes.",
        );
      const projectPath = activeProjectPath;
      busy = true;
      try {
        if ("chapterId" in parsed.data) {
          await services.loadChapter({
            projectPath,
            chapterId: parsed.data.chapterId,
          });
          const sourcePath = await services.selectImage(getWindow()!);
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project access is not permitted.",
            );
          if (!sourcePath) return { ok: true, value: null };
          const asset = await services.importImage({ projectPath, sourcePath });
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project access is not permitted.",
            );
          return { ok: true, value: { assetId: asset.id } };
        }
        const { asset, bytes } = await services.readImage(
          projectPath,
          parsed.data.assetId,
        );
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          value: {
            dataUrl: `data:${asset.mediaType};base64,${bytes.toString("base64")}`,
          },
        };
      } catch (error) {
        // Only fixed domain errors cross IPC; paths, bytes, alt text and causes never do.
        if (
          error instanceof ApplicationError &&
          error.code.startsWith("IMAGE_")
        )
          return failure(error.code, error.message);
        return failure(
          "IMAGE_OPERATION_FAILED",
          "Unable to access the image. Existing manuscript and images were preserved. Retry after checking the project.",
        );
      } finally {
        busy = false;
      }
    });
  }

  let imported:
    | {
        operationId: string;
        owner: IpcMainInvokeEvent["senderFrame"];
        path: string;
        projectId: string;
      }
    | undefined;
  for (const channel of [
    IPC.PROJECT_OPEN,
    IPC.RECENT_OPEN,
    IPC.IMPORT_OPEN,
  ] as const)
    ipcMain.handle(
      channel,
      async (
        event,
        payload: unknown,
      ): Promise<ProjectOperationResult<ProjectWorkspace | null>> => {
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        const parsed = IpcRequestSchemas[channel].safeParse(payload);
        if (!parsed.success) {
          return failure(
            "PROJECT_INPUT_INVALID",
            "Choose a project using the folder picker.",
          );
        }
        if (busy)
          return failure(
            "PROJECT_BUSY",
            "Please wait for the current project operation.",
          );
        const window = getWindow();
        if (!window)
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project window is unavailable.",
          );
        busy = true;
        const startedAt = Date.now();
        try {
          const grant =
            channel === IPC.IMPORT_OPEN &&
            parsed.data &&
            "operationId" in parsed.data &&
            imported?.operationId === parsed.data.operationId &&
            imported.owner === event.senderFrame
              ? imported
              : undefined;
          if (channel === IPC.IMPORT_OPEN && !grant)
            return failure(
              "IMPORT_EXPIRED",
              "This import can no longer be opened automatically. Use Open project to validate its folder.",
            );
          const recent =
            channel === IPC.RECENT_OPEN && parsed.data && "id" in parsed.data
              ? await services.recents?.find(parsed.data.id)
              : undefined;
          if (channel === IPC.RECENT_OPEN && !recent)
            return failure(
              "RECENT_NOT_FOUND",
              "This recent entry is no longer available. Use Open project to choose its folder.",
            );
          const path = grant
            ? grant.path
            : recent
              ? recent.path
              : await services.selectExistingFolder(window);
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project window changed. Open the project again.",
            );
          if (!path) return { ok: true, value: null };
          if (activeProjectPath) await history.settleProject(activeProjectPath);
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project window changed. Open the project again.",
            );
          const opened = await services.open(path);
          if (grant && opened.project.projectId !== grant.projectId)
            return failure(
              "IMPORT_INVALID",
              "The imported project identity changed. Preserve its folder for recovery; the current project remains open.",
            );
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project window changed. Open the project again.",
            );
          if (activeProjectPath) await history.closeProject(activeProjectPath);
          if (grant) imported = undefined;
          location = undefined;
          activeProjectPath = opened.projectPath;
          activeProjectId = opened.project.projectId;
          preparedPreview = undefined;
          history.scheduleRetention({
            projectPath: opened.projectPath,
            projectId: opened.project.projectId,
          });
          services.logger.info("project.opened", {
            projectId: opened.project.projectId,
            source: channel === IPC.RECENT_OPEN ? "recent" : "folder_picker",
            durationMs: Date.now() - startedAt,
          });
          const warning = await remember(opened.projectPath, opened.book.title);
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project access is not permitted.",
            );
          return {
            ok: true,
            ...(warning ? { warning } : {}),
            value: {
              projectId: opened.project.projectId,
              projectPath: opened.projectPath,
              title: opened.book.title,
              author: opened.book.author,
              language: opened.book.language,
              chapters: opened.chapters.map(
                ({ id, title, status, wordCount }) => ({
                  id,
                  title,
                  status,
                  wordCount,
                }),
              ),
            },
          };
        } catch (error) {
          services.logger.error("project.open_failed", {
            source: channel === IPC.RECENT_OPEN ? "recent" : "folder_picker",
            durationMs: Date.now() - startedAt,
            ...safeErrorContext(error),
          });
          const messages: Record<string, string> = {
            ...MIGRATION_ERRORS,
            PROJECT_FILE_MISSING:
              "This folder is missing project.json or another required project file. Choose a complete Drelwick project folder.",
            PROJECT_JSON_INVALID:
              "A project file contains invalid JSON. Restore a valid copy before opening this project.",
            PROJECT_SCHEMA_INVALID:
              "A project file has an invalid format. Restore a valid copy before opening this project.",
            PROJECT_SCHEMA_UNSUPPORTED:
              MIGRATION_ERRORS.PROJECT_SCHEMA_UNSUPPORTED,
            PROJECT_ORDER_INVALID:
              "The manuscript chapter order is invalid or references a missing chapter. Check the project files before trying again.",
            PROJECT_PATH_INVALID:
              "The selected folder contains an invalid project path or a linked file. Choose a folder containing regular project files.",
            PROJECT_PATH_ACCESS_FAILED:
              "Unable to access this project folder. Check that it is available and that you have permission to read it.",
            PROJECT_FILE_READ_FAILED:
              "Unable to read a project file. Check folder permissions and try again.",
            PROJECT_CHANGED_DURING_OPEN:
              "A chapter changed while the project was opening. Please try again.",
          };
          const message =
            error instanceof ApplicationError &&
            Object.hasOwn(messages, error.code)
              ? messages[error.code]
              : undefined;
          if (message && error instanceof ApplicationError)
            return failure(error.code, message);
          return failure(
            "PROJECT_OPEN_FAILED",
            "Unable to open the project. Check that the folder is available and try again.",
          );
        } finally {
          busy = false;
        }
      },
    );

  ipcMain.handle(
    IPC.PROJECT_BACKUP,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<{ created: boolean }>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[IPC.PROJECT_BACKUP].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Choose valid backup options.");
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      if (!activeProjectPath || !activeProjectId)
        return failure(
          "PROJECT_NOT_OPEN",
          "Open a project before creating a backup.",
        );
      const window = getWindow();
      if (!window)
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project window is unavailable.",
        );
      busy = true;
      const projectPath = activeProjectPath;
      const projectId = activeProjectId;
      const startedAt = Date.now();
      try {
        const archivePath = await services.selectBackupDestination(
          window,
          projectPath,
        );
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project window changed. Try the backup again.",
          );
        if (!archivePath) return { ok: true, value: { created: false } };
        await history.settleProject(projectPath);
        await services.createArchive({
          projectPath,
          archivePath,
          includeHistory: parsed.data.includeHistory,
        });
        services.logger.info("project.backup_created", {
          projectId,
          reason: "backup_created",
          durationMs: Date.now() - startedAt,
        });
        return { ok: true, value: { created: true } };
      } catch (error) {
        services.logger.error("project.backup_failed", {
          projectId,
          durationMs: Date.now() - startedAt,
          ...safeErrorContext(error),
        });
        return backupFailure(error);
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(
    IPC.PROJECT_RESTORE,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectWorkspace | null>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      if (!IpcRequestSchemas[IPC.PROJECT_RESTORE].safeParse(payload).success)
        return failure(
          "PROJECT_INPUT_INVALID",
          "Choose a backup using the file picker.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      const window = getWindow();
      if (!window)
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project window is unavailable.",
        );
      busy = true;
      const startedAt = Date.now();
      try {
        const archivePath = await services.selectBackupArchive(window);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project window changed. Try restoring again.",
          );
        if (!archivePath) return { ok: true, value: null };
        const destinationParent = await services.selectRestoreParent(window);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project window changed. Try restoring again.",
          );
        if (!destinationParent) return { ok: true, value: null };
        const restored = await services.restoreArchive({
          archivePath,
          destinationParent,
        });
        const opened = await services.open(restored.projectPath);
        if (opened.project.projectId !== restored.projectId)
          throw new ApplicationError(
            "PROJECT_ARCHIVE_INVALID",
            "Restored project identity did not match its archive.",
          );
        if (activeProjectPath) await history.closeProject(activeProjectPath);
        activeProjectPath = opened.projectPath;
        activeProjectId = opened.project.projectId;
        preparedPreview = undefined;
        history.scheduleRetention({
          projectPath: opened.projectPath,
          projectId: opened.project.projectId,
        });
        const warning = await remember(opened.projectPath, opened.book.title);
        services.logger.info("project.backup_restored", {
          projectId: opened.project.projectId,
          reason: "backup_restored",
          durationMs: Date.now() - startedAt,
        });
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project window changed. Open the restored project again.",
          );
        return {
          ok: true,
          ...(warning ? { warning } : {}),
          value: {
            projectId: opened.project.projectId,
            projectPath: opened.projectPath,
            title: opened.book.title,
            author: opened.book.author,
            language: opened.book.language,
            chapters: opened.chapters.map(
              ({ id, title, status, wordCount }) => ({
                id,
                title,
                status,
                wordCount,
              }),
            ),
          },
        };
      } catch (error) {
        services.logger.error("project.backup_restore_failed", {
          durationMs: Date.now() - startedAt,
          ...safeErrorContext(error),
        });
        return backupFailure(error);
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(
    IPC.PROJECT_CLOSE,
    async (event, payload: unknown): Promise<ProjectOperationResult<null>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      if (!IpcRequestSchemas[IPC.PROJECT_CLOSE].safeParse(payload).success)
        return failure("PROJECT_INPUT_INVALID", "Unable to close the project.");
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      busy = true;
      try {
        if (activeProjectPath) await history.closeProject(activeProjectPath);
        activeProjectPath = undefined;
        activeProjectId = undefined;
        preparedPreview = undefined;
        return { ok: true, value: null };
      } finally {
        busy = false;
      }
    },
  );

  async function remember(
    path: string,
    title: string,
  ): Promise<string | undefined> {
    try {
      await services.recents?.add(path, title);
      return undefined;
    } catch {
      // Settings failure must not turn a successful project operation into a failure.
      return "The project opened, but its recent entry could not be saved. Check application settings permissions and try opening it again.";
    }
  }

  for (const channel of [IPC.RECENT_LIST, IPC.RECENT_REMOVE] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[channel].safeParse(payload);
      if (!parsed.success)
        return failure(
          "PROJECT_INPUT_INVALID",
          "Choose a recent project entry.",
        );
      if (busy && channel === IPC.RECENT_REMOVE)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      if (channel === IPC.RECENT_REMOVE) busy = true;
      try {
        if (!services.recents) throw new Error("Recent projects unavailable");
        const value =
          channel === IPC.RECENT_REMOVE && parsed.data
            ? await services.recents.remove(parsed.data.id)
            : await services.recents.list();
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return { ok: true, value };
      } catch {
        return failure(
          "RECENT_SETTINGS_FAILED",
          "Unable to load or save recent projects. Check application settings permissions and try again.",
        );
      } finally {
        if (channel === IPC.RECENT_REMOVE) busy = false;
      }
    });
  }

  ipcMain.handle(
    IPC.PROJECT_SELECT_LOCATION,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectLocation | null>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      if (payload !== undefined)
        return failure(
          "PROJECT_INPUT_INVALID",
          "Folder selection does not accept a path.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      const window = getWindow();
      if (!window)
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project window is unavailable.",
        );
      busy = true;
      try {
        const path = await services.selectFolder(window);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project window changed. Select the folder again.",
          );
        if (!path) return { ok: true, value: null };
        location = { owner: event.senderFrame, token: createUuid(), path };
        return { ok: true, value: { token: location.token, path } };
      } catch {
        return failure(
          "PROJECT_LOCATION_FAILED",
          "Unable to choose a folder. Please try again.",
        );
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(
    IPC.PROJECT_CREATE,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectWorkspace>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = CreateProjectRequestSchema.safeParse(payload);
      if (!parsed.success)
        return failure(
          "PROJECT_INPUT_INVALID",
          "Enter a book title, author, language and choose a project folder.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      if (
        !location ||
        location.owner !== event.senderFrame ||
        location.token !== parsed.data.locationToken
      ) {
        return failure(
          "PROJECT_LOCATION_REQUIRED",
          "Choose a project folder before creating your book.",
        );
      }
      busy = true;
      const startedAt = Date.now();
      try {
        const created = await services.create({
          title: parsed.data.title,
          author: parsed.data.author,
          language: parsed.data.language,
          projectPath: location.path,
        });
        if (activeProjectPath) await history.closeProject(activeProjectPath);
        location = undefined;
        activeProjectPath = created.projectPath;
        activeProjectId = created.project.projectId;
        preparedPreview = undefined;
        history.scheduleRetention({
          projectPath: created.projectPath,
          projectId: created.project.projectId,
        });
        services.logger.info("project.created", {
          projectId: created.project.projectId,
          durationMs: Date.now() - startedAt,
        });
        const warning = await remember(created.projectPath, created.book.title);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          ...(warning ? { warning } : {}),
          value: {
            projectId: created.project.projectId,
            projectPath: created.projectPath,
            title: created.book.title,
            author: created.book.author,
            language: created.book.language,
            chapters: [],
          },
        };
      } catch (error) {
        services.logger.error("project.create_failed", {
          durationMs: Date.now() - startedAt,
          ...safeErrorContext(error),
        });
        if (
          error instanceof ApplicationError &&
          error.code === "PROJECT_DESTINATION_NOT_EMPTY"
        ) {
          return failure(
            error.code,
            "This folder is not empty. Choose an empty folder for your book.",
          );
        }
        if (
          error instanceof ApplicationError &&
          error.code === "PROJECT_CREATE_CLEANUP_FAILED"
        ) {
          return failure(
            error.code,
            "Project creation failed and some files could not be removed. Check the selected folder before trying again.",
          );
        }
        return failure(
          "PROJECT_CREATE_FAILED",
          "Unable to create the project. Check folder permissions and available disk space, then try again.",
        );
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(
    IPC.CHAPTER_RENAME,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectWorkspace>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[IPC.CHAPTER_RENAME].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Enter a chapter title.");
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      if (!activeProjectPath)
        return failure(
          "PROJECT_NOT_OPEN",
          "Open a project before renaming a chapter.",
        );
      busy = true;
      try {
        const renamed = await services.rename({
          projectPath: activeProjectPath,
          chapterId: parsed.data.chapterId,
          title: parsed.data.title,
        } satisfies RenameChapterInput);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          ...(renamed.warning ? { warning: renamed.warning } : {}),
          value: {
            projectId: renamed.session.project.projectId,
            projectPath: renamed.session.projectPath,
            title: renamed.session.book.title,
            author: renamed.session.book.author,
            language: renamed.session.book.language,
            chapters: renamed.session.chapters.map(
              ({ id, title, status, wordCount }) => ({
                id,
                title,
                status,
                wordCount,
              }),
            ),
          },
        };
      } catch (error) {
        const messages: Record<string, string> = {
          CHAPTER_NOT_FOUND: "The selected chapter is no longer available.",
          CHAPTER_INPUT_INVALID: "Enter a chapter title.",
          PROJECT_BUSY:
            "Another chapter operation is in progress. Please try again.",
          PROJECT_SCHEMA_INVALID: "The selected chapter has an invalid format.",
          PROJECT_ORDER_INVALID: "The manuscript chapter order is invalid.",
          PROJECT_PATH_ACCESS_FAILED: "Unable to access this project folder.",
        };
        const message =
          error instanceof ApplicationError ? messages[error.code] : undefined;
        if (error instanceof ApplicationError && message !== undefined)
          return failure(error.code, message);
        return failure(
          "CHAPTER_RENAME_FAILED",
          "Unable to rename the chapter. The previous title was preserved.",
        );
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(
    IPC.CHAPTER_DELETE,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectWorkspace>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[IPC.CHAPTER_DELETE].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Choose a chapter to delete.");
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      if (!activeProjectPath)
        return failure(
          "PROJECT_NOT_OPEN",
          "Open a project before deleting a chapter.",
        );
      busy = true;
      try {
        const deleted = await services.delete({
          projectPath: activeProjectPath,
          chapterId: parsed.data.chapterId,
        });
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          ...(deleted.warning ? { warning: deleted.warning } : {}),
          value: {
            projectId: deleted.session.project.projectId,
            projectPath: deleted.session.projectPath,
            title: deleted.session.book.title,
            author: deleted.session.book.author,
            language: deleted.session.book.language,
            chapters: deleted.session.chapters.map(
              ({ id, title, status, wordCount }) => ({
                id,
                title,
                status,
                wordCount,
              }),
            ),
          },
        };
      } catch (error) {
        const messages: Record<string, string> = {
          CHAPTER_NOT_FOUND: "The selected chapter is no longer available.",
          PROJECT_BUSY:
            "Another chapter operation is in progress. Please try again.",
          PROJECT_ORDER_INVALID: "The manuscript chapter order is invalid.",
          PROJECT_CHANGED_DURING_DELETE:
            "The project changed while deleting the chapter. Please reopen it.",
          CHAPTER_DELETE_RECOVERY_FAILED:
            "The chapter could not be restored after deletion failed. Preserve the project before retrying.",
        };
        const message =
          error instanceof ApplicationError ? messages[error.code] : undefined;
        if (error instanceof ApplicationError && message !== undefined)
          return failure(error.code, message);
        return failure(
          "CHAPTER_DELETE_FAILED",
          "Unable to delete the chapter. The original chapter was preserved.",
        );
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(
    IPC.CHAPTER_REORDER,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectWorkspace>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[IPC.CHAPTER_REORDER].safeParse(payload);
      if (!parsed.success)
        return failure(
          "PROJECT_INPUT_INVALID",
          "Choose a valid chapter order.",
        );
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      if (!activeProjectPath)
        return failure(
          "PROJECT_NOT_OPEN",
          "Open a project before reordering chapters.",
        );
      busy = true;
      try {
        const reordered = await services.reorder({
          projectPath: activeProjectPath,
          chapterIds: parsed.data.chapterIds,
        } satisfies ReorderChaptersInput);
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          ...(reordered.warning ? { warning: reordered.warning } : {}),
          value: {
            projectId: reordered.session.project.projectId,
            projectPath: reordered.session.projectPath,
            title: reordered.session.book.title,
            author: reordered.session.book.author,
            language: reordered.session.book.language,
            chapters: reordered.session.chapters.map(
              ({ id, title, status, wordCount }) => ({
                id,
                title,
                status,
                wordCount,
              }),
            ),
          },
        };
      } catch (error) {
        const messages: Record<string, string> = {
          PROJECT_ORDER_INVALID:
            "The chapter order must include each project chapter exactly once.",
          PROJECT_CHANGED_DURING_REORDER:
            "The project changed while reordering chapters. Please reopen it.",
          PROJECT_BUSY:
            "Another chapter operation is in progress. Please try again.",
        };
        const message =
          error instanceof ApplicationError ? messages[error.code] : undefined;
        if (error instanceof ApplicationError && message !== undefined)
          return failure(error.code, message);
        return failure(
          "CHAPTER_REORDER_FAILED",
          "Unable to reorder chapters. The previous order was preserved.",
        );
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(
    IPC.CHAPTER_CREATE,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectWorkspace>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed = IpcRequestSchemas[IPC.CHAPTER_CREATE].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Enter a chapter title.");
      if (busy)
        return failure(
          "PROJECT_BUSY",
          "Please wait for the current project operation.",
        );
      if (!activeProjectPath)
        return failure(
          "PROJECT_NOT_OPEN",
          "Open a project before creating a chapter.",
        );
      busy = true;
      try {
        const created = await services.createChapter({
          projectPath: activeProjectPath,
          title: parsed.data.title,
        });
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return {
          ok: true,
          ...(created.warning ? { warning: created.warning } : {}),
          value: {
            projectId: created.session.project.projectId,
            projectPath: created.session.projectPath,
            title: created.session.book.title,
            author: created.session.book.author,
            language: created.session.book.language,
            chapters: created.session.chapters.map(
              ({ id, title, status, wordCount }) => ({
                id,
                title,
                status,
                wordCount,
              }),
            ),
          },
        };
      } catch (error) {
        const message =
          error instanceof ApplicationError &&
          error.code === "CHAPTER_INPUT_INVALID"
            ? "Enter a chapter title."
            : "Unable to create the chapter. Please try again.";
        return failure(
          error instanceof ApplicationError
            ? error.code
            : "CHAPTER_CREATE_FAILED",
          message,
        );
      } finally {
        busy = false;
      }
    },
  );

  ipcMain.handle(IPC.CHAPTER_ORGANISE, async (event, payload: unknown) => {
    if (!trusted(event))
      return failure(
        "PROJECT_ACCESS_DENIED",
        "Project access is not permitted.",
      );
    const parsed = IpcRequestSchemas[IPC.CHAPTER_ORGANISE].safeParse(payload);
    if (!parsed.success)
      return failure("PROJECT_INPUT_INVALID", "Invalid chapter operation.");
    if (parsed.data.projectId !== activeProjectId)
      return failure(
        "PROJECT_NOT_OPEN",
        "Reopen the project before organising chapters.",
      );
    if (busy || !activeProjectPath)
      return failure(
        "PROJECT_BUSY",
        "Open a project and wait for current operations to finish.",
      );
    busy = true;
    try {
      await history.settleProject(activeProjectPath);
      const { session, chapterId } = await organiseChapter({
        ...parsed.data,
        projectPath: activeProjectPath,
      });
      return {
        ok: true,
        value: {
          chapterId,
          workspace: {
            projectId: session.project.projectId,
            projectPath: session.projectPath,
            title: session.book.title,
            author: session.book.author,
            language: session.book.language,
            chapters: session.chapters.map(
              ({ id, title, status, wordCount }) => ({
                id,
                title,
                status,
                wordCount,
              }),
            ),
          },
        },
      };
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        [
          "CHAPTER_OPERATION_FAILED",
          "CHAPTER_OPERATION_INVALID",
          "CHAPTER_RECOVERY_REQUIRED",
        ].includes(error.code)
      )
        return failure(error.code, error.message);
      return failure(
        "CHAPTER_RECOVERY_REQUIRED",
        "The chapter operation outcome is uncertain. Reopen the project before editing.",
      );
    } finally {
      busy = false;
    }
  });

  ipcMain.handle(IPC.MANUSCRIPT_CANCEL_REPLACE, (event, payload: unknown) => {
    if (!trusted(event) || payload !== undefined)
      return failure(
        "PROJECT_ACCESS_DENIED",
        "Replacement access is not permitted.",
      );
    if (replacementCancellation) replacementCancellation.cancelled = true;
    return { ok: true, value: null };
  });
  ipcMain.handle(IPC.MANUSCRIPT_REPLACE, async (event, payload: unknown) => {
    if (!trusted(event))
      return failure(
        "PROJECT_ACCESS_DENIED",
        "Replacement access is not permitted.",
      );
    const parsed = IpcRequestSchemas[IPC.MANUSCRIPT_REPLACE].safeParse(payload);
    if (!parsed.success)
      return failure("PROJECT_INPUT_INVALID", "Invalid replacement request.");
    if (busy || !activeProjectPath)
      return failure(
        "PROJECT_BUSY",
        "Open a project and wait for current operations to finish.",
      );
    busy = true;
    const cancellation = { cancelled: false };
    replacementCancellation = cancellation;
    try {
      await history.settleProject(activeProjectPath);
      const value = await replaceManuscript(
        { ...parsed.data, projectPath: activeProjectPath },
        { cancelled: () => cancellation.cancelled },
      );
      return { ok: true, value: ReplacementReceiptSchema.parse(value) };
    } catch (error) {
      // Fixed domain messages only; never log requests, parser issues or causes.
      if (
        error instanceof ApplicationError &&
        [
          "REPLACEMENT_FAILED",
          "REPLACEMENT_CANCELLED",
          "REPLACEMENT_RECOVERY_REQUIRED",
          "PROJECT_BUSY",
        ].includes(error.code)
      )
        return failure(error.code, error.message);
      return failure(
        "REPLACEMENT_RECOVERY_REQUIRED",
        "Replacement could not finish. Preserve the project and reopen to verify recovery.",
      );
    } finally {
      replacementCancellation = undefined;
      busy = false;
    }
  });

  ipcMain.handle(IPC.PROJECT_SAVE_CHAPTER, async (event, payload: unknown) => {
    if (!trusted(event))
      return failure(
        "PROJECT_ACCESS_DENIED",
        "Project access is not permitted.",
      );
    const parsed =
      IpcRequestSchemas[IPC.PROJECT_SAVE_CHAPTER].safeParse(payload);
    if (!parsed.success)
      return failure(
        "PROJECT_INPUT_INVALID",
        "Choose a valid chapter document to save.",
      );
    const saveFailureContext = (errorCode: string) => ({
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
      chapterId: parsed.data.chapterId,
      source: parsed.data.source,
      errorCode,
    });
    const logRejectedSave = (errorCode: string) => {
      const context = saveFailureContext(errorCode);
      services.logger.error("chapter.save_failed", context);
      if (parsed.data.source === "autosave")
        services.logger.warn("autosave.failed", context);
    };
    if (!activeProjectPath) {
      logRejectedSave("PROJECT_NOT_OPEN");
      return failure("PROJECT_NOT_OPEN", "Open a project before saving.");
    }
    if (busy) {
      logRejectedSave("PROJECT_BUSY");
      return failure(
        "PROJECT_BUSY",
        "Please wait for the current project operation.",
      );
    }
    busy = true;
    const startedAt = Date.now();
    try {
      const saved = await services.saveChapter({
        chapterId: parsed.data.chapterId,
        document: parsed.data.document,
        projectPath: activeProjectPath,
      });
      services.logger.info("chapter.saved", {
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        chapterId: saved.id,
        source: parsed.data.source,
        durationMs: Date.now() - startedAt,
      });
      if (activeProjectId)
        history.scheduleSnapshot({
          projectPath: activeProjectPath,
          projectId: activeProjectId,
          chapterId: saved.id,
          document: parsed.data.document,
        });
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      return {
        ok: true,
        value: { id: saved.id, modified: saved.modified },
        ...(saved.warning ? { warning: saved.warning } : {}),
      };
    } catch (error) {
      const context = {
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        chapterId: parsed.data.chapterId,
        source: parsed.data.source,
        durationMs: Date.now() - startedAt,
        ...safeErrorContext(error),
      };
      services.logger.error("chapter.save_failed", context);
      if (parsed.data.source === "autosave")
        services.logger.warn("autosave.failed", context);
      const messages: Record<string, string> = {
        CHAPTER_NOT_FOUND: "The selected chapter is no longer available.",
        CHAPTER_DOCUMENT_INVALID:
          "The chapter document has an unsupported or invalid structure.",
        CHAPTER_RECOVERY_REQUIRED:
          "A temporary chapter file exists. Preserve it for recovery before retrying.",
        PROJECT_BUSY:
          "Another chapter operation is in progress. Check the project lock before retrying.",
      };
      if (
        error instanceof ApplicationError &&
        Object.hasOwn(messages, error.code)
      )
        return failure(error.code, messages[error.code]!);
      return failure(
        "CHAPTER_SAVE_FAILED",
        "Unable to save the chapter. Your edits remain in the editor; please try again.",
      );
    } finally {
      busy = false;
    }
  });

  ipcMain.handle(
    IPC.PROJECT_LOAD_CHAPTER,
    async (
      event,
      payload: unknown,
    ): Promise<
      ProjectOperationResult<{
        id: string;
        content: Record<string, unknown>;
      }>
    > => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      const parsed =
        IpcRequestSchemas[IPC.PROJECT_LOAD_CHAPTER].safeParse(payload);
      if (!parsed.success)
        return failure("PROJECT_INPUT_INVALID", "Choose a chapter to load.");
      if (!activeProjectPath)
        return failure("PROJECT_NOT_OPEN", "Open a project before editing.");
      try {
        const chapter = await services.loadChapter({
          projectPath: activeProjectPath,
          chapterId: parsed.data.chapterId,
        });
        if (!trusted(event))
          return failure(
            "PROJECT_ACCESS_DENIED",
            "Project access is not permitted.",
          );
        return { ok: true, value: chapter };
      } catch (error) {
        const message =
          error instanceof ApplicationError &&
          error.code === "CHAPTER_NOT_FOUND"
            ? "The selected chapter is no longer available."
            : "Unable to load the selected chapter.";
        return failure(
          error instanceof ApplicationError
            ? error.code
            : "CHAPTER_LOAD_FAILED",
          message,
        );
      }
    },
  );

  return {
    authorizeImport(
      event: IpcMainInvokeEvent,
      operationId: string,
      path: string,
      projectId: string,
    ) {
      if (trusted(event))
        imported = { operationId, owner: event.senderFrame, path, projectId };
    },
    settleHistory: () => history.settleAll(),
    stopHistory: () => history.shutdown(),
  };
}
