import { describe, expect, it, vi } from "vitest";
import type { SarelApi } from "@sarel/shared";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn(() => Promise.resolve());
const on = vi.fn();
const removeListener = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

describe("preload API", () => {
  it("exposes only the typed SAREL API", async () => {
    await import("../src/preload/preload.js");

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld).toHaveBeenCalledWith(
      "sarel",
      expect.objectContaining({
        project: expect.objectContaining({
          create: expect.any(Function),
          open: expect.any(Function),
          backup: expect.any(Function),
          restore: expect.any(Function),
        }),
        onShutdownRequested: expect.any(Function),
        dialog: expect.objectContaining({
          selectImage: expect.any(Function),
          selectExportLocation: expect.any(Function),
        }),
      }),
    );

    const [, api] = exposeInMainWorld.mock.calls[0] as [string, SarelApi];
    const callback = vi.fn();
    const unsubscribe = api.onSaveRequested(callback);
    expect(on).toHaveBeenCalledWith("command:save", expect.any(Function));
    const listener = on.mock.calls[0]?.[1] as (...args: unknown[]) => void;
    listener({ sender: "privileged event" }, "unexpected payload");
    expect(callback).toHaveBeenCalledExactlyOnceWith();
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith("command:save", listener);
    const menuCommand = vi.fn();
    const removeMenuCommand = api.onApplicationMenuCommand(menuCommand);
    expect(on).toHaveBeenCalledWith(
      "command:application-menu",
      expect.any(Function),
    );
    const menuListener = on.mock.calls[1]?.[1] as (...args: unknown[]) => void;
    menuListener({}, "open-project");
    menuListener({}, { unexpected: true });
    expect(menuCommand).toHaveBeenCalledExactlyOnceWith("open-project");
    removeMenuCommand();
    expect(removeListener).toHaveBeenCalledWith(
      "command:application-menu",
      menuListener,
    );
    const input = {
      title: "Book",
      author: "Author",
      language: "en-GB",
      locationToken: "123e4567-e89b-42d3-a456-426614174000",
    };
    await api.project.create(input);
    await api.dialog.selectImage({
      projectId: input.locationToken,
      chapterId: input.locationToken,
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "project:create", input);
    expect(invoke).toHaveBeenNthCalledWith(2, "image:import", {
      projectId: input.locationToken,
      chapterId: input.locationToken,
    });
    await api.project.selectLocation();
    expect(invoke).toHaveBeenNthCalledWith(3, "project:select-location");
    await api.project.open();
    expect(invoke).toHaveBeenNthCalledWith(4, "project:open");
    await api.project.listRecent();
    expect(invoke).toHaveBeenNthCalledWith(5, "project:recent-list");
    await api.project.openRecent(input.locationToken);
    expect(invoke).toHaveBeenNthCalledWith(6, "project:recent-open", {
      id: input.locationToken,
    });
    await api.project.removeRecent(input.locationToken);
    expect(invoke).toHaveBeenNthCalledWith(7, "project:recent-remove", {
      id: input.locationToken,
    });
    const chapter = {
      chapterId: input.locationToken,
      document: { type: "doc", content: [{ type: "paragraph" }] },
    };
    await api.project.saveChapter(chapter);
    expect(invoke).toHaveBeenLastCalledWith("project:save-chapter", chapter);
    const shutdownCallback = vi.fn(async () => true);
    const removeShutdown = api.onShutdownRequested(shutdownCallback);
    expect(on).toHaveBeenCalledWith(
      "application:shutdown-request",
      expect.any(Function),
    );
    const shutdownListener = on.mock.calls[2]?.[1] as () => void;
    shutdownListener();
    await Promise.resolve();
    expect(shutdownCallback).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenLastCalledWith("application:shutdown-ready", {
      saved: true,
    });
    await api.recovery.list();
    expect(invoke).toHaveBeenLastCalledWith("recovery:list");
    await api.recovery.recover(input.locationToken);
    expect(invoke).toHaveBeenLastCalledWith("recovery:recover", {
      id: input.locationToken,
    });
    await api.recovery.discard(input.locationToken);
    expect(invoke).toHaveBeenLastCalledWith("recovery:discard", {
      id: input.locationToken,
    });
    await api.recovery.cancel();
    expect(invoke).toHaveBeenLastCalledWith("recovery:cancel");
    await api.reportRendererError({ errorName: "TypeError" });
    expect(invoke).toHaveBeenLastCalledWith("application:renderer-error", {
      errorName: "TypeError",
    });
    removeShutdown();
    expect(removeListener).toHaveBeenCalledWith(
      "application:shutdown-request",
      shutdownListener,
    );
    await api.project.close();
    expect(invoke).toHaveBeenLastCalledWith("project:close");
    await api.project.backup({ includeHistory: false });
    expect(invoke).toHaveBeenLastCalledWith("project:backup", {
      includeHistory: false,
    });
    const review = {
      boundaries: [{ block: 0, title: "Opening" }],
      acceptedWarnings: [0],
    };
    await api.imports.inspect({
      operationId: input.locationToken,
      importer: "docx",
    });
    expect(invoke).toHaveBeenLastCalledWith("import:inspect", {
      operationId: input.locationToken,
      importer: "docx",
    });
    await api.imports.commit(input.locationToken, review);
    expect(invoke).toHaveBeenLastCalledWith("import:commit", {
      operationId: input.locationToken,
      review,
    });
    await api.imports.open(input.locationToken);
    expect(invoke).toHaveBeenLastCalledWith("import:open", {
      operationId: input.locationToken,
    });
    await api.imports.cancel(input.locationToken);
    expect(invoke).toHaveBeenLastCalledWith("import:cancel", {
      operationId: input.locationToken,
    });
    await api.project.restore();
    expect(invoke).toHaveBeenLastCalledWith("project:restore");
  });
});
