import { ipcMain, type BrowserWindow } from "electron";
import { IPC, IpcRequestSchemas } from "@drelwick/shared";
import type { SpellingService } from "@drelwick/core";

export function registerSpellingHandlers(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl: string,
  service: SpellingService,
): void {
  for (const channel of [
    IPC.SPELLING_GET,
    IPC.SPELLING_UPDATE,
    IPC.SPELLING_CHECK,
    IPC.SPELLING_SUGGEST,
  ]) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const window = getWindow();
      const failure = {
        ok: false as const,
        error: {
          code: "SPELLING_UNAVAILABLE",
          message:
            "Unable to use local spelling settings or resources. Editing remains available. Retry, or check spelling.json and the application installation.",
        },
      };
      if (
        !window ||
        window.isDestroyed() ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame?.url !== rendererUrl
      )
        return failure;
      try {
        // Catch validation errors here, before Electron can serialize author input.
        switch (channel) {
          case IPC.SPELLING_GET:
            IpcRequestSchemas[channel].parse(payload);
            return { ok: true, value: await service.get() };
          case IPC.SPELLING_UPDATE:
            return {
              ok: true,
              value: await service.update(
                IpcRequestSchemas[channel].parse(payload),
              ),
            };
          case IPC.SPELLING_CHECK: {
            const input = IpcRequestSchemas[channel].parse(payload);
            return {
              ok: true,
              value: await service.check(input.language, input.words),
            };
          }
          case IPC.SPELLING_SUGGEST: {
            const input = IpcRequestSchemas[channel].parse(payload);
            return {
              ok: true,
              value: await service.suggest(input.language, input.word),
            };
          }
        }
      } catch {
        return failure;
      }
    });
  }
}
