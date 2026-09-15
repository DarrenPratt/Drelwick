import { describe, expect, it, vi } from "vitest";
import type { BookEditorApi } from "@bookeditor/shared";

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

    const [, api] = exposeInMainWorld.mock.calls[0] as [string, BookEditorApi];
    const input = {
      title: "Book",
      author: "Author",
      language: "en-GB",
      locationToken: "123e4567-e89b-42d3-a456-426614174000",
    };
    await api.project.create(input);
    await api.dialog.selectImage();

    expect(invoke).toHaveBeenNthCalledWith(1, "project:create", input);
    expect(invoke).toHaveBeenNthCalledWith(2, "dialog:select-image");
    await api.project.selectLocation();
    expect(invoke).toHaveBeenNthCalledWith(3, "project:select-location");
  });
});
