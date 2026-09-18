import { app, BrowserWindow } from "electron";

import { createMainWindow, getRendererUrl } from "./windows/main-window.js";
import { registerProjectHandlers } from "./ipc/project-handlers.js";
import { RecentProjects } from "./recent-projects.js";
import { installApplicationMenu } from "./application-menu.js";
import { SessionMarkerService } from "./session-marker.js";

let mainWindow: BrowserWindow | undefined;
let sessionMarker: SessionMarkerService | undefined;
let quitting = false;

function createApplicationWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

void app.whenReady().then(async () => {
  sessionMarker = new SessionMarkerService(app.getPath("userData"));
  try {
    await sessionMarker.start();
  } catch {
    app.quit();
    return;
  }
  registerProjectHandlers(() => mainWindow, getRendererUrl(), {
    recents: new RecentProjects(app.getPath("userData")),
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
  if (quitting || !sessionMarker) return;
  event.preventDefault();
  quitting = true;
  void sessionMarker
    .markClean()
    .then(() => app.exit(0))
    .catch(() => {
      quitting = false;
    });
});
