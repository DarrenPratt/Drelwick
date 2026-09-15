import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@bookeditor/shared";
import type { BookEditorApi } from "@bookeditor/shared";

const api: BookEditorApi = {
  project: {
    create: (input) => ipcRenderer.invoke(IPC.PROJECT_CREATE, input),
    selectLocation: () => ipcRenderer.invoke(IPC.PROJECT_SELECT_LOCATION),
    open: () => ipcRenderer.invoke(IPC.PROJECT_OPEN),
  },
  dialog: {
    selectImage: () => ipcRenderer.invoke("dialog:select-image"),
    selectExportLocation: () =>
      ipcRenderer.invoke("dialog:select-export-location"),
  },
};

contextBridge.exposeInMainWorld("bookEditor", api);
