import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { openProject, saveChapter } from "@drelwick/core";
import { IPC } from "@drelwick/shared";
const { handle, showSaveDialog, showMessageBox } = vi.hoisted(() => ({
  handle: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle },
  dialog: { showSaveDialog, showMessageBox },
}));
import { exportDocx } from "../src/main/docx-export.js";
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";
import { exportSavedDocx } from "../src/renderer/docx-export.js";
const copies: FixtureCopy[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  showMessageBox.mockResolvedValue({ response: 1 });
});
afterEach(async () => {
  await Promise.all(copies.splice(0).map((c) => c.cleanup()));
});
async function fixture() {
  const copy = await copyFixture("minimal-book");
  copies.push(copy);
  const session = await openProject(copy.projectPath);
  const path = join(dirname(copy.projectPath), "export.docx");
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: path });
  return {
    ...copy,
    path,
    projectId: session.project.projectId,
    chapterId: session.chapters[0]!.id,
  };
}
const window = {} as BrowserWindow;

it("uses the native .docx destination; cancellation and declined overwrite leave files unchanged", async () => {
  const f = await fixture();
  showSaveDialog.mockResolvedValueOnce({ canceled: true });
  expect(
    (await exportDocx(window, f.projectPath, f.projectId, () => true)).created,
  ).toBe(false);
  expect(await readdir(dirname(f.path))).not.toContain("export.docx");
  const bytes = Buffer.from("existing independent author document");
  await writeFile(f.path, bytes);
  showMessageBox.mockResolvedValueOnce({ response: 0 });
  expect(
    (await exportDocx(window, f.projectPath, f.projectId, () => true)).created,
  ).toBe(false);
  expect(await readFile(f.path)).toEqual(bytes);
  expect(
    (await exportDocx(window, f.projectPath, f.projectId, () => true)).created,
  ).toBe(true);
  expect((await readFile(f.path)).subarray(0, 2).toString()).toBe("PK");
  expect(showSaveDialog).toHaveBeenCalledWith(
    window,
    expect.objectContaining({
      filters: [{ name: "Word manuscript", extensions: ["docx"] }],
    }),
  );
});
it("reviews located fidelity findings before choosing a destination and cancels safely", async () => {
  const f = await fixture();
  await saveChapter({
    projectPath: f.projectPath,
    chapterId: f.chapterId,
    document: { type: "doc", content: [{ type: "sceneBreak" }] },
  });
  showMessageBox.mockResolvedValueOnce({ response: 0 });
  const result = await exportDocx(
    window,
    f.projectPath,
    f.projectId,
    () => true,
  );
  expect(result.created).toBe(false);
  expect(result.warnings[0]).toMatchObject({
    chapterId: f.chapterId,
    path: [0],
    construct: "sceneBreak",
  });
  expect(showSaveDialog).not.toHaveBeenCalled();
  expect(showMessageBox.mock.calls[0]?.[1].detail).toContain("Item 1, block 1");
});
it("rechecks window authorization after a native dialog and preserves existing output", async () => {
  const f = await fixture();
  await writeFile(f.path, "previous");
  let allowed = true;
  showSaveDialog.mockImplementationOnce(async () => {
    allowed = false;
    return { canceled: false, filePath: f.path };
  });
  await expect(
    exportDocx(window, f.projectPath, f.projectId, () => allowed),
  ).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
  expect(await readFile(f.path, "utf8")).toBe("previous");
});
it("validates trusted frame, active project, payload and busy state; no renderer output path is accepted", async () => {
  const f = await fixture();
  const frame = { url: "file:///app/index.html" };
  const webContents = { mainFrame: frame };
  const w = {
    isDestroyed: () => false,
    webContents,
  } as unknown as BrowserWindow;
  const event = {
    sender: webContents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  let finish!: () => void;
  const exporter = vi.fn(async () => {
    await new Promise<void>((r) => {
      finish = r;
    });
    return { created: true, revision: "revision", warnings: [] };
  });
  const tasks = registerProjectHandlers(() => w, frame.url, {
    selectExistingFolder: async () => f.projectPath,
    open: openProject,
    exportDocx: exporter,
  });
  const invoke = (channel: string, payload?: unknown, source = event) =>
    (
      handle.mock.calls.find(([c]) => c === channel)![1] as (
        event: IpcMainInvokeEvent,
        payload: unknown,
      ) => Promise<unknown>
    )(source, payload);
  expect(
    await invoke(IPC.DOCX_EXPORT, { projectId: f.projectId }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_OPEN" } });
  await invoke(IPC.PROJECT_OPEN);
  expect(
    await invoke(IPC.DOCX_EXPORT, { projectId: f.projectId, path: f.path }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(
    await invoke(IPC.DOCX_EXPORT, { projectId: f.projectId }, {
      ...event,
      senderFrame: { url: frame.url },
    } as IpcMainInvokeEvent),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  const exporting = invoke(IPC.DOCX_EXPORT, { projectId: f.projectId });
  await vi.waitFor(() => expect(exporter).toHaveBeenCalledOnce());
  expect(
    await invoke(IPC.DOCX_EXPORT, { projectId: f.projectId }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_BUSY" } });
  expect(exporter.mock.calls[0]).toEqual([
    w,
    f.projectPath,
    f.projectId,
    expect.any(Function),
  ]);
  finish();
  expect(await exporting).toMatchObject({ ok: true, value: { created: true } });
  await tasks.stopHistory();
});
it("flushes before export and refuses failed or newly dirtied revisions", async () => {
  const order: string[] = [];
  const publish = vi.fn(async () => {
    order.push("export");
    return true;
  });
  await exportSavedDocx({
    flush: async () => {
      order.push("save");
      return true;
    },
    dirty: () => false,
    export: publish,
  });
  expect(order).toEqual(["save", "export"]);
  publish.mockClear();
  for (const [saved, dirty] of [
    [false, true],
    [true, true],
  ]) {
    await expect(
      exportSavedDocx({
        flush: async () => saved!,
        dirty: () => dirty!,
        export: publish,
      }),
    ).rejects.toThrow("pending edits");
    expect(publish).not.toHaveBeenCalled();
  }
});
