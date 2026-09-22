import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import {
  IPC,
  type ProjectOperationResult,
  type ProjectWorkspace,
} from "@bookeditor/shared";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle }, dialog: {} }));
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function setup() {
  handle.mockReset();
  const copy = await copyFixture("minimal-book");
  copies.push(copy);
  const source = join(copy.projectPath, "synthetic.png");
  await writeFile(source, await syntheticImage());
  const frame = { url: "file:///app/index.html" };
  const contents = { mainFrame: frame };
  const window = {
    isDestroyed: () => false,
    webContents: contents,
  } as unknown as BrowserWindow;
  const event = {
    sender: contents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const picker = vi.fn(async (): Promise<string | null> => source);
  const history = {
    scheduleSnapshot: vi.fn(),
    scheduleRetention: vi.fn(),
    settleProject: async () => undefined,
    closeProject: async () => undefined,
    settleAll: async () => undefined,
    shutdown: async () => undefined,
  };
  registerProjectHandlers(() => window, frame.url, {
    selectExistingFolder: async () => copy.projectPath,
    selectImage: picker,
    history,
  });
  const invoke = async (
    channel: string,
    payload?: unknown,
    sender = event,
  ): Promise<ProjectOperationResult<unknown>> => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )?.[1] as (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ) => Promise<ProjectOperationResult<unknown>>;
    return handler(sender, payload);
  };
  const opened = (await invoke(
    IPC.PROJECT_OPEN,
  )) as ProjectOperationResult<ProjectWorkspace>;
  if (!opened.ok) throw new Error("Fixture open failed");
  return {
    invoke,
    picker,
    event,
    source,
    projectId: opened.value.projectId,
    chapterId: opened.value.chapters[0]!.id,
  };
}
it("imports through the native picker and exposes only managed bytes and identity", async () => {
  const f = await setup();
  const result = await f.invoke(IPC.IMAGE_IMPORT, {
    projectId: f.projectId,
    chapterId: f.chapterId,
  });
  expect(result).toEqual({ ok: true, value: { assetId: expect.any(String) } });
  if (!result.ok) throw new Error("Import failed");
  expect(JSON.stringify(result)).not.toContain(f.source);
  const value = result.value as { assetId: string };
  expect(
    await f.invoke(IPC.IMAGE_READ, {
      projectId: f.projectId,
      assetId: value.assetId,
    }),
  ).toEqual({
    ok: true,
    value: {
      dataUrl: `data:image/png;base64,${(await syntheticImage()).toString("base64")}`,
    },
  });
  f.picker.mockResolvedValueOnce(null);
  expect(
    await f.invoke(IPC.IMAGE_IMPORT, {
      projectId: f.projectId,
      chapterId: f.chapterId,
    }),
  ).toEqual({ ok: true, value: null });
});
it("rejects untrusted frames, paths, crafted IDs, foreign projects and unknown chapters before selection", async () => {
  const f = await setup();
  const input = { projectId: f.projectId, chapterId: f.chapterId };
  expect(
    await f.invoke(IPC.IMAGE_IMPORT, input, {
      ...f.event,
      senderFrame: { url: "https://untrusted.invalid" },
    } as IpcMainInvokeEvent),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  for (const payload of [
    { ...input, sourcePath: f.source },
    { ...input, projectId: "00000000-0000-4000-8000-000000000099" },
    { ...input, chapterId: "00000000-0000-4000-8000-000000000099" },
  ])
    expect(await f.invoke(IPC.IMAGE_IMPORT, payload)).toMatchObject({
      ok: false,
    });
  expect(f.picker).not.toHaveBeenCalled();
  for (const assetId of [
    "../file",
    "C:\\image.png",
    "https://remote.invalid/x",
    "\\\\host\\x",
  ])
    expect(
      await f.invoke(IPC.IMAGE_READ, { projectId: f.projectId, assetId }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(
    await f.invoke(IPC.IMAGE_READ, {
      projectId: f.projectId,
      assetId: "00000000-0000-4000-8000-000000000099",
    }),
  ).toMatchObject({ ok: false, error: { code: "IMAGE_UNAVAILABLE" } });
});
it("does not leak external paths or raw failure payloads", async () => {
  const f = await setup();
  f.picker.mockRejectedValueOnce(new Error(`private path ${f.source}`));
  const result = await f.invoke(IPC.IMAGE_IMPORT, {
    projectId: f.projectId,
    chapterId: f.chapterId,
  });
  expect(result).toMatchObject({ ok: false });
  expect(JSON.stringify(result)).not.toContain(f.source);
});
