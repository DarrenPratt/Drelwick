import { contextBridge, ipcRenderer } from "electron";
import type { BookEditorApi } from "@bookeditor/shared";

const api: BookEditorApi = {
  project: {
    create: () => ipcRenderer.invoke("project:create"),
    open: () => ipcRenderer.invoke("project:open"),
  },
  dialog: {
    selectImage: () => ipcRenderer.invoke("dialog:select-image"),
    selectExportLocation: () =>
      ipcRenderer.invoke("dialog:select-export-location"),
  },
};

contextBridge.exposeInMainWorld("bookEditor", api);
