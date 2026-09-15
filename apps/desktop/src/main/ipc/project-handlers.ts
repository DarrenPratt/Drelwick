import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import {
  createProject,
  openProject,
  renameChapter,
  type RenameChapterInput,
} from "@bookeditor/core";
import {
  ApplicationError,
  createUuid,
  CreateProjectRequestSchema,
  IPC,
  IpcRequestSchemas,
  type ProjectLocation,
  type ProjectOperationResult,
  type ProjectWorkspace,
} from "@bookeditor/shared";
import type { RecentProjects } from "../recent-projects.js";

interface Dependencies {
  selectFolder(window: BrowserWindow): Promise<string | null>;
  create: typeof createProject;
  selectExistingFolder(window: BrowserWindow): Promise<string | null>;
  open: typeof openProject;
  rename: typeof renameChapter;
  recents?: RecentProjects;
}

const dependencies: Dependencies = {
  selectFolder: async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose an empty folder for your book",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  create: createProject,
  selectExistingFolder: async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Open a BookEditor project",
      buttonLabel: "Open project",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  open: openProject,
  rename: renameChapter,
};

const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
});

/** Folder grants belong to the trusted top-level frame and are never renderer paths. */
export function registerProjectHandlers(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl: string,
  overrides: Partial<Dependencies> = {},
): void {
  const services = { ...dependencies, ...overrides };
  let location:
    | { owner: IpcMainInvokeEvent["senderFrame"]; token: string; path: string }
    | undefined;
  let busy = false;
  let activeProjectPath: string | undefined;
  const trusted = (event: IpcMainInvokeEvent) => {
    const window = getWindow();
    return (
      window &&
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame?.url === rendererUrl
    );
  };

  for (const channel of [IPC.PROJECT_OPEN, IPC.RECENT_OPEN] as const)
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
        try {
          const recent =
            channel === IPC.RECENT_OPEN && parsed.data
              ? await services.recents?.find(parsed.data.id)
              : undefined;
          if (channel === IPC.RECENT_OPEN && !recent)
            return failure(
              "RECENT_NOT_FOUND",
              "This recent entry is no longer available. Use Open project to choose its folder.",
            );
          const path = recent
            ? recent.path
            : await services.selectExistingFolder(window);
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project window changed. Open the project again.",
            );
          if (!path) return { ok: true, value: null };
          const opened = await services.open(path);
          if (!trusted(event))
            return failure(
              "PROJECT_ACCESS_DENIED",
              "Project window changed. Open the project again.",
            );
          location = undefined;
          activeProjectPath = opened.projectPath;
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
              chapters: opened.chapters.map(({ id, title, wordCount }) => ({
                id,
                title,
                wordCount,
              })),
            },
          };
        } catch (error) {
          const messages: Record<string, string> = {
            PROJECT_FILE_MISSING:
              "This folder is missing project.json or another required project file. Choose a complete BookEditor project folder.",
            PROJECT_JSON_INVALID:
              "A project file contains invalid JSON. Restore a valid copy before opening this project.",
            PROJECT_SCHEMA_INVALID:
              "A project file has an invalid format. Restore a valid copy before opening this project.",
            PROJECT_SCHEMA_UNSUPPORTED:
              "This project uses an unsupported format version. Open it with a compatible version of BookEditor.",
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
      try {
        const created = await services.create({
          title: parsed.data.title,
          author: parsed.data.author,
          language: parsed.data.language,
          projectPath: location.path,
        });
        location = undefined;
        activeProjectPath = created.projectPath;
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
              ({ id, title, wordCount }) => ({ id, title, wordCount }),
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
}
