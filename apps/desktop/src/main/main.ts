import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { writeFileSync } from "node:fs";
import {
  IPC,
  SHUTDOWN_REQUEST_CHANNEL,
  safeErrorContext,
  validateIpcPayload,
} from "@drelwick/shared";
import { RecoveryService, recoverProjectMigration } from "@drelwick/core";

import { createMainWindow, getRendererUrl } from "./windows/main-window.js";
import { registerProjectHandlers } from "./ipc/project-handlers.js";
import { registerImportHandlers } from "./ipc/import-handlers.js";
import { registerRecoveryHandlers } from "./ipc/recovery-handlers.js";
import { registerRendererErrorHandler } from "./ipc/renderer-error-handler.js";
import { RecentProjects } from "./recent-projects.js";
import { SpellingService } from "@drelwick/core";
import { BundledSpellingAdapter } from "./spelling-adapter.js";
import { registerSpellingHandlers } from "./ipc/spelling-handlers.js";
import { installApplicationMenu } from "./application-menu.js";
import { configureApplicationIdentity } from "./application-identity.js";
import { SessionMarkerService } from "./session-marker.js";
import {
  FileLogger,
  installProcessErrorHandling,
  type FatalProcessErrorSource,
} from "./logging/file-logger.js";

configureApplicationIdentity(app);

let mainWindow: BrowserWindow | undefined;
let sessionMarker: SessionMarkerService | undefined;
let quitting = false;
let shutdownPending = false;
let shutdownLogged = false;
let fatalErrorHandled = false;
let stopHistory: (() => Promise<void>) | undefined;
let stopImports: (() => Promise<void>) | undefined;
const recoveryService = new RecoveryService();
const spellingAdapter = new BundledSpellingAdapter();
const logger = new FileLogger(app.getPath("userData"));
installProcessErrorHandling(logger, handleFatalProcessError);
let recoveryScanError: string | undefined;
const recoveryPending = () =>
  Boolean(recoveryScanError) || recoveryService.getCandidates().length > 0;

function createApplicationWindow(): void {
  mainWindow = createMainWindow();
  const packageSmokeFile = process.env["DRELWICK_PACKAGE_SMOKE_FILE"];
  if (packageSmokeFile) {
    mainWindow.webContents.once("did-finish-load", () => {
      void mainWindow?.webContents
        .executeJavaScript("Boolean(window.drelwick)", true)
        .then((preloadLoaded) => {
          writeFileSync(
            packageSmokeFile,
            preloadLoaded ? "renderer-and-preload-ok" : "preload-missing",
            "utf8",
          );
        })
        .catch(() => {
          writeFileSync(packageSmokeFile, "renderer-load-failed", "utf8");
        });
    });
  }
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

function exitApplication(reason: string, code = 0): void {
  logShutdown(reason);
  app.exit(code);
}

function handleFatalProcessError(source: FatalProcessErrorSource): void {
  if (fatalErrorHandled) return;
  fatalErrorHandled = true;
  try {
    dialog.showErrorBox(
      "Drelwick encountered an unexpected error",
      "Saved project files have been preserved. Drelwick must close without marking this session clean. Restart the application to check for recoverable manuscript changes.",
    );
  } finally {
    exitApplication(`fatal_${source}`, 1);
  }
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
        for (const project of recentProjects) {
          await recoverProjectMigration(project.path);
          await recoveryService.scanProject(project.path);
        }
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
  const projectHandlers = registerProjectHandlers(
    () => mainWindow,
    getRendererUrl(),
    {
      recents: new RecentProjects(app.getPath("userData")),
      startupBlocked: recoveryPending,
      logger,
    },
  );
  stopHistory = projectHandlers.stopHistory;
  stopImports = registerImportHandlers(() => mainWindow, getRendererUrl(), {
    blocked: recoveryPending,
    authorizeOpen: projectHandlers.authorizeImport,
  });
  registerRecoveryHandlers(
    () => mainWindow,
    getRendererUrl(),
    recoveryService,
    () => exitApplication("recovery_cancelled"),
    recoveryScanError,
    logger,
  );
  registerRendererErrorHandler(() => mainWindow, getRendererUrl(), logger);
  registerSpellingHandlers(
    () => mainWindow,
    getRendererUrl(),
    new SpellingService(app.getPath("userData"), spellingAdapter),
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
      await stopHistory?.();
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
  spellingAdapter.dispose();
  logShutdown("application_quit");
});

app.on("before-quit", (event) => {
  void stopImports?.();
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
