import { ipcMain } from "electron";
import { IPC, validateIpcPayload, type IpcChannel } from "@drelwick/shared";

export type IpcHandlers = Partial<
  Record<IpcChannel, (payload: unknown) => unknown | Promise<unknown>>
>;

export function registerIpcHandlers(handlers: IpcHandlers): void {
  (Object.values(IPC) as IpcChannel[]).forEach((channel) => {
    const handler = handlers[channel];
    if (!handler) {
      return;
    }

    ipcMain.handle(channel, (_event, payload: unknown) => {
      const validatedPayload = validateIpcPayload(channel, payload);
      return handler(validatedPayload);
    });
  });
}
