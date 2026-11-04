import { expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { IPC } from "@drelwick/shared";
import { revisionProject } from "../../../tests/helpers/revision-project.js";
const callbacks = vi.hoisted(
  () =>
    new Map<
      string,
      (
        event: IpcMainInvokeEvent,
        payload: unknown,
      ) => Promise<{
        ok: boolean;
        value?: unknown;
        error?: { code: string; message: string };
      }>
    >(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel, callback) => callbacks.set(channel, callback)),
  },
}));
import { registerRevisionHandler } from "../src/main/ipc/revision-handler.js";
it("F01/R06 restricts revision previews to their frame/session and never writes on preview, cancellation or stale bulk decisions", async () => {
  const f = await revisionProject();
  try {
    let epoch = 1,
      busy = false;
    const frame = {},
      event = { senderFrame: frame } as IpcMainInvokeEvent;
    const handler = registerRevisionHandler({
      trusted: (e) => e.senderFrame === frame,
      session: () => ({
        projectPath: f.projectPath,
        projectId: f.projectId,
        epoch,
      }),
      busy: () => busy,
      setBusy: (value) => {
        busy = value;
      },
      settle: async () => undefined,
    });
    const invoke = (payload: unknown, e = event) =>
      callbacks.get(IPC.REVISION_ACTION)!(e, payload);
    const before = await readFile(f.chapterPath),
      request = {
        operation: "preview",
        projectId: f.projectId,
        chapterId: f.chapterId,
        ids: f.view.state.review.pending.map((g) => g.id),
        action: "accept",
      };
    const preview = await invoke(request);
    expect(preview.ok).toBe(true);
    expect(await readFile(f.chapterPath)).toEqual(before);
    const token = (preview.value as { token: string }).token;
    expect(
      (
        await invoke(
          {
            operation: "commit",
            projectId: f.projectId,
            token,
            operationId: randomUUID(),
          },
          { senderFrame: {} } as IpcMainInvokeEvent,
        )
      ).error?.code,
    ).toBe("PROJECT_ACCESS_DENIED");
    epoch++;
    expect(
      (
        await invoke({
          operation: "commit",
          projectId: f.projectId,
          token,
          operationId: randomUUID(),
        })
      ).error?.code,
    ).toBe("EDITORIAL_STALE");
    const next = await invoke(request),
      nextToken = (next.value as { token: string }).token;
    await invoke({
      operation: "cancel",
      projectId: f.projectId,
      token: nextToken,
    });
    expect(
      (
        await invoke({
          operation: "commit",
          projectId: f.projectId,
          token: nextToken,
          operationId: randomUUID(),
        })
      ).error?.code,
    ).toBe("EDITORIAL_STALE");
    expect(
      (await invoke({ ...request, ids: [request.ids[0], randomUUID()] })).error
        ?.code,
    ).toBe("EDITORIAL_STALE");
    expect(
      (await invoke({ ...request, chapterId: "../../private" })).error?.code,
    ).toBe("EDITORIAL_INVALID");
    expect(await readFile(f.chapterPath)).toEqual(before);
    handler.clear();
  } finally {
    await f.cleanup();
    callbacks.clear();
  }
});
