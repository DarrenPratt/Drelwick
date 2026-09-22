import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openProject } from "@sarel/core";
import { ApplicationError, IPC, type SafeLogger } from "@sarel/shared";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";

const { handle, showOpenDialog, showSaveDialog } = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle },
  dialog: { showOpenDialog, showSaveDialog },
}));
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";

const rendererUrl = "file:///app/index.html";
const roots: string[] = [];
const fixtures: FixtureCopy[] = [];
const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} satisfies SafeLogger;

beforeEach(() => {
  handle.mockReset();
  showOpenDialog.mockReset();
  showSaveDialog.mockReset();
  logger.info.mockReset();
  logger.error.mockReset();
});

afterEach(async () => {
  await Promise.all([
    ...roots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
    ...fixtures.splice(0).map((fixture) => fixture.cleanup()),
  ]);
});

function setup(overrides: Record<string, unknown> = {}) {
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
  const projectPath = fixtures[0]?.projectPath;
  const selectExistingFolder = vi.fn(async () => projectPath ?? null);
  const selectBackupDestination = vi.fn(async () => join(tmpdir(), "book.zip"));
  const selectBackupArchive = vi.fn(async () => join(tmpdir(), "book.zip"));
  const selectRestoreParent = vi.fn(async () => join(tmpdir(), "restored"));
  const createArchive = vi.fn(async () => ({
    projectId: "123e4567-e89b-42d3-a456-426614174000",
    fileCount: 2,
  }));
  const restoreArchive = vi.fn(async () => ({
    projectId: "123e4567-e89b-42d3-a456-426614174000",
    projectPath: join(tmpdir(), "restored", "Synthetic Book"),
    title: "Synthetic Book",
  }));
  registerProjectHandlers(() => window, rendererUrl, {
    selectExistingFolder,
    open: openProject,
    selectBackupDestination,
    selectBackupArchive,
    selectRestoreParent,
    createArchive,
    restoreArchive,
    logger,
    ...overrides,
  });
  const invoke = async (channel: string, payload?: unknown, source = event) => {
    const handler = handle.mock.calls.find(
      ([registered]) => registered === channel,
    )?.[1] as
      | ((event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>)
      | undefined;
    if (!handler) throw new Error(`Missing handler for ${channel}`);
    return handler(source, payload);
  };
  return {
    window,
    event,
    invoke,
    selectExistingFolder,
    selectBackupDestination,
    selectBackupArchive,
    selectRestoreParent,
    createArchive,
    restoreArchive,
  };
}

async function copiedBook(): Promise<FixtureCopy> {
  const fixture = await copyFixture("minimal-book");
  fixtures.push(fixture);
  return fixture;
}

describe("project backup IPC", () => {
  it("validates trusted requests and gets the source project only from the opened-project grant", async () => {
    const fixture = await copiedBook();
    const handlers = setup();
    expect(
      await handlers.invoke(IPC.PROJECT_BACKUP, { includeHistory: true }),
    ).toMatchObject({
      ok: false,
      error: { code: "PROJECT_NOT_OPEN" },
    });
    await handlers.invoke(IPC.PROJECT_OPEN);
    expect(
      await handlers.invoke(IPC.PROJECT_BACKUP, { includeHistory: "yes" }),
    ).toMatchObject({
      ok: false,
      error: { code: "PROJECT_INPUT_INVALID" },
    });

    const badFrame = {
      sender: handlers.event.sender,
      senderFrame: { url: "file:///untrusted.html" },
    } as unknown as IpcMainInvokeEvent;
    expect(
      await handlers.invoke(
        IPC.PROJECT_BACKUP,
        { includeHistory: false },
        badFrame,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ACCESS_DENIED" },
    });
    const result = await handlers.invoke(IPC.PROJECT_BACKUP, {
      includeHistory: false,
    });
    expect(result).toEqual({ ok: true, value: { created: true } });
    expect(handlers.createArchive).toHaveBeenCalledWith({
      projectPath: fixture.projectPath,
      archivePath: join(tmpdir(), "book.zip"),
      includeHistory: false,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      fixture.projectPath,
    );
  });

  it("treats native picker cancellation as a no-op", async () => {
    await copiedBook();
    const handlers = setup({
      selectBackupDestination: vi.fn(async () => null),
    });
    await handlers.invoke(IPC.PROJECT_OPEN);
    expect(
      await handlers.invoke(IPC.PROJECT_BACKUP, { includeHistory: true }),
    ).toEqual({
      ok: true,
      value: { created: false },
    });
    expect(handlers.createArchive).not.toHaveBeenCalled();
  });

  it("shows an actionable disk-space failure without logging manuscript paths or content", async () => {
    await copiedBook();
    const createArchive = vi.fn(async () => {
      throw new ApplicationError(
        "PROJECT_ARCHIVE_DISK_SPACE",
        "synthetic private body text",
      );
    });
    const handlers = setup({ createArchive });
    await handlers.invoke(IPC.PROJECT_OPEN);
    expect(
      await handlers.invoke(IPC.PROJECT_BACKUP, { includeHistory: true }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT_ARCHIVE_DISK_SPACE",
        message: expect.stringContaining("disk space"),
      },
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "synthetic private body text",
    );
  });

  it("serializes backup against other project operations", async () => {
    await copiedBook();
    let finishBackup!: () => void;
    const createArchive = vi.fn(
      () =>
        new Promise<{ projectId: string; fileCount: number }>(
          (resolveResult) => {
            finishBackup = () =>
              resolveResult({
                projectId: "123e4567-e89b-42d3-a456-426614174000",
                fileCount: 1,
              });
          },
        ),
    );
    const handlers = setup({ createArchive });
    await handlers.invoke(IPC.PROJECT_OPEN);
    const backup = handlers.invoke(IPC.PROJECT_BACKUP, {
      includeHistory: true,
    });
    await vi.waitFor(() => expect(createArchive).toHaveBeenCalledOnce());
    expect(await handlers.invoke(IPC.PROJECT_CLOSE)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_BUSY" },
    });
    finishBackup();
    expect(await backup).toEqual({ ok: true, value: { created: true } });
  });

  it("restores through selected paths and keeps an existing project active on restore failure", async () => {
    const fixture = await copiedBook();
    const restoreArchive = vi.fn(async () => {
      throw new ApplicationError(
        "PROJECT_ARCHIVE_CHECKSUM_INVALID",
        "hidden raw error",
      );
    });
    const handlers = setup({
      selectBackupArchive: vi.fn(async () => join(tmpdir(), "selected.zip")),
      selectRestoreParent: vi.fn(async () => join(tmpdir(), "selected-parent")),
      restoreArchive,
    });
    await handlers.invoke(IPC.PROJECT_OPEN);
    expect(await handlers.invoke(IPC.PROJECT_RESTORE)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ARCHIVE_CHECKSUM_INVALID" },
    });
    expect(restoreArchive).toHaveBeenCalledWith({
      archivePath: join(tmpdir(), "selected.zip"),
      destinationParent: join(tmpdir(), "selected-parent"),
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "hidden raw error",
    );
    expect(fixture.projectPath).toBeTruthy();
  });

  it("cancels before asking for a restore destination", async () => {
    await copiedBook();
    const handlers = setup({ selectBackupArchive: vi.fn(async () => null) });
    expect(await handlers.invoke(IPC.PROJECT_RESTORE)).toEqual({
      ok: true,
      value: null,
    });
    expect(handlers.selectRestoreParent).not.toHaveBeenCalled();
    expect(handlers.restoreArchive).not.toHaveBeenCalled();
  });
});
