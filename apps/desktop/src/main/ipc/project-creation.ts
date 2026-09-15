import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { createProject } from "@bookeditor/core";
import {
  ApplicationError,
  createUuid,
  CreateProjectRequestSchema,
  IPC,
  type ProjectLocation,
  type ProjectOperationResult,
  type ProjectWorkspace,
} from "@bookeditor/shared";

interface Dependencies {
  selectFolder(window: BrowserWindow): Promise<string | null>;
  create: typeof createProject;
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
};

const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
});

/** Folder grants belong to the trusted top-level frame and are never renderer paths. */
export function registerProjectCreationHandlers(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl: string,
  services: Dependencies = dependencies,
): void {
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
