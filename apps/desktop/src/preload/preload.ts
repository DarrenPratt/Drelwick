import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  APPLICATION_MENU_COMMAND_CHANNEL,
  ApplicationMenuCommandSchema,
  SAVE_COMMAND_CHANNEL,
  SHUTDOWN_REQUEST_CHANNEL,
} from "@drelwick/shared";
import type { DrelwickApi } from "@drelwick/shared";

const api: DrelwickApi = {
  references: {
    execute: (input) => ipcRenderer.invoke(IPC.REFERENCE_EXECUTE, input),
  },
  spelling: {
    get: () => ipcRenderer.invoke(IPC.SPELLING_GET),
    update: (input) => ipcRenderer.invoke(IPC.SPELLING_UPDATE, input),
    check: (input) => ipcRenderer.invoke(IPC.SPELLING_CHECK, input),
    suggest: (input) => ipcRenderer.invoke(IPC.SPELLING_SUGGEST, input),
  },
  imports: {
    inspect: (input) => ipcRenderer.invoke(IPC.IMPORT_INSPECT, input),
    open: (operationId) => ipcRenderer.invoke(IPC.IMPORT_OPEN, { operationId }),
    commit: (operationId, review) =>
      ipcRenderer.invoke(IPC.IMPORT_COMMIT, { operationId, review }),
    cancel: (operationId) =>
      ipcRenderer.invoke(IPC.IMPORT_CANCEL, { operationId }),
  },
  reportRendererError: (input) =>
    ipcRenderer.invoke(IPC.APPLICATION_RENDERER_ERROR, input),
  onSaveRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(SAVE_COMMAND_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SAVE_COMMAND_CHANNEL, listener);
  },
  onApplicationMenuCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = ApplicationMenuCommandSchema.safeParse(payload);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on(APPLICATION_MENU_COMMAND_CHANNEL, listener);
    return () =>
      ipcRenderer.removeListener(APPLICATION_MENU_COMMAND_CHANNEL, listener);
  },
  onShutdownRequested: (callback) => {
    const listener = () => {
      void callback().then((saved) =>
        ipcRenderer.invoke(IPC.APPLICATION_SHUTDOWN_READY, { saved }),
      );
    };
    ipcRenderer.on(SHUTDOWN_REQUEST_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SHUTDOWN_REQUEST_CHANNEL, listener);
  },
  recovery: {
    list: () => ipcRenderer.invoke(IPC.RECOVERY_LIST),
    recover: (id) => ipcRenderer.invoke(IPC.RECOVERY_RECOVER, { id }),
    discard: (id) => ipcRenderer.invoke(IPC.RECOVERY_DISCARD, { id }),
    cancel: () => ipcRenderer.invoke(IPC.RECOVERY_CANCEL),
  },
  project: {
    getPublication: (input) => ipcRenderer.invoke(IPC.PUBLICATION_GET, input),
    savePublication: (input) => ipcRenderer.invoke(IPC.PUBLICATION_SAVE, input),
    selectPublicationCover: (input) =>
      ipcRenderer.invoke(IPC.PUBLICATION_COVER, input),
    getPrintConfiguration: (input) => ipcRenderer.invoke(IPC.PRINT_GET, input),
    savePrintConfiguration: (input) =>
      ipcRenderer.invoke(IPC.PRINT_SAVE, input),
    getBookTheme: (input) => ipcRenderer.invoke(IPC.BOOK_THEME_GET, input),
    setBookTheme: (input) => ipcRenderer.invoke(IPC.BOOK_THEME_SET, input),
    previewBook: (input) => ipcRenderer.invoke(IPC.BOOK_PREVIEW, input),
    exportPrint: (input) => ipcRenderer.invoke(IPC.PRINT_EXPORT, input),
    cancelPrintExport: (input) =>
      ipcRenderer.invoke(IPC.PRINT_EXPORT_CANCEL, input),
    printExportStatus: (input) =>
      ipcRenderer.invoke(IPC.PRINT_EXPORT_STATUS, input),
    previewPrint: (input) => ipcRenderer.invoke(IPC.PRINT_PREVIEW, input),
    exportDocx: (input) => ipcRenderer.invoke(IPC.DOCX_EXPORT, input),
    exportEpub: (input) => ipcRenderer.invoke(IPC.EPUB_EXPORT, input),
    simulateBookPreview: (input) =>
      ipcRenderer.invoke(IPC.BOOK_PREVIEW_SIMULATE, input),
    bookPreviewStatus: (input) =>
      ipcRenderer.invoke(IPC.BOOK_PREVIEW_STATUS, input),
    listHistory: (input) => ipcRenderer.invoke(IPC.HISTORY_LIST, input),
    previewHistory: (input) => ipcRenderer.invoke(IPC.HISTORY_PREVIEW, input),
    restoreHistory: (input) => ipcRenderer.invoke(IPC.HISTORY_RESTORE, input),
    organiseChapter: (input) => ipcRenderer.invoke(IPC.CHAPTER_ORGANISE, input),
    create: (input) => ipcRenderer.invoke(IPC.PROJECT_CREATE, input),
    selectLocation: () => ipcRenderer.invoke(IPC.PROJECT_SELECT_LOCATION),
    open: () => ipcRenderer.invoke(IPC.PROJECT_OPEN),
    close: () => ipcRenderer.invoke(IPC.PROJECT_CLOSE),
    backup: (input) => ipcRenderer.invoke(IPC.PROJECT_BACKUP, input),
    restore: () => ipcRenderer.invoke(IPC.PROJECT_RESTORE),
    listRecent: () => ipcRenderer.invoke(IPC.RECENT_LIST),
    openRecent: (id) => ipcRenderer.invoke(IPC.RECENT_OPEN, { id }),
    removeRecent: (id) => ipcRenderer.invoke(IPC.RECENT_REMOVE, { id }),
    renameChapter: (input) => ipcRenderer.invoke(IPC.CHAPTER_RENAME, input),
    deleteChapter: (input) => ipcRenderer.invoke(IPC.CHAPTER_DELETE, input),
    reorderChapters: (input) => ipcRenderer.invoke(IPC.CHAPTER_REORDER, input),
    createChapter: (input) => ipcRenderer.invoke(IPC.CHAPTER_CREATE, input),
    replaceManuscript: (input) =>
      ipcRenderer.invoke(IPC.MANUSCRIPT_REPLACE, input),
    cancelReplacement: () => ipcRenderer.invoke(IPC.MANUSCRIPT_CANCEL_REPLACE),
    saveChapter: (input) => ipcRenderer.invoke(IPC.PROJECT_SAVE_CHAPTER, input),
    loadChapter: (input) => ipcRenderer.invoke(IPC.PROJECT_LOAD_CHAPTER, input),
  },
  dialog: {
    selectImage: (input) => ipcRenderer.invoke(IPC.IMAGE_IMPORT, input),
    selectExportLocation: () =>
      ipcRenderer.invoke("dialog:select-export-location"),
  },
  images: {
    read: (input) => ipcRenderer.invoke(IPC.IMAGE_READ, input),
  },
};

contextBridge.exposeInMainWorld("drelwick", api);
