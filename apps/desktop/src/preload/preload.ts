import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@bookeditor/shared";
import type { BookEditorApi } from "@bookeditor/shared";

const api: BookEditorApi = {
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
    loadChapter: (input) => ipcRenderer.invoke(IPC.PROJECT_LOAD_CHAPTER, input),
  },
  dialog: {
    selectImage: () => ipcRenderer.invoke("dialog:select-image"),
    selectExportLocation: () =>
      ipcRenderer.invoke("dialog:select-export-location"),
  },
};

contextBridge.exposeInMainWorld("bookEditor", api);
