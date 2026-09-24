import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { RecoveryService } from "@drelwick/core";
import {
  IPC,
  createUuid,
  type ProjectOperationResult,
  type SafeLogger,
} from "@drelwick/shared";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle }, dialog: {} }));
import { registerRecoveryHandlers } from "../src/main/ipc/recovery-handlers.js";
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";

beforeEach(() => vi.restoreAllMocks());
function setup(scanError?: string) {
  handle.mockReset();
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
  const service = new RecoveryService();
  const cancel = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies SafeLogger;
  const candidate = {
    id: createUuid(),
    projectPath: "/books/book",
    chapterId: createUuid(),
    title: "Chapter",
    created: "2026-09-18T16:05:00.000Z",
    source: "temporary" as const,
    path: "/private/path",
    document: { secret: "manuscript" },
  };
  const list = vi.spyOn(service, "getCandidates").mockReturnValue([candidate]);
  const recover = vi
    .spyOn(service, "recoverCandidate")
    .mockImplementation(async () => {
      list.mockReturnValue([]);
      return {};
    });
  const discard = vi
    .spyOn(service, "discardCandidate")
    .mockImplementation(async () => {
      list.mockReturnValue([]);
      return {};
    });
  registerRecoveryHandlers(
    () => window,
    frame.url,
    service,
    cancel,
    scanError,
    logger,
  );
  const invoke = (
    channel: string,
    payload?: unknown,
    source = event,
  ): Promise<ProjectOperationResult<unknown>> => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )?.[1] as (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ) => Promise<ProjectOperationResult<unknown>>;
    return handler(source, payload);
  };
  return {
    invoke,
    candidate,
    event,
    recover,
    discard,
    cancel,
    window,
    frame,
    list,
    logger,
  };
}
it("returns metadata only and routes explicit decisions by opaque ID", async () => {
  const { invoke, candidate, recover, logger } = setup();
  const result = await invoke(IPC.RECOVERY_LIST);
  expect(result).toEqual({
    ok: true,
    value: [
      {
        id: candidate.id,
        projectPath: candidate.projectPath,
        chapterId: candidate.chapterId,
        title: candidate.title,
        created: candidate.created,
        source: candidate.source,
      },
    ],
  });
  expect(await invoke(IPC.RECOVERY_RECOVER, { id: candidate.id })).toEqual({
    ok: true,
    value: [],
  });
  expect(recover).toHaveBeenCalledExactlyOnceWith(candidate.id);
  expect(logger.info).toHaveBeenCalledWith("recovery.recovered", {
    candidateId: candidate.id,
    chapterId: candidate.chapterId,
    source: candidate.source,
    durationMs: expect.any(Number),
  });
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain("manuscript");
});
it("routes discard and cancel without recovering", async () => {
  const { invoke, candidate, recover, discard, cancel } = setup();
  await invoke(IPC.RECOVERY_DISCARD, { id: candidate.id });
  expect(discard).toHaveBeenCalledExactlyOnceWith(candidate.id);
  const cancelled = setup();
  await cancelled.invoke(IPC.RECOVERY_CANCEL);
  expect(cancelled.cancel).toHaveBeenCalledOnce();
  expect(cancel).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
});
it("rejects other senders, subframes, wrong URLs and arbitrary path payloads", async () => {
  const { invoke, candidate, event, frame, recover } = setup();
  for (const source of [
    { ...event, sender: {} },
    { ...event, senderFrame: { url: frame.url } },
  ]) {
    expect(
      await invoke(
        IPC.RECOVERY_RECOVER,
        { id: candidate.id },
        source as IpcMainInvokeEvent,
      ),
    ).toMatchObject({ ok: false, error: { code: "RECOVERY_ACCESS_DENIED" } });
  }
  expect(
    await invoke(IPC.RECOVERY_RECOVER, {
      id: candidate.id,
      path: "/arbitrary",
    }),
  ).toMatchObject({ ok: false, error: { code: "RECOVERY_INPUT_INVALID" } });
  expect(
    await invoke(IPC.RECOVERY_DISCARD, { id: "../chapter" }),
  ).toMatchObject({ ok: false });
  frame.url = "https://untrusted.invalid";
  expect(await invoke(IPC.RECOVERY_LIST)).toMatchObject({
    ok: false,
    error: { code: "RECOVERY_ACCESS_DENIED" },
  });
  expect(recover).not.toHaveBeenCalled();
});
it("keeps project operations blocked while startup recovery is pending", async () => {
  const { invoke, window, frame, list } = setup();
  const open = vi.fn();
  registerProjectHandlers(() => window, frame.url, {
    startupBlocked: () => list().length > 0,
    selectExistingFolder: open,
  });
  expect(await invoke(IPC.PROJECT_OPEN)).toMatchObject({ ok: false });
  expect(open).not.toHaveBeenCalled();
});
it("blocks concurrent decisions and cancellation until the write finishes", async () => {
  const { invoke, candidate, recover, cancel } = setup();
  let resume!: () => void;
  recover.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resume = () => resolve({});
      }),
  );
  const pending = invoke(IPC.RECOVERY_RECOVER, { id: candidate.id });
  expect(await invoke(IPC.RECOVERY_CANCEL)).toMatchObject({
    ok: false,
    error: { code: "RECOVERY_BUSY" },
  });
  expect(cancel).not.toHaveBeenCalled();
  resume();
  await pending;
});
it("reports safe errors and allows cancellation after a scan failure", async () => {
  const first = setup();
  first.recover.mockRejectedValue(new Error("private manuscript"));
  expect(
    await first.invoke(IPC.RECOVERY_RECOVER, { id: first.candidate.id }),
  ).toEqual({
    ok: false,
    error: {
      code: "RECOVERY_FAILED",
      message: "Recovery could not complete. Retry or cancel startup.",
    },
  });
  expect(JSON.stringify(first.logger.error.mock.calls)).not.toContain(
    "private manuscript",
  );
  const second = setup("Scan failed; cancel startup and retry.");
  expect(await second.invoke(IPC.RECOVERY_LIST)).toMatchObject({
    ok: false,
    error: { code: "RECOVERY_SCAN_FAILED" },
  });
  await second.invoke(IPC.RECOVERY_CANCEL);
  expect(second.cancel).toHaveBeenCalledOnce();
});

it("cannot use cancel startup to bypass saves after startup completes", async () => {
  const { invoke, list, cancel } = setup();
  list.mockReturnValue([]);
  expect(await invoke(IPC.RECOVERY_CANCEL)).toMatchObject({
    ok: false,
    error: { code: "RECOVERY_NOT_PENDING" },
  });
  expect(cancel).not.toHaveBeenCalled();
});
