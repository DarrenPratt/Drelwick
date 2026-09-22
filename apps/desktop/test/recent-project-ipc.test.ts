import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProject, openProject } from "@sarel/core";
import { createUuid, IPC } from "@sarel/shared";
import { RecentProjects } from "../src/main/recent-projects.js";

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

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sarel-recent-ipc-"));
  directories.push(root);
  const book = join(root, "book");
  await createProject({
    projectPath: book,
    title: "Test book",
    author: "Writer",
    language: "en-GB",
  });
  const recents = new RecentProjects(join(root, "userData"));
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
  const open = vi.fn(openProject);
  const selectExistingFolder = vi.fn(async () => book);
  registerProjectHandlers(() => window, frame.url, {
    recents,
    open,
    selectExistingFolder,
    selectFolder: async () => join(root, "new-book"),
  });
  const invoke = async (channel: string, payload?: unknown, source = event) => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )?.[1] as (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    return handler(source, payload);
  };
  return {
    root,
    book,
    recents,
    frame,
    event,
    open,
    invoke,
    selectExistingFolder,
  };
}

it("tracks native opens and creations, reopens by ID without a picker and leaves project files portable", async () => {
  const { root, book, recents, invoke, selectExistingFolder } = await setup();
  const before = await Promise.all(
    ["project.json", "book.json"].map((file) =>
      readFile(join(book, file), "utf8"),
    ),
  );
  expect(await invoke(IPC.PROJECT_OPEN)).toMatchObject({ ok: true });
  const [recent] = await recents.list();
  expect(await invoke(IPC.RECENT_OPEN, { id: recent!.id })).toMatchObject({
    ok: true,
    value: { title: "Test book" },
  });
  expect(selectExistingFolder).toHaveBeenCalledOnce();
  expect(await recents.list()).toHaveLength(1);
  expect(
    await Promise.all(
      ["project.json", "book.json"].map((file) =>
        readFile(join(book, file), "utf8"),
      ),
    ),
  ).toEqual(before);
  const location = (await invoke(IPC.PROJECT_SELECT_LOCATION)) as {
    value: { token: string };
  };
  expect(
    await invoke(IPC.PROJECT_CREATE, {
      title: "New book",
      author: "Writer",
      language: "en-GB",
      locationToken: location.value.token,
    }),
  ).toMatchObject({ ok: true });
  expect((await recents.list()).map((entry) => entry.title)).toEqual([
    "New book",
    "Test book",
  ]);
  for (const file of ["project.json", "book.json"]) {
    const contents = await readFile(join(root, "new-book", file), "utf8");
    expect(contents).not.toContain("projectPath");
    expect(contents).not.toContain("recent");
    expect(contents).not.toContain(JSON.stringify(root).slice(1, -1));
  }
});

it("reports missing folders safely, retains the entry and supports persistent removal", async () => {
  const { book, recents, invoke } = await setup();
  await invoke(IPC.PROJECT_OPEN);
  const [recent] = await recents.list();
  await rm(book, { recursive: true });
  expect(await invoke(IPC.RECENT_OPEN, { id: recent!.id })).toMatchObject({
    ok: false,
    error: { message: expect.any(String) },
  });
  expect(await recents.list()).toHaveLength(1);
  expect(await invoke(IPC.RECENT_REMOVE, { id: recent!.id })).toEqual({
    ok: true,
    value: [],
  });
  expect(await invoke(IPC.RECENT_OPEN, { id: recent!.id })).toMatchObject({
    ok: false,
    error: { code: "RECENT_NOT_FOUND" },
  });
});

it("rejects forged IDs, arbitrary paths, malformed payloads and untrusted frames", async () => {
  const { invoke, event, open } = await setup();
  for (const channel of [IPC.RECENT_LIST, IPC.RECENT_OPEN, IPC.RECENT_REMOVE]) {
    expect(await invoke(channel, { path: "/unapproved" })).toMatchObject({
      ok: false,
      error: { code: "PROJECT_INPUT_INVALID" },
    });
    expect(
      await invoke(channel, { id: createUuid() }, {
        ...event,
        senderFrame: {},
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  }
  expect(await invoke(IPC.RECENT_OPEN, { id: createUuid() })).toMatchObject({
    ok: false,
    error: { code: "RECENT_NOT_FOUND" },
  });
  expect(
    await invoke(IPC.RECENT_OPEN, { id: createUuid(), path: "/unapproved" }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(open).not.toHaveBeenCalled();
});

it("keeps successful opening usable when tracking fails and sanitizes settings failures", async () => {
  const { recents, invoke } = await setup();
  vi.spyOn(recents, "add").mockRejectedValue(new Error("private details"));
  const result = await invoke(IPC.PROJECT_OPEN);
  expect(result).toMatchObject({ ok: true, warning: expect.any(String) });
  expect(JSON.stringify(result)).not.toContain("private details");
  vi.spyOn(recents, "list").mockRejectedValue(new Error("private details"));
  expect(await invoke(IPC.RECENT_LIST)).toMatchObject({
    ok: false,
    error: { code: "RECENT_SETTINGS_FAILED" },
  });
});

it("rechecks the frame after resolving an ID and serializes recent removal with opening", async () => {
  const { book, recents, frame, open, invoke } = await setup();
  await recents.add(book, "Book");
  const [recent] = await recents.list();
  let finish!: () => void;
  vi.spyOn(recents, "find").mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    frame.url = "https://untrusted.example/";
    return recent;
  });
  const pending = invoke(IPC.RECENT_OPEN, { id: recent!.id });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(await invoke(IPC.RECENT_REMOVE, { id: recent!.id })).toMatchObject({
    ok: false,
    error: { code: "PROJECT_BUSY" },
  });
  finish();
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "PROJECT_ACCESS_DENIED" },
  });
  expect(open).not.toHaveBeenCalled();
});
