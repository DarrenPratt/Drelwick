import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  APPLICATION_MENU_COMMAND_CHANNEL,
  ApplicationMenuCommandSchema,
  SAVE_COMMAND_CHANNEL,
  SHUTDOWN_REQUEST_CHANNEL,
} from "@bookeditor/shared";
import type { BookEditorApi } from "@bookeditor/shared";

const api: BookEditorApi = {
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

contextBridge.exposeInMainWorld("bookEditor", api);
