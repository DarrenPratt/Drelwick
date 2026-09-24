import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import {
  StagedManuscriptImport,
  importError,
  reviewImportedManuscript,
  DocxManuscriptImporter,
  DocxImportError,
  TextManuscriptImporter,
  type IsolatedManuscriptImporter,
} from "@drelwick/core";
import {
  ImportInspectionSchema,
  validateImportedManuscript,
} from "@drelwick/project-model";
import {
  ApplicationError,
  IPC,
  IpcRequestSchemas,
  type ImportInspection,
} from "@drelwick/shared";
import { extname } from "node:path";

interface Dependencies {
  /** Fixed first-party registry; never populated from renderer/source data. */
  importers: ReadonlyMap<string, IsolatedManuscriptImporter>;
  selectSource(window: BrowserWindow): Promise<string | null>;
  selectDestination(window: BrowserWindow): Promise<string | null>;
  blocked(): boolean;
  authorizeOpen(
    event: IpcMainInvokeEvent,
    operationId: string,
    path: string,
    projectId: string,
  ): void;
}
const defaults: Dependencies = {
  importers: new Map([["docx", new DocxManuscriptImporter()]]),
  blocked: () => false,
  authorizeOpen: () => {},
  selectSource: async (window) => {
    const selection = await dialog.showOpenDialog(window, {
      title: "Inspect manuscript import",
      properties: ["openFile"],
      filters: [
        {
          name: "Manuscripts",
          extensions: ["docx", "txt", "md", "markdown", "html", "htm"],
        },
      ],
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
  // Each reference needs its own explicit native selection. No relative resolution.
  const selectImage = async (reference: string, signal: AbortSignal) => {
    if (signal.aborted) throw importError("IMPORT_CANCELLED");
    const window = getWindow();
    if (!window || window.isDestroyed()) throw importError("IMPORT_CANCELLED");
    const choice = await dialog.showMessageBox(window, {
      type: "question",
      title: "Manuscript image",
      message: "Select a local image to include in this import?",
      detail: `Referenced image: ${reference}\nOnly the file you explicitly select will be read. Skip retains an image placeholder for review.`,
      buttons: ["Select image", "Skip image", "Cancel import"],
      defaultId: 1,
      cancelId: 2,
    });
    if (signal.aborted || choice.response === 2)
      throw importError("IMPORT_CANCELLED");
    if (choice.response !== 0) return null;
    const selection = await dialog.showOpenDialog(window, {
      title: "Authorize this manuscript image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
    });
    return selection.canceled ? null : (selection.filePaths[0] ?? null);
  };
  const textImporters = new Map([
    ["txt", new TextManuscriptImporter("txt")],
    ["markdown", new TextManuscriptImporter("markdown", selectImage)],
    ["html", new TextManuscriptImporter("html", selectImage)],
  ]);
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
        let importer =
          services.importers.get(request.data.importer) ??
          textImporters.get(request.data.importer);
        if (!importer && request.data.importer !== "auto")
          return failure("IMPORT_UNSUPPORTED");
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
          if (request.data.importer === "auto") {
            const formats: Record<string, string> = {
              ".docx": "docx",
              ".txt": "txt",
              ".md": "markdown",
              ".markdown": "markdown",
              ".html": "html",
              ".htm": "html",
            };
            const format = formats[extname(source).toLowerCase()];
            importer = format
              ? (services.importers.get(format) ?? textImporters.get(format))
              : undefined;
          }
          if (!importer) throw importError("IMPORT_UNSUPPORTED");
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
        } catch (error) {
          let cleanupFailed =
            error instanceof ApplicationError &&
            error.code === "IMPORT_CLEANUP_REQUIRED";
          await current.stage?.discard().catch(() => {
            cleanupFailed = true;
          });
          operation = undefined;
          detach();
          if (
            !cleanupFailed &&
            !current.abort.signal.aborted &&
            error instanceof DocxImportError
          )
            return {
              ok: false,
              error: { code: error.code, message: error.message },
            };
          return failure(
            cleanupFailed
              ? "IMPORT_CLEANUP_REQUIRED"
              : current.abort.signal.aborted
                ? "IMPORT_CANCELLED"
                : error instanceof ApplicationError &&
                    [
                      "IMPORT_INVALID",
                      "IMPORT_DESTINATION_INVALID",
                      "IMPORT_UNSUPPORTED",
                      "IMPORT_CANCELLED",
                    ].includes(error.code)
                  ? error.code
                  : "IMPORT_FAILED",
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
      const commitRequest =
        IpcRequestSchemas[IPC.IMPORT_COMMIT].safeParse(payload);
      if (!commitRequest.success) return failure("IMPORT_INPUT_INVALID");
      const review = commitRequest.data.review;
      try {
        reviewImportedManuscript(current.stage.preview, review);
      } catch {
        return {
          ok: false,
          error: {
            code: "IMPORT_REVIEW_REQUIRED",
            message:
              "Review every conversion warning and choose valid chapter boundaries before importing.",
          },
        };
      }
      current.busy = true;
      try {
        const destination = await services.selectDestination(getWindow()!);
        if (!trusted(event) || current.abort.signal.aborted)
          throw importError("IMPORT_CANCELLED");
        if (!destination) {
          current.busy = false;
          return { ok: true, value: null };
        }
        const { projectId, warning } = await current.stage.commit(destination, {
          review,
          signal: current.abort.signal,
          checkpoint: async () => {
            if (!trusted(event)) current.abort.abort();
          },
        });
        operation = undefined;
        detach();
        // Authorize only the normal validation/open path, without activating it.
        if (trusted(event) && !current.abort.signal.aborted)
          services.authorizeOpen(event, current.id, destination, projectId);
        return {
          ok: true,
          value: { projectId },
          ...(warning ? { warning } : {}),
        };
      } catch (error) {
        let cleanupFailed =
          error instanceof ApplicationError &&
          error.code === "IMPORT_CLEANUP_REQUIRED";
        await current.stage.discard().catch(() => {
          cleanupFailed = true;
        });
        operation = undefined;
        detach();
        return failure(
          cleanupFailed
            ? "IMPORT_CLEANUP_REQUIRED"
            : current.abort.signal.aborted
              ? "IMPORT_CANCELLED"
              : error instanceof ApplicationError &&
                  ["IMPORT_INVALID", "IMPORT_DESTINATION_INVALID"].includes(
                    error.code,
                  )
                ? error.code
                : "IMPORT_FAILED",
        );
      }
    });
  }
  return async () => {
    const current = operation;
    current?.abort.abort();
    if (current && !current.busy) {
      operation = undefined;
      detach();
      await current.stage?.discard().catch(() => undefined);
    }
  };
}
