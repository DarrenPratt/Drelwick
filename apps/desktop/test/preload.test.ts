import { describe, expect, it, vi } from "vitest";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn(() => Promise.resolve());

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke },
}));

describe("preload API", () => {
  it("exposes only the typed BookEditor API", async () => {
    await import("../src/preload/preload.js");

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld).toHaveBeenCalledWith(
      "bookEditor",
      expect.objectContaining({
        project: expect.objectContaining({
          create: expect.any(Function),
          open: expect.any(Function),
        }),
        dialog: expect.objectContaining({
          selectImage: expect.any(Function),
          selectExportLocation: expect.any(Function),
        }),
      }),
    );

    const [, api] = exposeInMainWorld.mock.calls[0] as [
      string,
      {
        project: { create: () => Promise<void> };
        dialog: { selectImage: () => Promise<void> };
      },
    ];
    await api.project.create();
    await api.dialog.selectImage();

    expect(invoke).toHaveBeenNthCalledWith(1, "project:create");
    expect(invoke).toHaveBeenNthCalledWith(2, "dialog:select-image");
  });
});
