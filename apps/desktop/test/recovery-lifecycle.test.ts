import { beforeEach, expect, it, vi } from "vitest";
import { IPC } from "@bookeditor/shared";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  start: vi.fn(),
  markClean: vi.fn(),
  stopHistory: vi.fn(),
  exit: vi.fn(),
  quit: vi.fn(),
  list: vi.fn(),
  scanProject: vi.fn(),
  getCandidates: vi.fn(),
  send: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  showErrorBox: vi.fn(),
  fatalHandler: undefined as
    | ((source: "uncaught_exception" | "unhandled_rejection") => void)
    | undefined,
  frame: { url: "file:///app/index.html" },
}));
vi.mock("electron", () => ({
  app: {
    whenReady: async () => {},
    getPath: () => "/settings",
    exit: mocks.exit,
    quit: mocks.quit,
    on: (name: string, listener: (...args: unknown[]) => void) =>
      mocks.listeners.set(name, listener),
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: mocks.showErrorBox },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
}));
vi.mock("@bookeditor/core", () => ({
  RecoveryService: class {
    scanProject = mocks.scanProject;
    getCandidates = mocks.getCandidates;
  },
}));
vi.mock("../src/main/recent-projects.js", () => ({
  RecentProjects: class {
    list = mocks.list;
  },
}));
vi.mock("../src/main/session-marker.js", () => ({
  SessionMarkerService: class {
    start = mocks.start;
    markClean = mocks.markClean;
  },
}));
vi.mock("../src/main/logging/file-logger.js", () => ({
  FileLogger: class {
    debug = vi.fn();
    info = mocks.logInfo;
    warn = vi.fn();
    error = mocks.logError;
  },
  installProcessErrorHandling: vi.fn(
    (
      _logger: unknown,
      handler: (source: "uncaught_exception" | "unhandled_rejection") => void,
    ) => {
      mocks.fatalHandler = handler;
    },
  ),
}));
vi.mock("../src/main/ipc/project-handlers.js", () => ({
  registerProjectHandlers: vi.fn(() => ({ stopHistory: mocks.stopHistory })),
}));
vi.mock("../src/main/application-menu.js", () => ({
  installApplicationMenu: vi.fn(),
}));
const webContents = { mainFrame: mocks.frame, send: mocks.send };
vi.mock("../src/main/windows/main-window.js", () => ({
  getRendererUrl: () => mocks.frame.url,
  createMainWindow: () => ({
    on: vi.fn(),
    isDestroyed: () => false,
    webContents,
  }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.listeners.clear();
  mocks.fatalHandler = undefined;
  mocks.start.mockResolvedValue({ wasUnclean: true });
  mocks.stopHistory.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([{ path: "/book" }]);
  mocks.scanProject.mockResolvedValue({ candidates: [] });
  mocks.getCandidates.mockReturnValue([{ id: "candidate" }]);
});
async function start() {
  await import("../src/main/main.js");
  await vi.waitFor(() =>
    expect(mocks.handlers.has(IPC.RECOVERY_CANCEL)).toBe(true),
  );
}
const event = { sender: webContents, senderFrame: mocks.frame };
it("scans after unclean startup and cancellation leaves the marker unclean", async () => {
  await start();
  expect(mocks.scanProject).toHaveBeenCalledExactlyOnceWith("/book");
  await mocks.handlers.get(IPC.RECOVERY_CANCEL)!(event, undefined);
  expect(mocks.exit).toHaveBeenCalledWith(0);
  expect(mocks.markClean).not.toHaveBeenCalled();
});
it("native quit during unresolved recovery leaves the marker unclean", async () => {
  await start();
  const preventDefault = vi.fn();
  mocks.listeners.get("before-quit")!({ preventDefault });
  expect(preventDefault).toHaveBeenCalled();
  expect(mocks.exit).toHaveBeenCalledWith(0);
  expect(mocks.markClean).not.toHaveBeenCalled();
});
it("normal shutdown still waits for the renderer and marks clean only after recovery", async () => {
  mocks.getCandidates.mockReturnValue([]);
  await start();
  mocks.listeners.get("before-quit")!({ preventDefault: vi.fn() });
  expect(mocks.send).toHaveBeenCalledWith("application:shutdown-request");
  expect(mocks.markClean).not.toHaveBeenCalled();
  await mocks.handlers.get(IPC.APPLICATION_SHUTDOWN_READY)!(event, {
    saved: true,
  });
  expect(mocks.stopHistory).toHaveBeenCalledOnce();
  expect(mocks.markClean).toHaveBeenCalledOnce();
  expect(mocks.stopHistory.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.markClean.mock.invocationCallOrder[0]!,
  );
  expect(mocks.exit).toHaveBeenCalledWith(0);
  expect(mocks.logInfo).toHaveBeenCalledWith("application.shutdown", {
    reason: "normal",
  });
});
it("scan failure prevents clean shutdown and permits cancel", async () => {
  mocks.scanProject.mockRejectedValue(new Error("unavailable"));
  mocks.getCandidates.mockReturnValue([]);
  await start();
  expect(
    await mocks.handlers.get(IPC.RECOVERY_LIST)!(event, undefined),
  ).toMatchObject({ ok: false, error: { code: "RECOVERY_SCAN_FAILED" } });
  await mocks.handlers.get(IPC.RECOVERY_CANCEL)!(event, undefined);
  expect(mocks.exit).toHaveBeenCalledWith(0);
  expect(mocks.markClean).not.toHaveBeenCalled();
});
it("does not scan a previously clean session", async () => {
  mocks.start.mockResolvedValue({ wasUnclean: false });
  mocks.getCandidates.mockReturnValue([]);
  await start();
  expect(mocks.scanProject).not.toHaveBeenCalled();
  expect(mocks.logInfo).toHaveBeenCalledWith("application.startup", {
    platform: process.platform,
  });
});

it("shows a safe fatal-error message and exits without marking the session clean", async () => {
  mocks.getCandidates.mockReturnValue([]);
  await start();
  mocks.fatalHandler?.("uncaught_exception");

  expect(mocks.showErrorBox).toHaveBeenCalledWith(
    "BookEditor encountered an unexpected error",
    expect.stringContaining("Saved project files have been preserved"),
  );
  expect(mocks.exit).toHaveBeenCalledWith(1);
  expect(mocks.markClean).not.toHaveBeenCalled();
  expect(mocks.logInfo).toHaveBeenCalledWith("application.shutdown", {
    reason: "fatal_uncaught_exception",
  });

  mocks.fatalHandler?.("unhandled_rejection");
  expect(mocks.showErrorBox).toHaveBeenCalledOnce();
  expect(mocks.exit).toHaveBeenCalledOnce();
});
