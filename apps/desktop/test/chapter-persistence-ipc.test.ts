import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProject, createChapter, saveChapter } from "@bookeditor/core";
import { IPC, type ProjectOperationResult } from "@bookeditor/shared";
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
  const root = await mkdtemp(join(tmpdir(), "bookeditor-save-ipc-"));
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
function setup(path: string, save = saveChapter) {
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
  registerProjectHandlers(() => window, frame.url, {
    selectExistingFolder: async () => path,
    saveChapter: save,
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
  return { invoke, event, frame };
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

it("round trips validated IPC through disk and a fresh main session", async () => {
  const { root, chapterId } = await fixture();
  const { invoke } = setup(root);
  expect((await invoke(IPC.PROJECT_OPEN)).ok).toBe(true);
  expect(
    await invoke(IPC.PROJECT_SAVE_CHAPTER, { chapterId, document }),
  ).toMatchObject({ ok: true, value: { id: chapterId } });
  const restarted = setup(root);
  await restarted.invoke(IPC.PROJECT_OPEN);
  expect(
    await restarted.invoke(IPC.PROJECT_LOAD_CHAPTER, { chapterId }),
  ).toEqual({ ok: true, value: { id: chapterId, content: document } });
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
  const { invoke } = setup(root, save);
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
  expect((await invoke(IPC.PROJECT_OPEN)).ok).toBe(true);
});
