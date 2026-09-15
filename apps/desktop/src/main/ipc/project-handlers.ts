import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { createProject, openProject } from "@bookeditor/core";
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

interface Dependencies {
  selectFolder(window: BrowserWindow): Promise<string | null>;
  create: typeof createProject;
  selectExistingFolder(window: BrowserWindow): Promise<string | null>;
  open: typeof openProject;
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

  ipcMain.handle(
    IPC.PROJECT_OPEN,
    async (
      event,
      payload: unknown,
    ): Promise<ProjectOperationResult<ProjectWorkspace | null>> => {
      if (!trusted(event))
        return failure(
          "PROJECT_ACCESS_DENIED",
          "Project access is not permitted.",
        );
      if (!IpcRequestSchemas[IPC.PROJECT_OPEN].safeParse(payload).success) {
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
        const path = await services.selectExistingFolder(window);
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
        return {
          ok: true,
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
        return {
          ok: true,
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
}
