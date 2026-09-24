import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createProject,
  createChapter,
  createHistorySnapshot,
  saveChapter,
} from "@drelwick/core";
import { createAutosaveCoordinator } from "@drelwick/core/autosave";
import {
  IPC,
  type ProjectOperationResult,
  type SafeLogger,
} from "@drelwick/shared";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle }, dialog: {} }));
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";

const directories: string[] = [];
beforeEach(() => handle.mockReset());
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "drelwick-save-ipc-"));
  directories.push(root);
  await createProject({
    projectPath: root,
    title: "Book",
    author: "Author",
    language: "en-GB",
  });
  const { chapter } = await createChapter({
    projectPath: root,
    title: "Chapter",
  });
  return {
    root,
    chapterId: chapter.id,
    path: join(root, "manuscript", `${chapter.id}.json`),
  };
}
interface HistoryTestTasks {
  scheduleSnapshot(input: {
    projectPath: string;
    projectId: string;
    chapterId: string;
    document: Record<string, unknown>;
  }): void;
  scheduleRetention(input: { projectPath: string; projectId: string }): void;
  settleProject(projectPath: string): Promise<void>;
  closeProject(projectPath: string): Promise<void>;
  settleAll(): Promise<void>;
  shutdown(): Promise<void>;
}

function setup(path: string, save = saveChapter, history?: HistoryTestTasks) {
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
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies SafeLogger;
  const handlers = registerProjectHandlers(() => window, frame.url, {
    selectExistingFolder: async () => path,
    saveChapter: save,
    logger,
    ...(history ? { history } : {}),
  });
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
    event,
    frame,
    logger,
    settleHistory: handlers.settleHistory,
  };
}
const document = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Formatted prose",
          marks: [{ type: "bold" }, { type: "italic" }],
        },
      ],
    },
    { type: "sceneBreak" },
    { type: "blockquote", content: [{ type: "paragraph" }] },
  ],
};

it("authorizes replacement, validates payloads, preserves marks and never logs search content", async () => {
  const { root, chapterId } = await fixture();
  const { invoke, logger, event } = setup(root);
  await invoke(IPC.PROJECT_OPEN);
  await invoke(IPC.PROJECT_SAVE_CHAPTER, { chapterId, document });
  const request = {
    options: { query: "Formatted", matchCase: false, wholeWord: true },
    replacement: "Private replacement",
    expected: [{ id: chapterId, content: document }],
  };
  expect(
    (await invoke(IPC.MANUSCRIPT_REPLACE, { ...request, projectPath: root }))
      .ok,
  ).toBe(false);
  expect(
    (
      await invoke(IPC.MANUSCRIPT_REPLACE, request, {
        ...event,
        senderFrame: {},
      } as IpcMainInvokeEvent)
    ).ok,
  ).toBe(false);
  expect(await invoke(IPC.MANUSCRIPT_REPLACE, request)).toEqual({
    ok: true,
    value: { matches: 1, chapters: 1 },
  });
  const loaded = await invoke(IPC.PROJECT_LOAD_CHAPTER, { chapterId });
  expect(JSON.stringify(loaded)).toContain("Private replacement");
  expect(JSON.stringify(loaded)).toContain("bold");
  const logs = JSON.stringify([
    logger.info.mock.calls,
    logger.warn.mock.calls,
    logger.error.mock.calls,
  ]);
  expect(logs).not.toContain("Formatted");
  expect(logs).not.toContain("Private replacement");
  expect((await invoke(IPC.MANUSCRIPT_CANCEL_REPLACE, { path: root })).ok).toBe(
    false,
  );
});

it("round trips validated IPC through disk and a fresh main session", async () => {
  const { root, chapterId } = await fixture();
  const { invoke, logger } = setup(root);
  expect((await invoke(IPC.PROJECT_OPEN)).ok).toBe(true);
  expect(
    await invoke(IPC.PROJECT_SAVE_CHAPTER, { chapterId, document }),
  ).toMatchObject({ ok: true, value: { id: chapterId } });
  expect(logger.info).toHaveBeenCalledWith(
    "chapter.saved",
    expect.objectContaining({
      chapterId,
      source: "autosave",
      durationMs: expect.any(Number),
    }),
  );
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
    "Formatted prose",
  );
  const restarted = setup(root);
  await restarted.invoke(IPC.PROJECT_OPEN);
  expect(
    await restarted.invoke(IPC.PROJECT_LOAD_CHAPTER, { chapterId }),
  ).toEqual({ ok: true, value: { id: chapterId, content: document } });
});

it("retains history on project open and snapshots only successfully saved content", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
  try {
    const { root, chapterId, path } = await fixture();
    const oldSnapshot = await createHistorySnapshot({
      projectPath: root,
      chapterId,
      document,
      now: "2026-08-01T12:00:00.000Z",
      reason: "manual",
    });
    const authoritativeBefore = await readFile(path, "utf8");
    const { invoke, settleHistory } = setup(root);
    expect((await invoke(IPC.PROJECT_OPEN)).ok).toBe(true);
    await settleHistory();
    expect(
      await readdir(join(root, ".history", "snapshots", chapterId)),
    ).toEqual([]);
    expect(await readFile(path, "utf8")).toBe(authoritativeBefore);

    expect(
      await invoke(IPC.PROJECT_SAVE_CHAPTER, { chapterId, document }),
    ).toMatchObject({ ok: true });
    await settleHistory();
    const snapshots = await readdir(
      join(root, ".history", "snapshots", chapterId),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).not.toBe(`${oldSnapshot!.id}.json`);
    expect(
      JSON.parse(
        await readFile(
          join(root, ".history", "snapshots", chapterId, snapshots[0]!),
          "utf8",
        ),
      ),
    ).toMatchObject({ chapterId, reason: "interval", content: document });
    expect(JSON.parse(await readFile(path, "utf8")).content).toEqual(document);
  } finally {
    vi.useRealTimers();
  }
});

it("autosaves a debounced revision through validated IPC to the chapter file", async () => {
  const { root, chapterId, path } = await fixture();
  const save = vi.fn(saveChapter);
  const { invoke } = setup(root, save);
  await invoke(IPC.PROJECT_OPEN);
  let dirty = true;
  const coordinator = createAutosaveCoordinator({
    isDirty: () => dirty,
    save: async () => {
      const result = await invoke(IPC.PROJECT_SAVE_CHAPTER, {
        chapterId,
        document,
      });
      if (result.ok) dirty = false;
      return result.ok;
    },
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    coordinator.edited();
    await vi.advanceTimersByTimeAsync(749);
    expect(save).not.toHaveBeenCalled();
    coordinator.edited();
    await vi.advanceTimersByTimeAsync(750);
    expect(save).toHaveBeenCalledTimes(1);
    // Await the already-started disk write without relying on filesystem timing.
    expect(await coordinator.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      id: chapterId,
      content: document,
    });
    const restarted = setup(root);
    await restarted.invoke(IPC.PROJECT_OPEN);
    expect(
      await restarted.invoke(IPC.PROJECT_LOAD_CHAPTER, { chapterId }),
    ).toEqual({ ok: true, value: { id: chapterId, content: document } });
  } finally {
    coordinator.dispose();
    vi.useRealTimers();
  }
});

it("rejects unauthorized requests, invalid documents and renderer paths without changing disk", async () => {
  const { root, chapterId, path } = await fixture();
  const { invoke, event } = setup(root);
  const request = { chapterId, document };
  expect(await invoke(IPC.PROJECT_SAVE_CHAPTER, request)).toMatchObject({
    ok: false,
    error: { code: "PROJECT_NOT_OPEN" },
  });
  await invoke(IPC.PROJECT_OPEN);
  const before = await readFile(path, "utf8");
  expect(
    await invoke(IPC.PROJECT_SAVE_CHAPTER, request, {
      ...event,
      senderFrame: { url: "file:///app/index.html" },
    } as IpcMainInvokeEvent),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  for (const invalid of [
    { ...request, projectPath: root },
    { ...request, chapterId: "../book" },
    { ...request, document: null },
  ])
    expect(await invoke(IPC.PROJECT_SAVE_CHAPTER, invalid)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_INPUT_INVALID" },
    });
  expect(
    await invoke(IPC.PROJECT_SAVE_CHAPTER, {
      chapterId,
      document: { type: "doc", content: [{ type: "unsupported" }] },
    }),
  ).toMatchObject({ ok: false, error: { code: "CHAPTER_DOCUMENT_INVALID" } });
  expect(await readFile(path, "utf8")).toBe(before);
});

it("blocks overlapping writes and project replacement, and sanitizes failures", async () => {
  const { root, chapterId } = await fixture();
  let reject!: (error: Error) => void;
  const save = vi.fn<typeof saveChapter>(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const { invoke, logger } = setup(root, save);
  await invoke(IPC.PROJECT_OPEN);
  const request = { chapterId, document };
  const pending = invoke(IPC.PROJECT_SAVE_CHAPTER, request);
  expect(await invoke(IPC.PROJECT_SAVE_CHAPTER, request)).toMatchObject({
    ok: false,
    error: { code: "PROJECT_BUSY" },
  });
  expect(await invoke(IPC.PROJECT_OPEN)).toMatchObject({
    ok: false,
    error: { code: "PROJECT_BUSY" },
  });
  reject(new Error("sensitive manuscript body"));
  const result = await pending;
  expect(result).toMatchObject({
    ok: false,
    error: { code: "CHAPTER_SAVE_FAILED" },
  });
  expect(JSON.stringify(result)).not.toContain("sensitive");
  expect(save).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith(
    "chapter.save_failed",
    expect.objectContaining({
      chapterId,
      source: "autosave",
      errorName: "Error",
    }),
  );
  expect(logger.warn).toHaveBeenCalledWith(
    "autosave.failed",
    expect.objectContaining({ chapterId, source: "autosave" }),
  );
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
    "sensitive manuscript body",
  );
  expect((await invoke(IPC.PROJECT_OPEN)).ok).toBe(true);
});

it("does not schedule history for a failed chapter write", async () => {
  const { root, chapterId } = await fixture();
  const history = {
    scheduleSnapshot: vi.fn<HistoryTestTasks["scheduleSnapshot"]>(),
    scheduleRetention: vi.fn<HistoryTestTasks["scheduleRetention"]>(),
    settleProject: vi
      .fn<HistoryTestTasks["settleProject"]>()
      .mockResolvedValue(undefined),
    closeProject: vi
      .fn<HistoryTestTasks["closeProject"]>()
      .mockResolvedValue(undefined),
    settleAll: vi
      .fn<HistoryTestTasks["settleAll"]>()
      .mockResolvedValue(undefined),
    shutdown: vi
      .fn<HistoryTestTasks["shutdown"]>()
      .mockResolvedValue(undefined),
  };
  const save = vi
    .fn<typeof saveChapter>()
    .mockRejectedValue(new Error("disk full"));
  const { invoke } = setup(root, save, history);
  await invoke(IPC.PROJECT_OPEN);
  expect(history.scheduleRetention).toHaveBeenCalledOnce();
  expect(
    await invoke(IPC.PROJECT_SAVE_CHAPTER, { chapterId, document }),
  ).toMatchObject({ ok: false, error: { code: "CHAPTER_SAVE_FAILED" } });
  expect(history.scheduleSnapshot).not.toHaveBeenCalled();
  expect(await invoke(IPC.PROJECT_CLOSE)).toMatchObject({ ok: true });
  expect(history.closeProject).toHaveBeenCalledWith(root);
});

it("validates and authorizes chapter organisation, persists status, and keeps manuscript out of logs", async () => {
  const { root, chapterId } = await fixture();
  const { invoke, event, logger } = setup(root);
  const opened = await invoke(IPC.PROJECT_OPEN);
  if (!opened.ok) throw new Error("Open failed");
  const projectId = (opened.value as { projectId: string }).projectId;
  const request = {
    projectId,
    expectedOrder: [chapterId],
    operation: "status",
    chapterId,
    status: "final",
  };
  for (const invalid of [
    { ...request, status: "invented" },
    { ...request, projectPath: root },
    { ...request, chapterId: "../escape" },
    { ...request, operation: "split", position: -1 },
    {
      ...request,
      operation: "merge",
      chapterIds: [chapterId, chapterId],
      confirmed: false,
    },
  ])
    expect((await invoke(IPC.CHAPTER_ORGANISE, invalid)).ok).toBe(false);
  expect(
    (
      await invoke(IPC.CHAPTER_ORGANISE, request, {
        ...event,
        senderFrame: null,
      } as unknown as IpcMainInvokeEvent)
    ).ok,
  ).toBe(false);
  expect(
    (
      await invoke(IPC.CHAPTER_ORGANISE, {
        ...request,
        projectId: "123e4567-e89b-42d3-a456-426614174000",
      })
    ).ok,
  ).toBe(false);
  expect((await invoke(IPC.CHAPTER_ORGANISE, request)).ok).toBe(true);
  const stored = JSON.parse(
    await readFile(join(root, "manuscript", chapterId + ".json"), "utf8"),
  );
  expect(stored.status).toBe("final");
  expect(stored.id).toBe(chapterId);
  expect(
    JSON.stringify([logger.info.mock.calls, logger.error.mock.calls]),
  ).not.toContain("content");
});
