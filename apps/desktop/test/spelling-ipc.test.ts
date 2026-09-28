import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { SpellingService } from "@drelwick/core";
import { IPC } from "@drelwick/shared";
import { expect, it, vi } from "vitest";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle } }));
import { registerSpellingHandlers } from "../src/main/ipc/spelling-handlers.js";

function fixture() {
  handle.mockReset();
  const frame = { url: "file:///app/index.html" };
  const webContents = { mainFrame: frame };
  const window = {
    webContents,
    isDestroyed: () => false,
  } as unknown as BrowserWindow;
  const event = {
    sender: webContents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const service = {
    get: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    check: vi.fn(async () => ({})),
    suggest: vi.fn(async () => []),
  };
  registerSpellingHandlers(
    () => window,
    frame.url,
    service as unknown as SpellingService,
  );
  const call = (channel: string, payload?: unknown, sender = event) => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )![1] as (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    return handler(sender, payload);
  };
  return { call, service, event, frame, window };
}

it("authorizes only the live main frame and validates every spelling operation", async () => {
  const { call, service, event, frame, window } = fixture();
  for (const channel of [
    IPC.SPELLING_GET,
    IPC.SPELLING_UPDATE,
    IPC.SPELLING_CHECK,
    IPC.SPELLING_SUGGEST,
  ]) {
    for (const sender of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: frame.url } },
      { ...event, senderFrame: null },
    ]) {
      expect(
        await call(channel, undefined, sender as IpcMainInvokeEvent),
      ).toMatchObject({ ok: false });
    }
  }
  frame.url = "https://untrusted.invalid";
  expect(await call(IPC.SPELLING_GET)).toMatchObject({ ok: false });
  frame.url = "file:///app/index.html";
  window.isDestroyed = () => true;
  expect(await call(IPC.SPELLING_GET)).toMatchObject({ ok: false });
  window.isDestroyed = () => false;
  expect(service.get).not.toHaveBeenCalled();
  expect(await call(IPC.SPELLING_GET)).toEqual({ ok: true, value: {} });
  expect(
    await call(IPC.SPELLING_UPDATE, { operation: "add", word: "Drelwick" }),
  ).toMatchObject({ ok: true });
  expect(
    await call(IPC.SPELLING_CHECK, { language: "en-US", words: ["helo"] }),
  ).toMatchObject({ ok: true });
  expect(
    await call(IPC.SPELLING_SUGGEST, { language: "en-US", word: "helo" }),
  ).toMatchObject({ ok: true });
  expect(service.check).toHaveBeenCalledExactlyOnceWith("en-US", ["helo"]);
  expect(service.suggest).toHaveBeenCalledExactlyOnceWith("en-US", "helo");
});

it("rejects paths, oversized batches, invalid words and extra payloads without exposing author data", async () => {
  const { call, service } = fixture();
  for (const [channel, payload] of [
    [IPC.SPELLING_GET, "privatecontent"],
    [
      IPC.SPELLING_UPDATE,
      { operation: "add", word: "privatecontent", path: "C:/arbitrary" },
    ],
    [IPC.SPELLING_UPDATE, { operation: "add", word: "private content" }],
    [
      IPC.SPELLING_UPDATE,
      { operation: "language", language: "../../privatecontent" },
    ],
    [
      IPC.SPELLING_CHECK,
      { language: "en-US", words: Array<string>(257).fill("privatecontent") },
    ],
    [IPC.SPELLING_CHECK, { language: "en-US", words: ["a".repeat(129)] }],
    [IPC.SPELLING_SUGGEST, { language: "en-US", word: "a".repeat(65) }],
  ] as const) {
    const result = await call(channel, payload);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("privatecontent");
  }
  for (const method of Object.values(service))
    expect(method).not.toHaveBeenCalled();
  service.get.mockRejectedValueOnce(new Error("privatecontent"));
  expect(JSON.stringify(await call(IPC.SPELLING_GET))).not.toContain(
    "privatecontent",
  );
});
