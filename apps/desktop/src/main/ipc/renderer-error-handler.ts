import { ipcMain, type BrowserWindow } from "electron";
import { IPC, IpcRequestSchemas, type SafeLogger } from "@drelwick/shared";

/** Accept sanitized renderer diagnostics only from the trusted top-level frame. */
export function registerRendererErrorHandler(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl: string,
  logger: SafeLogger,
): void {
  ipcMain.handle(IPC.APPLICATION_RENDERER_ERROR, (event, payload: unknown) => {
    const window = getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame?.url !== rendererUrl
    )
      return;

    const parsed =
      IpcRequestSchemas[IPC.APPLICATION_RENDERER_ERROR].safeParse(payload);
    if (!parsed.success) return;
    logger.error("renderer.unhandled_error", {
      errorName: parsed.data.errorName,
    });
  });
}
