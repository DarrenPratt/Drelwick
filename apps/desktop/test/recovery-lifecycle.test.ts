import { beforeEach, expect, it, vi } from "vitest";
import { IPC } from "@bookeditor/shared";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  start: vi.fn(),
  markClean: vi.fn(),
  exit: vi.fn(),
  quit: vi.fn(),
  list: vi.fn(),
  scanProject: vi.fn(),
  getCandidates: vi.fn(),
  send: vi.fn(),
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
vi.mock("../src/main/ipc/project-handlers.js", () => ({
  registerProjectHandlers: vi.fn(),
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
  mocks.start.mockResolvedValue({ wasUnclean: true });
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
  expect(mocks.markClean).toHaveBeenCalledOnce();
  expect(mocks.exit).toHaveBeenCalledWith(0);
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
});
