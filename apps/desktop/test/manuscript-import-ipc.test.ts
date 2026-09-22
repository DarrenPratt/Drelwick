import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import {
  IPC,
  type ProjectOperationResult,
  type ImportInspection,
} from "@sarel/shared";
import { IsolatedManuscriptImporter } from "@sarel/core";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle }, dialog: {} }));
import { registerImportHandlers } from "../src/main/ipc/import-handlers.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(program?: string) {
  handle.mockReset();
  const root = await mkdtemp(join(tmpdir(), "sarel-import-ipc-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const destination = join(root, "destination");
  await writeFile(source, "source unchanged");
  await mkdir(destination);
  const frame = { url: "file:///app/index.html" };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame });
  const window = {
    isDestroyed: () => false,
    webContents: contents,
  } as unknown as BrowserWindow;
  const event = {
    sender: contents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const value = {
    metadata: { title: "Imported", author: "Author", language: "en" },
    chapters: [
      {
        title: "Opening",
        type: "chapter",
        content: { type: "doc", content: [] },
      },
    ],
    assets: [],
    warnings: [],
  };
  const picker = vi.fn(async (): Promise<string | null> => source);
  const destinationPicker = vi.fn(
    async (): Promise<string | null> => destination,
  );
  const dispose = registerImportHandlers(() => window, frame.url, {
    selectSource: picker,
    selectDestination: destinationPicker,
    importers: new Map([
      [
        "synthetic",
        new IsolatedManuscriptImporter(
          program ?? `() => ${JSON.stringify(JSON.stringify(value))}`,
        ),
      ],
    ]),
  });
  cleanups.push(dispose);
  const invoke = (
    channel: string,
    payload: unknown,
    sender = event,
  ): Promise<ProjectOperationResult<unknown>> => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )![1] as (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ) => Promise<ProjectOperationResult<unknown>>;
    return handler(sender, payload);
  };
  const operationId = randomUUID();
  const inspect = () =>
    invoke(IPC.IMPORT_INSPECT, { operationId, importer: "synthetic" });
  return {
    root,
    source,
    destination,
    contents,
    frame,
    event,
    picker,
    destinationPicker,
    invoke,
    operationId,
    inspect,
  };
}
it("exposes a path-free preview and commits only following a separate native destination selection", async () => {
  const f = await setup();
  const result =
    (await f.inspect()) as ProjectOperationResult<ImportInspection>;
  expect(result.ok).toBe(true);
  expect(JSON.stringify(result)).not.toContain(f.root);
  expect(f.destinationPicker).not.toHaveBeenCalled();
  expect(await readdir(f.destination)).toEqual([]);
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, { operationId: f.operationId }),
  ).toMatchObject({ ok: true, value: { projectId: expect.any(String) } });
  expect(await readFile(f.source, "utf8")).toBe("source unchanged");
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, { operationId: f.operationId }),
  ).toMatchObject({ ok: false });
});
it("rejects source/destination paths, arbitrary parser programs, wrong frames and unauthorized operation tokens", async () => {
  const f = await setup();
  for (const extra of [
    { sourcePath: f.source },
    { destinationPath: f.destination },
    { program: "require('fs')" },
  ]) {
    expect(
      await f.invoke(IPC.IMPORT_INSPECT, {
        operationId: f.operationId,
        importer: "synthetic",
        ...extra,
      }),
    ).toMatchObject({ ok: false });
  }
  expect(
    await f.invoke(
      IPC.IMPORT_INSPECT,
      { operationId: f.operationId, importer: "synthetic" },
      { ...f.event, senderFrame: { url: f.frame.url } } as IpcMainInvokeEvent,
    ),
  ).toMatchObject({ ok: false });
  expect(f.picker).not.toHaveBeenCalled();
  await f.inspect();
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, { operationId: randomUUID() }),
  ).toMatchObject({ ok: false });
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, {
      operationId: f.operationId,
      destinationPath: f.destination,
    }),
  ).toMatchObject({ ok: false });
  expect(f.destinationPicker).not.toHaveBeenCalled();
});
it("cancels previews and retains a preview when destination selection is dismissed", async () => {
  const f = await setup();
  await f.inspect();
  f.destinationPicker.mockResolvedValueOnce(null);
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, { operationId: f.operationId }),
  ).toEqual({ ok: true, value: null });
  expect(
    await f.invoke(IPC.IMPORT_CANCEL, { operationId: f.operationId }),
  ).toEqual({ ok: true, value: null });
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, { operationId: f.operationId }),
  ).toMatchObject({ ok: false });
  expect(await readdir(f.destination)).toEqual([]);
});
it("cancellation bypasses a busy parser and prevents later commit", async () => {
  const f = await setup("() => { while(true) {} }");
  const pending = f.inspect();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(
    await f.invoke(IPC.IMPORT_CANCEL, { operationId: f.operationId }),
  ).toEqual({ ok: true, value: null });
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "IMPORT_CANCELLED" },
  });
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, { operationId: f.operationId }),
  ).toMatchObject({ ok: false });
});
it("navigation abandons the staged capability", async () => {
  const f = await setup();
  await f.inspect();
  f.contents.emit("did-start-navigation");
  expect(
    await f.invoke(IPC.IMPORT_COMMIT, { operationId: f.operationId }),
  ).toMatchObject({ ok: false });
  expect(await readdir(f.destination)).toEqual([]);
});
