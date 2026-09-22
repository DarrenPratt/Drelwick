import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import {
  StagedManuscriptImport,
  importError,
  type IsolatedManuscriptImporter,
} from "@sarel/core";
import {
  ImportInspectionSchema,
  validateImportedManuscript,
} from "@sarel/project-model";
import { IPC, IpcRequestSchemas, type ImportInspection } from "@sarel/shared";

interface Dependencies {
  /** Fixed first-party registry; never populated from renderer/source data. */
  importers: ReadonlyMap<string, IsolatedManuscriptImporter>;
  selectSource(window: BrowserWindow): Promise<string | null>;
  selectDestination(window: BrowserWindow): Promise<string | null>;
  blocked(): boolean;
}
const defaults: Dependencies = {
  // DOCX and text adapters are #115/#117, not implicit parsers in this boundary.
  importers: new Map(),
  blocked: () => false,
  selectSource: async (window) => {
    const selection = await dialog.showOpenDialog(window, {
      title: "Inspect manuscript import",
      properties: ["openFile"],
    });
    return selection.canceled ? null : (selection.filePaths[0] ?? null);
  },
  selectDestination: async (window) => {
    const selection = await dialog.showOpenDialog(window, {
      title: "Choose a new empty import folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return selection.canceled ? null : (selection.filePaths[0] ?? null);
  },
};
const failure = (code: string) => ({
  ok: false as const,
  error: { code, message: importError(code).message },
});

export function registerImportHandlers(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl: string,
  overrides: Partial<Dependencies> = {},
) {
  const services = { ...defaults, ...overrides };
  let detach = () => {};
  let operation:
    | {
        id: string;
        owner: IpcMainInvokeEvent["senderFrame"];
        abort: AbortController;
        stage: StagedManuscriptImport | undefined;
        busy: boolean;
      }
    | undefined;
  const trusted = (event: IpcMainInvokeEvent) => {
    const window = getWindow();
    return (
      window &&
      !window.isDestroyed() &&
      !services.blocked() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame?.url === rendererUrl
    );
  };
  for (const channel of [
    IPC.IMPORT_INSPECT,
    IPC.IMPORT_COMMIT,
    IPC.IMPORT_CANCEL,
  ] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!trusted(event)) return failure("IMPORT_ACCESS_DENIED");
      const request = IpcRequestSchemas[channel].safeParse(payload);
      if (!request.success) return failure("IMPORT_INPUT_INVALID");
      if (channel === IPC.IMPORT_CANCEL) {
        if (
          !operation ||
          operation.id !== request.data.operationId ||
          operation.owner !== event.senderFrame
        )
          return failure("IMPORT_EXPIRED");
        operation.abort.abort();
        if (!operation.busy) {
          const current = operation;
          operation = undefined;
          detach();
          try {
            await current.stage?.discard();
          } catch {
            return failure("IMPORT_CLEANUP_REQUIRED");
          }
        }
        return { ok: true, value: null };
      }
      if (channel === IPC.IMPORT_INSPECT) {
        if (operation) return failure("IMPORT_BUSY");
        if (
          !("importer" in request.data) ||
          typeof request.data.importer !== "string"
        )
          return failure("IMPORT_INPUT_INVALID");
        const importer = services.importers.get(request.data.importer);
        if (!importer) return failure("IMPORT_UNSUPPORTED");
        const current = {
          id: request.data.operationId,
          owner: event.senderFrame,
          abort: new AbortController(),
          busy: true,
          stage: undefined as StagedManuscriptImport | undefined,
        };
        operation = current;
        const abandon = () => {
          current.abort.abort();
          if (!current.busy) {
            operation = undefined;
            detach();
            void current.stage?.discard().catch(() => undefined);
          }
        };
        event.sender.once("destroyed", abandon);
        event.sender.once("render-process-gone", abandon);
        event.sender.once("did-start-navigation", abandon);
        detach = () => {
          event.sender.removeListener("destroyed", abandon);
          event.sender.removeListener("render-process-gone", abandon);
          event.sender.removeListener("did-start-navigation", abandon);
        };
        try {
          const source = await services.selectSource(getWindow()!);
          if (!trusted(event) || current.abort.signal.aborted)
            throw importError("IMPORT_CANCELLED");
          if (!source) {
            operation = undefined;
            detach();
            return { ok: true, value: null };
          }
          current.stage = await StagedManuscriptImport.inspect(
            source,
            importer,
            { signal: current.abort.signal },
          );
          if (!trusted(event) || current.abort.signal.aborted)
            throw importError("IMPORT_CANCELLED");
          // Revalidate outgoing manuscript independently; strip raw asset bytes.
          const preview = validateImportedManuscript(
            JSON.stringify(current.stage.preview),
          );
          const value: ImportInspection = ImportInspectionSchema.parse({
            ...preview,
            operationId: current.id,
            assets: preview.assets.map((asset) => ({
              id: asset.id,
              mediaType: asset.mediaType,
              byteSize: Buffer.from(asset.base64, "base64").length,
            })),
          });
          current.busy = false;
          return { ok: true, value };
        } catch {
          await current.stage?.discard().catch(() => undefined);
          operation = undefined;
          detach();
          return failure(
            current.abort.signal.aborted ? "IMPORT_CANCELLED" : "IMPORT_FAILED",
          );
        }
      }
      const current = operation;
      if (
        !current ||
        current.id !== request.data.operationId ||
        current.owner !== event.senderFrame ||
        !current.stage ||
        current.abort.signal.aborted
      )
        return failure("IMPORT_EXPIRED");
      if (current.busy) return failure("IMPORT_BUSY");
      current.busy = true;
      try {
        const destination = await services.selectDestination(getWindow()!);
        if (!trusted(event) || current.abort.signal.aborted)
          throw importError("IMPORT_CANCELLED");
        if (!destination) {
          current.busy = false;
          return { ok: true, value: null };
        }
        const value = await current.stage.commit(destination, {
          signal: current.abort.signal,
          checkpoint: async () => {
            if (!trusted(event)) current.abort.abort();
          },
        });
        operation = undefined;
        detach();
        // Never activate the project or replace the editor's dirty state.
        return { ok: true, value };
      } catch {
        await current.stage.discard().catch(() => undefined);
        operation = undefined;
        detach();
        return failure(
          current.abort.signal.aborted ? "IMPORT_CANCELLED" : "IMPORT_FAILED",
        );
      }
    });
  }
  return async () => {
    operation?.abort.abort();
    if (operation && !operation.busy) {
      await operation.stage?.discard().catch(() => undefined);
      operation = undefined;
      detach();
    }
  };
}
