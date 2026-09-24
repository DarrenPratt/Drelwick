import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { IPC, type SafeLogger } from "@drelwick/shared";

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle } }));

import { registerRendererErrorHandler } from "../src/main/ipc/renderer-error-handler.js";

beforeEach(() => handle.mockReset());

function setup() {
  const frame = { url: "file:///app/index.html" };
  const webContents = { mainFrame: frame };
  const window = {
    isDestroyed: () => false,
    webContents,
  } as unknown as BrowserWindow;
  const event = {
    sender: webContents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies SafeLogger;
  registerRendererErrorHandler(() => window, frame.url, logger);
  const invoke = (payload: unknown, source = event) => {
    const handler = handle.mock.calls.find(
      ([channel]) => channel === IPC.APPLICATION_RENDERER_ERROR,
    )?.[1] as (event: IpcMainInvokeEvent, payload: unknown) => void;
    return handler(source, payload);
  };
  return { event, frame, invoke, logger };
}

it("logs only validated renderer error classification", () => {
  const { invoke, logger } = setup();
  invoke({ errorName: "TypeError" });

  expect(logger.error).toHaveBeenCalledExactlyOnceWith(
    "renderer.unhandled_error",
    { errorName: "TypeError" },
  );
});

it("rejects raw error details and untrusted frames without logging them", () => {
  const sentinel = "SENTINEL MANUSCRIPT PROSE";
  const { event, frame, invoke, logger } = setup();

  invoke({ errorName: "Error", message: sentinel });
  invoke({ errorName: sentinel });
  invoke({ errorName: sentinel.repeat(10) });
  invoke({ errorName: "Error" }, {
    ...event,
    senderFrame: { url: frame.url },
  } as IpcMainInvokeEvent);

  expect(logger.error).not.toHaveBeenCalled();
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain(sentinel);
});
