import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@bookeditor/shared";
import type { BookEditorApi } from "@bookeditor/shared";

const api: BookEditorApi = {
  project: {
    create: () => ipcRenderer.invoke(IPC.PROJECT_CREATE),
    open: () => ipcRenderer.invoke(IPC.PROJECT_OPEN),
  },
  dialog: {
    selectImage: () => ipcRenderer.invoke("dialog:select-image"),
    selectExportLocation: () =>
      ipcRenderer.invoke("dialog:select-export-location"),
  },
};

contextBridge.exposeInMainWorld("bookEditor", api);
