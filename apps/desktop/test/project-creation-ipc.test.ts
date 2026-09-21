import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { createProject } from "@bookeditor/core";
import {
  ApplicationError,
  IPC,
  type ProjectOperationResult,
  type ProjectLocation,
  type SafeLogger,
} from "@bookeditor/shared";

const { handle, showOpenDialog } = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle },
  dialog: { showOpenDialog },
}));
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";

const rendererUrl = "file:///app/index.html";
const directories: string[] = [];
beforeEach(() => handle.mockReset());
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function setup(create = vi.fn(createProject)) {
  const frame = { url: rendererUrl };
  const webContents = { mainFrame: frame };
  const window = {
    isDestroyed: () => false,
    webContents,
  } as unknown as BrowserWindow;
  const event = {
    sender: webContents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const selectFolder = vi
    .fn<() => Promise<string | null>>()
    .mockResolvedValue("/chosen/folder");
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies SafeLogger;
  registerProjectHandlers(() => window, rendererUrl, {
    selectFolder,
    create,
    logger,
  });
  const invoke = (
    channel: string,
    payload?: unknown,
    source = event,
  ): Promise<ProjectOperationResult<ProjectLocation | null>> => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )?.[1] as (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ) => Promise<ProjectOperationResult<ProjectLocation | null>>;
    return handler(source, payload);
  };
  const request = async () => {
    const selected = await invoke(IPC.PROJECT_SELECT_LOCATION);
    if (!selected.ok || !selected.value) throw new Error("Expected selection");
    return {
      title: "Book",
      author: "Author",
      language: "en-GB",
      locationToken: selected.value.token,
    };
  };
  return { frame, event, selectFolder, create, invoke, request, logger };
}

describe("project creation IPC", () => {
  it("uses an owner-bound native directory picker and treats cancellation as a normal result", async () => {
    const frame = { url: rendererUrl };
    const webContents = { mainFrame: frame };
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;
    registerProjectHandlers(() => window, rendererUrl);
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const handler = handle.mock.calls.find(
      ([name]) => name === IPC.PROJECT_SELECT_LOCATION,
    )?.[1] as (event: unknown) => Promise<unknown>;
    expect(await handler({ sender: webContents, senderFrame: frame })).toEqual({
      ok: true,
      value: null,
    });
    expect(showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        properties: ["openDirectory", "createDirectory"],
      }),
    );
  });

  it("revokes the previous selection when a different folder is chosen", async () => {
    const { request, invoke, create } = setup();
    const previous = await request();
    await request();
    expect(await invoke(IPC.PROJECT_CREATE, previous)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_LOCATION_REQUIRED" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not grant access if the page navigates while the native picker is open", async () => {
    const { frame, invoke, selectFolder } = setup();
    selectFolder.mockImplementation(async () => {
      frame.url = "https://untrusted.example/";
      return "/selected";
    });
    expect(await invoke(IPC.PROJECT_SELECT_LOCATION)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ACCESS_DENIED" },
    });
  });

  it("creates a real project only in the native-selected folder", async () => {
    const { selectFolder, invoke, request, create, logger } = setup();
    const path = await mkdtemp(join(tmpdir(), "bookeditor-dialog-"));
    directories.push(path);
    selectFolder.mockResolvedValue(path);
    const input = await request();
    const result = await invoke(IPC.PROJECT_CREATE, input);
    expect(result).toMatchObject({
      ok: true,
      value: { title: "Book", author: "Author", projectPath: path },
    });
    expect(
      JSON.parse(await readFile(join(path, "book.json"), "utf8")),
    ).toMatchObject({ title: "Book" });
    expect(await invoke(IPC.PROJECT_CREATE, input)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_LOCATION_REQUIRED" },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      "project.created",
      expect.objectContaining({
        projectId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
  });

  it("handles cancelled selection without creating a project", async () => {
    const { selectFolder, invoke, create } = setup();
    selectFolder.mockResolvedValue(null);
    expect(await invoke(IPC.PROJECT_SELECT_LOCATION)).toEqual({
      ok: true,
      value: null,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects malformed requests, arbitrary paths and forged grants", async () => {
    const { invoke, request, create } = setup();
    const input = await request();
    for (const payload of [
      { ...input, title: " " },
      { ...input, projectPath: "/outside" },
      undefined,
    ]) {
      expect(await invoke(IPC.PROJECT_CREATE, payload)).toMatchObject({
        ok: false,
        error: { code: "PROJECT_INPUT_INVALID" },
      });
    }
    expect(
      await invoke(IPC.PROJECT_SELECT_LOCATION, { path: "/outside" }),
    ).toMatchObject({ ok: false });
    expect(
      await invoke(IPC.PROJECT_CREATE, {
        ...input,
        locationToken: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PROJECT_LOCATION_REQUIRED" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects foreign senders, subframes and navigated pages", async () => {
    const { invoke, request, create, event, frame, selectFolder } = setup();
    const input = await request();
    for (const source of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: rendererUrl } },
    ])
      expect(
        await invoke(IPC.PROJECT_CREATE, input, source as IpcMainInvokeEvent),
      ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
    frame.url = "https://untrusted.example/";
    expect(await invoke(IPC.PROJECT_CREATE, input)).toMatchObject({
      ok: false,
    });
    expect(await invoke(IPC.PROJECT_SELECT_LOCATION)).toMatchObject({
      ok: false,
    });
    expect(selectFolder).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    "PROJECT_DESTINATION_NOT_EMPTY",
    "PROJECT_CREATE_CLEANUP_FAILED",
    "unknown",
  ])("returns safe actionable errors for %s", async (code) => {
    const { invoke, request, create, logger } = setup();
    create.mockRejectedValue(
      new ApplicationError(code, "private author content"),
    );
    const result = await invoke(IPC.PROJECT_CREATE, await request());
    expect(result).toMatchObject({
      ok: false,
      error: { code: code === "unknown" ? "PROJECT_CREATE_FAILED" : code },
    });
    expect(JSON.stringify(result)).not.toContain("private author content");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "private author content",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "project.create_failed",
      expect.objectContaining({
        errorName: "ApplicationError",
        errorCode: code === "unknown" ? "UNKNOWN_ERROR" : code,
        durationMs: expect.any(Number),
      }),
    );
  });

  it("serializes requests so repeated submissions cannot create twice", async () => {
    const { invoke, request, create } = setup();
    let reject!: (error: Error) => void;
    create.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const input = await request();
    const first = invoke(IPC.PROJECT_CREATE, input);
    expect(await invoke(IPC.PROJECT_CREATE, input)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_BUSY" },
    });
    reject(new Error("failure"));
    await first;
    expect(create).toHaveBeenCalledOnce();
  });
});
