import { describe, expect, it, vi } from "vitest";
import type { DrelwickApi } from "@drelwick/shared";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn(() => Promise.resolve());
const on = vi.fn();
const removeListener = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

describe("preload API", () => {
  it("exposes only the typed Drelwick API", async () => {
    await import("../src/preload/preload.js");

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld).toHaveBeenCalledWith(
      "drelwick",
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

    const [, api] = exposeInMainWorld.mock.calls[0] as [string, DrelwickApi];
    await api.references.execute({
      operation: "list",
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(invoke).toHaveBeenLastCalledWith("reference:execute", {
      operation: "list",
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    await api.project.exportDocx({
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(invoke).toHaveBeenLastCalledWith("docx:export", {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    await api.spelling.get();
    expect(invoke).toHaveBeenLastCalledWith("spelling:get");
    await api.spelling.update({ operation: "add", word: "Drelwick" });
    expect(invoke).toHaveBeenLastCalledWith("spelling:update", {
      operation: "add",
      word: "Drelwick",
    });
    await api.spelling.check({ language: "en-US", words: ["helo"] });
    expect(invoke).toHaveBeenLastCalledWith("spelling:check", {
      language: "en-US",
      words: ["helo"],
    });
    await api.spelling.suggest({ language: "en-US", word: "helo" });
    expect(invoke).toHaveBeenLastCalledWith("spelling:suggest", {
      language: "en-US",
      word: "helo",
    });
    await api.project.getPublication({
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(invoke).toHaveBeenLastCalledWith("publication:get", {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    await api.project.getPrintConfiguration({
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(invoke).toHaveBeenLastCalledWith("book:print-get", {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    await api.project.getBookTheme({
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(invoke).toHaveBeenLastCalledWith("book:theme-get", {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    await api.project.setBookTheme({
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      themeId: "modern",
    });
    expect(invoke).toHaveBeenLastCalledWith("book:theme-set", {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      themeId: "modern",
    });
    await api.project.previewBook({
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(invoke).toHaveBeenLastCalledWith("book:preview", {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
    });
    const captured = {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      revision: "a".repeat(64),
    };
    await api.project.bookPreviewStatus(captured);
    expect(invoke).toHaveBeenLastCalledWith("book:preview-status", captured);
    const simulation = {
      ...captured,
      simulation: { fontSize: 20, appearance: "dark" as const },
    };
    await api.project.simulateBookPreview(simulation);
    expect(invoke).toHaveBeenLastCalledWith(
      "book:preview-simulate",
      simulation,
    );
    const historyRequest = {
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      chapterId: "123e4567-e89b-42d3-a456-426614174001",
    };
    const selection = {
      ...historyRequest,
      snapshotId: "123e4567-e89b-42d3-a456-426614174099",
    };
    await api.project.listHistory(historyRequest);
    expect(invoke).toHaveBeenLastCalledWith("history:list", historyRequest);
    await api.project.previewHistory(selection);
    expect(invoke).toHaveBeenLastCalledWith("history:preview", selection);
    const restore = {
      ...selection,
      fingerprint: "a".repeat(64),
      document: {},
      confirmed: true as const,
    };
    await api.project.restoreHistory(restore);
    expect(invoke).toHaveBeenLastCalledWith("history:restore", restore);
    invoke.mockClear();
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
    const organisation = {
      operation: "status" as const,
      projectId: input.locationToken,
      expectedOrder: [input.locationToken],
      chapterId: input.locationToken,
      status: "review" as const,
    };
    await api.project.organiseChapter(organisation);
    expect(invoke).toHaveBeenLastCalledWith("chapter:organise", organisation);
  });
});
