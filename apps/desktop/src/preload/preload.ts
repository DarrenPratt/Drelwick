import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("bookEditor", Object.freeze({}));
