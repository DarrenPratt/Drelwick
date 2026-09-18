import { contextBridge, ipcRenderer } from "electron";
import { IPC, SAVE_COMMAND_CHANNEL } from "@bookeditor/shared";
import type { BookEditorApi } from "@bookeditor/shared";

const api: BookEditorApi = {
  onSaveRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(SAVE_COMMAND_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SAVE_COMMAND_CHANNEL, listener);
  },
  project: {
    create: (input) => ipcRenderer.invoke(IPC.PROJECT_CREATE, input),
    selectLocation: () => ipcRenderer.invoke(IPC.PROJECT_SELECT_LOCATION),
    open: () => ipcRenderer.invoke(IPC.PROJECT_OPEN),
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
    selectImage: () => ipcRenderer.invoke("dialog:select-image"),
    selectExportLocation: () =>
      ipcRenderer.invoke("dialog:select-export-location"),
  },
};

contextBridge.exposeInMainWorld("bookEditor", api);
