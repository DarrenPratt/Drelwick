import { app, BrowserWindow, ipcMain } from "electron";
import {
  IPC,
  SHUTDOWN_REQUEST_CHANNEL,
  safeErrorContext,
  validateIpcPayload,
} from "@bookeditor/shared";
import { RecoveryService } from "@bookeditor/core";

import { createMainWindow, getRendererUrl } from "./windows/main-window.js";
import { registerProjectHandlers } from "./ipc/project-handlers.js";
import { registerRecoveryHandlers } from "./ipc/recovery-handlers.js";
import { RecentProjects } from "./recent-projects.js";
import { installApplicationMenu } from "./application-menu.js";
import { SessionMarkerService } from "./session-marker.js";
import {
  FileLogger,
  installProcessErrorLogging,
} from "./logging/file-logger.js";

let mainWindow: BrowserWindow | undefined;
let sessionMarker: SessionMarkerService | undefined;
let quitting = false;
let shutdownPending = false;
let shutdownLogged = false;
const recoveryService = new RecoveryService();
const logger = new FileLogger(app.getPath("userData"));
installProcessErrorLogging(logger);
let recoveryScanError: string | undefined;
const recoveryPending = () =>
  Boolean(recoveryScanError) || recoveryService.getCandidates().length > 0;

function createApplicationWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function logShutdown(reason: string): void {
  if (!shutdownLogged) {
    shutdownLogged = true;
    logger.info("application.shutdown", { reason });
  }
}

function exitApplication(reason: string): void {
  logShutdown(reason);
  app.exit(0);
}

void app.whenReady().then(async () => {
  logger.info("application.startup", { platform: process.platform });
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
        logger.info("recovery.scan_completed", {
          projectCount: recentProjects.length,
          candidateCount: recoveryService.getCandidates().length,
        });
      } catch (error) {
        recoveryScanError =
          "Unable to scan recovery data. Check recent project folders, then cancel startup and retry.";
        logger.error("recovery.scan_failed", safeErrorContext(error));
      }
    }
  } catch (error) {
    logger.error("application.startup_failed", safeErrorContext(error));
    exitApplication("startup_failed");
    return;
  }
  registerProjectHandlers(() => mainWindow, getRendererUrl(), {
    recents: new RecentProjects(app.getPath("userData")),
    startupBlocked: recoveryPending,
    logger,
  });
  registerRecoveryHandlers(
    () => mainWindow,
    getRendererUrl(),
    recoveryService,
    () => exitApplication("recovery_cancelled"),
    recoveryScanError,
    logger,
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
      exitApplication("normal");
    } catch (error) {
      logger.error("application.shutdown_failed", safeErrorContext(error));
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

app.on("will-quit", () => {
  logShutdown("application_quit");
});

app.on("before-quit", (event) => {
  if (quitting || !sessionMarker || !mainWindow) return;
  event.preventDefault();
  if (shutdownPending) return;
  if (recoveryPending()) {
    exitApplication("recovery_pending");
    return;
  }
  quitting = true;
  shutdownPending = true;
  mainWindow.webContents.send(SHUTDOWN_REQUEST_CHANNEL);
});
