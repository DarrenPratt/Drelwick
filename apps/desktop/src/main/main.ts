import { app, BrowserWindow, ipcMain } from "electron";
import {
  IPC,
  SHUTDOWN_REQUEST_CHANNEL,
  validateIpcPayload,
} from "@bookeditor/shared";
import { RecoveryService } from "@bookeditor/core";

import { createMainWindow, getRendererUrl } from "./windows/main-window.js";
import { registerProjectHandlers } from "./ipc/project-handlers.js";
import { registerRecoveryHandlers } from "./ipc/recovery-handlers.js";
import { RecentProjects } from "./recent-projects.js";
import { installApplicationMenu } from "./application-menu.js";
import { SessionMarkerService } from "./session-marker.js";

let mainWindow: BrowserWindow | undefined;
let sessionMarker: SessionMarkerService | undefined;
let quitting = false;
let shutdownPending = false;
const recoveryService = new RecoveryService();
let recoveryScanError: string | undefined;
const recoveryPending = () =>
  Boolean(recoveryScanError) || recoveryService.getCandidates().length > 0;

function createApplicationWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

void app.whenReady().then(async () => {
  sessionMarker = new SessionMarkerService(app.getPath("userData"));
  try {
    const startup = await sessionMarker.start();
    if (startup.wasUnclean) {
      try {
        const recentProjects = await new RecentProjects(
          app.getPath("userData"),
        ).list();
        for (const project of recentProjects)
          await recoveryService.scanProject(project.path);
      } catch {
        recoveryScanError =
          "Unable to scan recovery data. Check recent project folders, then cancel startup and retry.";
      }
    }
  } catch {
    app.quit();
    return;
  }
  registerProjectHandlers(() => mainWindow, getRendererUrl(), {
    recents: new RecentProjects(app.getPath("userData")),
    startupBlocked: recoveryPending,
  });
  registerRecoveryHandlers(
    () => mainWindow,
    getRendererUrl(),
    recoveryService,
    () => app.exit(0),
    recoveryScanError,
  );
  ipcMain.handle(IPC.APPLICATION_SHUTDOWN_READY, async (event, payload) => {
    if (
      !shutdownPending ||
      event.sender !== mainWindow?.webContents ||
      event.senderFrame !== mainWindow?.webContents.mainFrame
    )
      return;
    const { saved } = validateIpcPayload(
      IPC.APPLICATION_SHUTDOWN_READY,
      payload,
    );
    shutdownPending = false;
    if (!saved) {
      quitting = false;
      return;
    }
    try {
      if (!recoveryPending()) await sessionMarker?.markClean();
      app.exit(0);
    } catch {
      quitting = false;
    }
  });
  createApplicationWindow();
  installApplicationMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createApplicationWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitting || !sessionMarker || !mainWindow) return;
  event.preventDefault();
  if (shutdownPending) return;
  if (recoveryPending()) {
    app.exit(0);
    return;
  }
  quitting = true;
  shutdownPending = true;
  mainWindow.webContents.send(SHUTDOWN_REQUEST_CHANNEL);
});
