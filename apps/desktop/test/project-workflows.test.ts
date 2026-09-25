// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DrelwickApi,
  ProjectOperationResult,
  ProjectWorkspace,
} from "@drelwick/shared";
import { App } from "../src/renderer/App.js";

const selected = {
  token: "123e4567-e89b-42d3-a456-426614174000",
  path: "C:/Books/Example",
};
const workspace = {
  projectId: selected.token,
  projectPath: selected.path,
  title: "Example",
  author: "Author",
  language: "en-GB",
  chapters: [],
};
const create = vi.fn<DrelwickApi["project"]["create"]>();
const closeProject = vi.fn<DrelwickApi["project"]["close"]>();
const backupProject = vi.fn<DrelwickApi["project"]["backup"]>();
const previewBook = vi.fn<DrelwickApi["project"]["previewBook"]>();
const restoreProject = vi.fn<DrelwickApi["project"]["restore"]>();
const selectLocation = vi.fn<DrelwickApi["project"]["selectLocation"]>();
const open = vi.fn<DrelwickApi["project"]["open"]>();
const listRecent = vi.fn<DrelwickApi["project"]["listRecent"]>();
const openRecent = vi.fn<DrelwickApi["project"]["openRecent"]>();
const removeRecent = vi.fn<DrelwickApi["project"]["removeRecent"]>();
const renameChapter = vi.fn<DrelwickApi["project"]["renameChapter"]>();
const deleteChapter = vi.fn<DrelwickApi["project"]["deleteChapter"]>();
const reorderChapters = vi.fn<DrelwickApi["project"]["reorderChapters"]>();
const createChapter = vi.fn<DrelwickApi["project"]["createChapter"]>();
const saveChapter = vi.fn<DrelwickApi["project"]["saveChapter"]>();
const loadChapter = vi.fn<DrelwickApi["project"]["loadChapter"]>();
let root: Root;
let container: HTMLDivElement;
const saveListeners = new Set<() => void>();
const shutdownListeners = new Set<() => Promise<boolean>>();
const menuListeners = new Set<
  (
    command:
      | "new-project"
      | "open-project"
      | "close-project"
      | "backup-project"
      | "restore-project"
      | "import-manuscript",
  ) => void
>();

beforeEach(async () => {
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect());
  saveListeners.clear();
  shutdownListeners.clear();
  menuListeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no native modal implementation; Electron smoke testing covers it.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  create.mockReset().mockResolvedValue({ ok: true, value: workspace });
  selectLocation.mockReset().mockResolvedValue({ ok: true, value: selected });
  open.mockReset().mockResolvedValue({ ok: true, value: workspace });
  closeProject.mockReset().mockResolvedValue({ ok: true, value: null });
  previewBook.mockReset().mockResolvedValue({
    ok: true,
    value: {
      revision: "saved",
      document: "<p>Saved preview</p>",
      complete: true,
      diagnostics: [],
    },
  });
  backupProject.mockReset().mockResolvedValue({
    ok: true,
    value: { created: true },
  });
  restoreProject.mockReset().mockResolvedValue({ ok: true, value: null });
  listRecent.mockReset().mockResolvedValue({ ok: true, value: [] });
  openRecent.mockReset().mockResolvedValue({ ok: true, value: workspace });
  removeRecent.mockReset().mockResolvedValue({ ok: true, value: [] });
  renameChapter.mockReset().mockResolvedValue({ ok: true, value: workspace });
  deleteChapter.mockReset().mockResolvedValue({ ok: true, value: workspace });
  reorderChapters.mockReset().mockResolvedValue({ ok: true, value: workspace });
  createChapter.mockReset().mockResolvedValue({ ok: true, value: workspace });
  saveChapter.mockReset().mockResolvedValue({
    ok: true,
    value: {
      id: "123e4567-e89b-42d3-a456-426614174001",
      modified: "2026-09-16T12:00:00Z",
    },
  });
  loadChapter.mockReset().mockResolvedValue({
    ok: true,
    value: {
      id: "123e4567-e89b-42d3-a456-426614174001",
      content: { type: "doc", content: [{ type: "paragraph" }] },
    },
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  window.drelwick = {
    reportRendererError: vi.fn(),
    imports: {
      inspect: vi.fn(),
      commit: vi.fn(),
      cancel: vi.fn(),
      open: vi.fn(),
    },
    recovery: {
      list: vi.fn(),
      recover: vi.fn(),
      discard: vi.fn(),
      cancel: vi.fn(),
    },
    onSaveRequested: vi.fn((callback) => {
      saveListeners.add(callback);
      return () => {
        saveListeners.delete(callback);
      };
    }),
    onShutdownRequested: vi.fn((callback) => {
      shutdownListeners.add(callback);
      return () => {
        shutdownListeners.delete(callback);
      };
    }),
    onApplicationMenuCommand: vi.fn((callback) => {
      menuListeners.add(callback);
      return () => menuListeners.delete(callback);
    }),
    project: {
      previewBook,
      listHistory: vi.fn(),
      previewHistory: vi.fn(),
      restoreHistory: vi.fn(),
      organiseChapter: vi.fn(),
      replaceManuscript: vi.fn(),
      cancelReplacement: vi.fn(),
      create,
      close: closeProject,
      backup: backupProject,
      restore: restoreProject,
      selectLocation,
      open,
      listRecent,
      openRecent,
      removeRecent,
      renameChapter,
      deleteChapter,
      reorderChapters,
      createChapter,
      loadChapter,
      saveChapter,
    },
    dialog: { selectImage: vi.fn(), selectExportLocation: vi.fn() },
    images: { read: vi.fn() },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(App)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function button(text: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function clickLabel(label: string) {
  await act(async () => {
    const element = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!element) throw new Error(`Missing button: ${label}`);
    element.click();
  });
}
async function input(id: string, value: string) {
  await act(async () => {
    const element = container.querySelector<HTMLInputElement>(`#${id}`);
    if (!element) throw new Error("Missing input");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function completeForm() {
  await click("New project");
  await input("book-title", "Example");
  await input("book-author", "Author");
  await click("Choose folder…");
}

describe("recent project workflow", () => {
  async function showRecent() {
    listRecent.mockResolvedValue({
      ok: true,
      value: [
        { id: selected.token, path: selected.path, title: "Recent book" },
      ],
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(App)));
  }

  it("loads saved entries at startup, reopens by ID and refreshes the list", async () => {
    await showRecent();
    expect(container.textContent).toContain(selected.path);
    await click("Recent book");
    expect(openRecent).toHaveBeenCalledWith(selected.token);
    expect(open).not.toHaveBeenCalled();
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    expect(listRecent).toHaveBeenCalledTimes(3);
  });

  it("keeps the workspace and missing entry after failure, then removes only the entry", async () => {
    await showRecent();
    await click("Open project");
    openRecent.mockResolvedValue({
      ok: false,
      error: {
        code: "PROJECT_PATH_ACCESS_FAILED",
        message:
          "This folder is unavailable. Use Open project to choose its new location.",
      },
    });
    await click("Recent book");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    expect(container.textContent).toContain("This folder is unavailable");
    expect(button("Recent book")).toBeDefined();
    await click("Remove");
    expect(removeRecent).toHaveBeenCalledWith(selected.token);
    expect(container.textContent).not.toContain("Recent book");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
  });

  it("preserves entries on removal failure and allows retry", async () => {
    await showRecent();
    removeRecent.mockRejectedValueOnce(new Error("private details"));
    await click("Remove");
    expect(container.textContent).toContain(
      "Unable to remove the recent entry",
    );
    expect(button("Recent book")).toBeDefined();
    await click("Remove");
    expect(container.textContent).toContain("No recent projects yet");
  });

  it("blocks recent actions while a form or recent open is pending", async () => {
    await showRecent();
    await click("New project");
    expect(button("Recent book").disabled).toBe(true);
    expect(button("Remove").disabled).toBe(true);
    await click("Cancel");
    let finish!: (
      value: ProjectOperationResult<ProjectWorkspace | null>,
    ) => void;
    openRecent.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await click("Recent book");
    expect(button("Recent book").disabled).toBe(true);
    expect(button("Remove").disabled).toBe(true);
    await act(async () => finish({ ok: true, value: workspace }));
  });

  it("shows tracking warnings while still opening the project", async () => {
    open.mockResolvedValueOnce({
      ok: true,
      value: workspace,
      warning: "Recent entry could not be saved.",
    });
    await click("Open project");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    expect(container.textContent).toContain("Recent entry could not be saved.");
  });

  it("shows safe startup errors without blocking ordinary project opening", async () => {
    listRecent.mockRejectedValue(new Error("private details"));
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(App)));
    expect(container.textContent).toContain("Unable to load recent projects");
    expect(container.textContent).not.toContain("private details");
    expect(button("Open project").disabled).toBe(false);
    await click("Open project");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
  });
});

describe("new project dialog", () => {
  it("validates all required fields and whitespace without making a creation request", async () => {
    await click("New project");
    await input("book-title", "  ");
    await input("book-language", "  ");
    await click("Create project");
    expect(container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(4);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter a book title",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("handles cancelled folder selection without errors or creation", async () => {
    selectLocation.mockResolvedValue({ ok: true, value: null });
    await click("New project");
    await click("Choose folder…");
    expect(
      container.querySelector<HTMLInputElement>("#project-location")?.value,
    ).toBe("");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    await click("Cancel");
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("keeps the selected location when a replacement selection is cancelled", async () => {
    await completeForm();
    selectLocation.mockResolvedValue({ ok: true, value: null });
    await click("Choose folder…");
    expect(
      container.querySelector<HTMLInputElement>("#project-location")?.value,
    ).toBe(selected.path);
  });

  it("displays creation failures, preserves inputs and supports retry", async () => {
    create.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "PROJECT_DESTINATION_NOT_EMPTY",
        message: "This folder is not empty.",
      },
    });
    await completeForm();
    await click("Create project");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This folder is not empty.",
    );
    expect(
      container.querySelector<HTMLInputElement>("#book-title")?.value,
    ).toBe("Example");
    await click("Create project");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("There are no chapters yet");
    expect(create).toHaveBeenLastCalledWith({
      title: "Example",
      author: "Author",
      language: "en-GB",
      locationToken: selected.token,
    });
  });

  it("displays native selection failures and safe transport errors", async () => {
    selectLocation.mockRejectedValueOnce(
      new Error("private transport details"),
    );
    await click("New project");
    await click("Choose folder…");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Unable to choose a folder. Please try again.",
    );
    await input("book-title", "Example");
    await input("book-author", "Author");
    await click("Choose folder…");
    create.mockRejectedValueOnce(new Error("private filesystem details"));
    await click("Create project");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Unable to create the project. Please try again.",
    );
  });

  it("blocks duplicate submission and cancellation while creation is pending", async () => {
    let finish!: (value: ProjectOperationResult<ProjectWorkspace>) => void;
    create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await completeForm();
    await click("Create project");
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      container
        .querySelector("dialog")
        ?.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(create).toHaveBeenCalledOnce();
    expect(container.querySelector("dialog")).not.toBeNull();
    await act(async () => finish({ ok: true, value: workspace }));
    expect(container.querySelector("h1")?.textContent).toBe("Example");
  });
});

describe("existing project workflow", () => {
  it("routes native menu commands through the guarded project workflows", async () => {
    const emit = async (
      command:
        | "new-project"
        | "open-project"
        | "close-project"
        | "backup-project"
        | "restore-project"
        | "import-manuscript",
    ) => {
      await act(async () => {
        for (const listener of menuListeners) listener(command);
      });
    };

    await emit("new-project");
    expect(container.querySelector("dialog h2")?.textContent).toBe(
      "New project",
    );
    await click("Cancel");

    await emit("open-project");
    expect(open).toHaveBeenCalledOnce();
    expect(container.querySelector("h1")?.textContent).toBe("Example");

    await emit("close-project");
    expect(closeProject).toHaveBeenCalledOnce();
    expect(container.querySelector("h1")?.textContent).toBe(
      "Your manuscript workspace",
    );

    await emit("open-project");
    await emit("backup-project");
    expect(backupProject).toHaveBeenCalledWith({ includeHistory: true });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Project backup created successfully.",
    );
    await emit("restore-project");
    expect(restoreProject).toHaveBeenCalledOnce();
  });

  it("opens from the welcome screen and replaces the workspace on the next successful open", async () => {
    await click("Open project");
    expect(open).toHaveBeenCalledWith();
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    open.mockResolvedValue({
      ok: true,
      value: {
        ...workspace,
        title: "Another book",
        author: "Another author",
        projectPath: "/another/book",
        chapters: [
          { id: "chapter", title: "Beginning", status: "draft", wordCount: 42 },
        ],
      },
    });
    await click("Open project");
    expect(container.querySelector("h1")?.textContent).toBe("Another book");
    expect(container.textContent).toContain("Another author");
    expect(container.textContent).toContain("1 chapter · 42 words");
    expect(container.textContent).toContain("/another/book");
    expect(container.textContent).not.toContain("There are no chapters yet");
  });

  it("keeps the welcome screen or current workspace when selection is cancelled", async () => {
    open.mockResolvedValueOnce({ ok: true, value: null });
    await click("Open project");
    expect(container.querySelector("h1")?.textContent).toBe(
      "Your manuscript workspace",
    );
    await click("Open project");
    open.mockResolvedValueOnce({ ok: true, value: null });
    await click("Open project");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows validation errors without discarding the current project and supports retry", async () => {
    await completeForm();
    await click("Create project");
    open.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "PROJECT_FILE_MISSING",
        message: "Missing project.json. Choose a project folder.",
      },
    });
    await click("Open project");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Missing project.json",
    );
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    await click("Open project");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows safe transport errors and preserves the screen", async () => {
    open.mockRejectedValueOnce(new Error("private content"));
    await click("Open project");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Unable to open the project. Please try again.",
    );
    expect(container.querySelector("h1")?.textContent).toBe(
      "Your manuscript workspace",
    );
  });

  it("retains the current workspace during opening and blocks repeated requests", async () => {
    await click("Open project");
    let finish!: (
      value: ProjectOperationResult<ProjectWorkspace | null>,
    ) => void;
    open.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await click("Open project");
    expect(container.querySelector("h1")?.textContent).toBe("Example");
    expect(button("Opening project…").disabled).toBe(true);
    await click("Opening project…");
    expect(open).toHaveBeenCalledTimes(2);
    await act(async () =>
      finish({ ok: true, value: { ...workspace, title: "Finished loading" } }),
    );
    expect(container.querySelector("h1")?.textContent).toBe("Finished loading");
  });

  it("does not allow opening to discard a new-project form", async () => {
    await click("New project");
    await input("book-title", "Unsubmitted draft");
    expect(button("Open project").disabled).toBe(true);
    await click("Open project");
    expect(open).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>("#book-title")?.value,
    ).toBe("Unsubmitted draft");
  });

  it("renames a chapter from the navigator and keeps the updated workspace", async () => {
    const chapterWorkspace: ProjectWorkspace = {
      ...workspace,
      chapters: [
        {
          id: "123e4567-e89b-42d3-a456-426614174001",
          title: "Original",
          status: "revising",
          wordCount: 12,
        },
      ],
    };
    open.mockResolvedValueOnce({ ok: true, value: chapterWorkspace });
    await click("Open project");
    expect(container.textContent).toContain("revising · 12 words");
    await click("Rename");
    await input(
      "chapter-title-123e4567-e89b-42d3-a456-426614174001",
      "Renamed",
    );
    renameChapter.mockResolvedValueOnce({
      ok: true,
      value: {
        ...chapterWorkspace,
        chapters: [
          {
            id: "123e4567-e89b-42d3-a456-426614174001",
            title: "Renamed",
            status: "revising",
            wordCount: 12,
          },
        ],
      },
    });
    await click("Save");
    expect(renameChapter).toHaveBeenCalledWith({
      chapterId: "123e4567-e89b-42d3-a456-426614174001",
      title: "Renamed",
    });
    expect(container.textContent).toContain("Renamed");
    expect(container.textContent).not.toContain("Original");
  });

  it("requires confirmation and updates the navigator after deletion", async () => {
    const chapterWorkspace: ProjectWorkspace = {
      ...workspace,
      chapters: [
        {
          id: "123e4567-e89b-42d3-a456-426614174001",
          title: "Original",
          status: "draft",
          wordCount: 12,
        },
      ],
    };
    open.mockResolvedValueOnce({ ok: true, value: chapterWorkspace });
    await click("Open project");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await click("Delete");
    expect(deleteChapter).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    deleteChapter.mockResolvedValueOnce({
      ok: true,
      value: { ...chapterWorkspace, chapters: [] },
    });
    await click("Delete");
    expect(deleteChapter).toHaveBeenCalledWith({
      chapterId: "123e4567-e89b-42d3-a456-426614174001",
    });
    expect(container.textContent).toContain("There are no chapters yet");
  });

  it("reorders chapters through the navigator and updates the active workspace", async () => {
    const chapterWorkspace: ProjectWorkspace = {
      ...workspace,
      chapters: [
        {
          id: "123e4567-e89b-42d3-a456-426614174001",
          title: "First",
          status: "draft",
          wordCount: 1,
        },
        {
          id: "123e4567-e89b-42d3-a456-426614174002",
          title: "Second",
          status: "review",
          wordCount: 2,
        },
      ],
    };
    open.mockResolvedValueOnce({ ok: true, value: chapterWorkspace });
    await click("Open project");
    reorderChapters.mockResolvedValueOnce({
      ok: true,
      value: {
        ...chapterWorkspace,
        chapters: [...chapterWorkspace.chapters].reverse(),
      },
    });
    await clickLabel("Move Second up");
    expect(reorderChapters).toHaveBeenCalledWith({
      chapterIds: [
        "123e4567-e89b-42d3-a456-426614174002",
        "123e4567-e89b-42d3-a456-426614174001",
      ],
    });
    expect(container.textContent?.indexOf("Second")).toBeLessThan(
      container.textContent?.indexOf("First") ?? 0,
    );
  });

  it("creates and selects a chapter from the navigator", async () => {
    const existingChapter: ProjectWorkspace["chapters"][number] = {
      id: "123e4567-e89b-42d3-a456-426614174001",
      title: "Existing",
      status: "draft",
      wordCount: 4,
    };
    const chapterWorkspace: ProjectWorkspace = {
      ...workspace,
      chapters: [existingChapter],
    };
    const createdChapter: ProjectWorkspace["chapters"][number] = {
      id: "123e4567-e89b-42d3-a456-426614174003",
      title: "New chapter",
      status: "draft",
      wordCount: 0,
    };
    open.mockResolvedValueOnce({ ok: true, value: chapterWorkspace });
    await click("Open project");
    createChapter.mockResolvedValueOnce({
      ok: true,
      value: {
        ...chapterWorkspace,
        chapters: [existingChapter, createdChapter],
      },
    });
    await input("new-chapter-title", "New chapter");
    await click("New chapter");
    expect(createChapter).toHaveBeenCalledWith({ title: "New chapter" });
    expect(
      container.querySelector('[aria-current="page"]')?.textContent,
    ).toContain("New chapter");
  });
});

describe("chapter editor persistence", () => {
  it("replaces loaded adjacent text nodes even when the editor coalesces them", async () => {
    loadChapter.mockResolvedValue({
      ok: true,
      value: {
        id: "123e4567-e89b-42d3-a456-426614174001",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "silver ", marks: [{ type: "bold" }] },
                { type: "text", text: "moon", marks: [{ type: "bold" }] },
              ],
            },
          ],
        },
      },
    });
    await openChapter();
    await click("Find and replace");
    await searchInput("Find text", "silver moon");
    await searchInput("Replacement text", "sun");
    await click("Next match");
    expect(saveStatus()).toBe("All changes saved");
    await click("Replace one");
    expect(editor().getText()).toBe("sun");
    expect(editor().getJSON().content?.[0]?.content?.[0]?.marks).toEqual([
      { type: "bold" },
    ]);
  });
  it("replaces across editor marks with first-character inheritance and independent undo", async () => {
    vi.useFakeTimers();
    await openChapter();
    const formatted = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The " },
            { type: "text", text: "quick", marks: [{ type: "bold" }] },
            { type: "text", text: " brown", marks: [{ type: "italic" }] },
            { type: "text", text: " tail", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    await act(async () => {
      editor().commands.setContent(formatted);
    });
    const before = editor().getJSON();
    await click("Find and replace");
    await searchInput("Find text", "quick brown");
    await searchInput("Replacement text", "swift");
    await click("Next match");
    await click("Replace one");
    expect(editor().getJSON().content?.[0]?.content).toEqual([
      { type: "text", text: "The " },
      { type: "text", text: "swift", marks: [{ type: "bold" }] },
      { type: "text", text: " tail", marks: [{ type: "italic" }] },
    ]);
    await act(async () => {
      editor().commands.undo();
    });
    expect(editor().getJSON()).toEqual(before);
  });
  it("cancels while flushing without replacing or discarding pre-existing edits", async () => {
    vi.useFakeTimers();
    await openChapter();
    await editText("silver new prose");
    await click("Find and replace");
    await searchInput("Find text", "silver");
    await click("Review replace all");
    let finish!: (
      value: Awaited<ReturnType<DrelwickApi["project"]["saveChapter"]>>,
    ) => void;
    saveChapter.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await click("Confirm replace all");
    expect(editor().isEditable).toBe(false);
    await click("Cancel replacement");
    await act(async () =>
      finish({
        ok: true,
        value: {
          id: "123e4567-e89b-42d3-a456-426614174001",
          modified: "2026-09-24T12:00:00Z",
        },
      }),
    );
    expect(window.drelwick.project.replaceManuscript).not.toHaveBeenCalled();
    expect(editor().getText()).toBe("silver new prose");
    expect(editor().isEditable).toBe(true);
    expect(saveStatus()).toBe("All changes saved");
  });
  it("keeps the current chapter when search navigation cannot flush edits", async () => {
    vi.useFakeTimers();
    await openTwoChapters();
    await editText("silver newer prose");
    loadChapter.mockImplementation(async ({ chapterId }) => ({
      ok: true,
      value: {
        id: chapterId,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "silver" }] },
          ],
        },
      },
    }));
    await click("Find and replace");
    await wholeManuscript();
    await searchInput("Find text", "silver");
    await click("Next match");
    saveChapter.mockResolvedValue({
      ok: false,
      error: { code: "CHAPTER_SAVE_FAILED", message: "Retry" },
    });
    await click("Next match");
    expect(editor().getText()).toBe("silver newer prose");
    expect(
      container.querySelector('[aria-current="page"]')?.textContent,
    ).toContain("First");
    expect(saveStatus()).toBe("Unsaved changes");
  });
  async function showHistory() {
    const chapterId = "123e4567-e89b-42d3-a456-426614174001";
    const snapshotId = "123e4567-e89b-42d3-a456-426614174099";
    vi.mocked(window.drelwick.project.listHistory).mockResolvedValue({
      ok: true,
      value: {
        chapterId,
        title: "First",
        entries: [
          { id: snapshotId, chapterId, created: "2026-09-01T12:00:00.000Z" },
        ],
        unavailable: 0,
      },
    });
    vi.mocked(window.drelwick.project.previewHistory).mockResolvedValue({
      ok: true,
      value: {
        fingerprint: "a".repeat(64),
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "OLD" }] },
          ],
        },
      },
    });
    await click("Chapter History");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('ol[aria-label="Snapshots"] button')!
        .click(),
    );
  }
  it("history preview is read-only, does not save or dirty, and requires separate confirmation", async () => {
    vi.useFakeTimers();
    await openChapter();
    const before = editor().getJSON();
    await showHistory();
    expect(
      container
        .querySelector('[aria-label="Snapshot preview"]')
        ?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(editor().getJSON()).toEqual(before);
    expect(saveStatus()).toBe("All changes saved");
    expect(saveChapter).not.toHaveBeenCalled();
    await click("Restore snapshot");
    expect(window.drelwick.project.restoreHistory).not.toHaveBeenCalled();
    expect(container.textContent).toContain("including unsaved edits");
    await click("Cancel restore");
    expect(window.drelwick.project.restoreHistory).not.toHaveBeenCalled();
  });
  it.each(["flush", "snapshot", "commit"])(
    "history %s failure retains B and never reports success",
    async (stage) => {
      vi.useFakeTimers();
      await openChapter();
      await editText("B unsaved");
      await showHistory();
      if (stage === "flush")
        saveChapter.mockResolvedValue({
          ok: false,
          error: { code: "CHAPTER_SAVE_FAILED", message: "save failed" },
        });
      vi.mocked(window.drelwick.project.restoreHistory).mockResolvedValue({
        ok: false,
        error: { code: "HISTORY_FAILED", message: "Restore failed safely" },
      });
      await click("Restore snapshot");
      await click("Confirm restore");
      expect(editor().getText()).toBe("B unsaved");
      expect(container.textContent).not.toContain("Snapshot restored.");
      if (stage === "flush") {
        expect(window.drelwick.project.restoreHistory).not.toHaveBeenCalled();
        expect(saveStatus()).toBe("Unsaved changes");
      } else {
        expect(window.drelwick.project.restoreHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            document: editor().getJSON(),
            confirmed: true,
          }),
        );
        expect(container.textContent).toContain("Restore failed safely");
      }
    },
  );
  it("flushes unsaved B before history restore and replaces editor only after success", async () => {
    vi.useFakeTimers();
    await openChapter();
    await editText("B unsaved");
    const b = editor().getJSON();
    await showHistory();
    let finish!: (
      value: Awaited<ReturnType<DrelwickApi["project"]["restoreHistory"]>>,
    ) => void;
    vi.mocked(window.drelwick.project.restoreHistory).mockImplementation(
      async (input) => {
        expect(saveChapter).toHaveBeenCalledOnce();
        expect(input.document).toEqual(b);
        expect(editor().getJSON()).toEqual(b);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    await click("Restore snapshot");
    await click("Confirm restore");
    expect(editor().getJSON()).toEqual(b);
    expect(editor().isEditable).toBe(false);
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "OLD" }] },
      ],
    };
    loadChapter.mockResolvedValue({
      ok: true,
      value: { id: "123e4567-e89b-42d3-a456-426614174001", content },
    });
    await act(async () =>
      finish({
        ok: true,
        value: { id: "123e4567-e89b-42d3-a456-426614174001", content },
      }),
    );
    expect(editor().getText()).toBe("OLD");
    expect(saveStatus()).toBe("All changes saved");
  });
  it("refresh removes pruned selections and disables restore for deleted chapters", async () => {
    vi.useFakeTimers();
    await openChapter();
    await showHistory();
    const list = vi.mocked(window.drelwick.project.listHistory);
    const old = await list.mock.results[0]!.value;
    if (!old.ok) throw new Error("fixture");
    list.mockResolvedValue({ ok: true, value: { ...old.value, title: null } });
    await click("Refresh history");
    expect(button("Restore snapshot").disabled).toBe(true);
    expect(container.textContent).toContain("no longer exists");
    list.mockResolvedValue({ ok: true, value: { ...old.value, entries: [] } });
    await click("Refresh history");
    expect(
      container.querySelector('[aria-label="Snapshot preview"]'),
    ).toBeNull();
    expect(button("Restore snapshot").disabled).toBe(true);
  });
  async function searchInput(label: string, value: string) {
    await act(async () => {
      const field = Array.from(container.querySelectorAll("label"))
        .find((node) => node.textContent?.startsWith(label))
        ?.querySelector("input");
      if (!field) throw new Error("Missing search input");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function wholeManuscript() {
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>(
        'section[aria-label="Manuscript find and replace"] select',
      )!;
      select.value = "manuscript";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  it("finds unsaved prose, navigates, replaces through editor undo and invalidates edited offsets", async () => {
    vi.useFakeTimers();
    await openChapter();
    await editText("The silver moon silver");
    await click("Find and replace");
    await searchInput("Find text", "silver");
    expect(container.textContent).toContain("0 of 2 matches");
    expect(saveChapter).not.toHaveBeenCalled();
    await click("Next match");
    expect(container.textContent).toContain("1 of 2 matches");
    await searchInput("Replacement text", "金色");
    await click("Replace one");
    expect(editor().getText()).toBe("The 金色 moon silver");
    await act(async () => {
      editor().commands.undo();
    });
    expect(editor().getText()).toContain("silver moon silver");
    await click("Next match");
    await editText("changed");
    expect(button("Replace one").disabled).toBe(true);
    expect(saveStatus()).toBe("Unsaved changes");
  });
  it("reviews whole manuscript counts and flushes newer prose before bulk replacement", async () => {
    vi.useFakeTimers();
    await openTwoChapters();
    await editText("New silver prose");
    await click("Find and replace");
    await wholeManuscript();
    await searchInput("Find text", "silver");
    await searchInput("Replacement text", "gold");
    await click("Review replace all");
    expect(container.textContent).toContain(
      "whole manuscript: 1 matches in 1 chapters",
    );
    expect(window.drelwick.project.replaceManuscript).not.toHaveBeenCalled();
    vi.mocked(window.drelwick.project.replaceManuscript).mockImplementation(
      async (request) => {
        expect(saveChapter).toHaveBeenCalledOnce();
        expect(JSON.stringify(request.expected)).toContain("New silver prose");
        expect(request.chapterId).toBeUndefined();
        return {
          ok: false,
          error: {
            code: "REPLACEMENT_FAILED",
            message: "Original content preserved",
          },
        };
      },
    );
    await click("Confirm replace all");
    expect(window.drelwick.project.replaceManuscript).toHaveBeenCalledOnce();
    expect(editor().getText()).toBe("New silver prose");
    expect(container.textContent).toContain("Original content preserved");
  });
  it("preserves unsaved prose and does not bulk-write after flush failure", async () => {
    vi.useFakeTimers();
    await openChapter();
    await editText("silver");
    saveChapter.mockResolvedValue({
      ok: false,
      error: { code: "CHAPTER_SAVE_FAILED", message: "save failed" },
    });
    await click("Find and replace");
    await searchInput("Find text", "silver");
    await click("Review replace all");
    await click("Confirm replace all");
    expect(window.drelwick.project.replaceManuscript).not.toHaveBeenCalled();
    expect(editor().getText()).toBe("silver");
    expect(saveStatus()).toBe("Unsaved changes");
  });
  it("invalidates a review when editing changes its counts", async () => {
    vi.useFakeTimers();
    await openChapter();
    await editText("silver");
    await click("Find and replace");
    await searchInput("Find text", "silver");
    await click("Review replace all");
    await editText(" silver");
    expect(button("Confirm replace all").disabled).toBe(true);
    expect(container.textContent).toContain("0 of 2 matches");
  });
  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "opens Find from conventional keyboard access %j",
    async (modifiers) => {
      vi.useFakeTimers();
      await openChapter();
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", ...modifiers }),
        );
        await vi.advanceTimersByTimeAsync(5);
      });
      expect(
        container.querySelector(
          'section[aria-label="Manuscript find and replace"]',
        ),
      ).not.toBeNull();
    },
  );
  async function shortcut(modifiers: KeyboardEventInit) {
    const event = new KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    await act(async () => {
      (container.querySelector(".tiptap") ?? window).dispatchEvent(event);
    });
    return event;
  }

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "flushes immediately from the editor with %j and reports failure/retry",
    async (modifiers) => {
      vi.useFakeTimers();
      await openChapter();
      await editText();
      saveChapter.mockResolvedValueOnce({
        ok: false,
        error: { code: "CHAPTER_SAVE_FAILED", message: "Save failed; retry." },
      });
      expect((await shortcut(modifiers)).defaultPrevented).toBe(true);
      expect(saveChapter).toHaveBeenCalledExactlyOnceWith({
        chapterId: "123e4567-e89b-42d3-a456-426614174001",
        document: editor().getJSON(),
        source: "manual",
      });
      expect(saveStatus()).toBe("Unsaved changes");
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Save failed; retry.",
      );
      expect(editor().getText()).toBe("Unsaved prose");
      await shortcut(modifiers);
      expect(saveStatus()).toBe("All changes saved");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(saveChapter).toHaveBeenCalledTimes(2);
    },
  );

  it("shares the menu command, ignores unrelated keys and removes listeners", async () => {
    await shortcut({ ctrlKey: true });
    expect(saveChapter).not.toHaveBeenCalled();
    await openChapter();
    await editText();
    for (const modifiers of [
      {},
      { ctrlKey: true, shiftKey: true },
      { metaKey: true, altKey: true },
    ]) {
      // The editor may handle these combinations for its own formatting commands.
      await shortcut(modifiers);
    }
    expect(saveChapter).not.toHaveBeenCalled();
    expect(saveListeners.size).toBe(1);
    await act(async () => {
      saveListeners.forEach((callback) => callback());
    });
    expect(saveChapter).toHaveBeenCalledTimes(1);
    expect(saveStatus()).toBe("All changes saved");
    await act(async () => root.render(null));
    expect(saveListeners.size).toBe(0);
    expect((await shortcut({ ctrlKey: true })).defaultPrevented).toBe(false);
  });

  it("flushes dirty editor content before a backup command starts", async () => {
    await openChapter();
    await editText();
    await act(async () => {
      menuListeners.forEach((callback) => callback("backup-project"));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(backupProject).toHaveBeenCalledOnce());
    expect(saveChapter).toHaveBeenCalledExactlyOnceWith({
      chapterId: "123e4567-e89b-42d3-a456-426614174001",
      document: editor().getJSON(),
      source: "autosave",
    });
    expect(saveChapter.mock.invocationCallOrder[0]).toBeLessThan(
      backupProject.mock.invocationCallOrder[0]!,
    );
  });

  it("flushes current prose before preview and uses a sandbox with no capabilities", async () => {
    await openChapter();
    await editText();
    await click("Book preview");
    await vi.waitFor(() => expect(previewBook).toHaveBeenCalledOnce());
    expect(saveChapter.mock.invocationCallOrder[0]).toBeLessThan(
      previewBook.mock.invocationCallOrder[0]!,
    );
    expect(saveChapter.mock.calls[0]?.[0].document).toEqual(editor().getJSON());
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).toBe("<p>Saved preview</p>");
    await click("Close preview");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("cancels preview on failed save while preserving dirty prose", async () => {
    await openChapter();
    await editText("Latest unsaved prose");
    saveChapter.mockResolvedValueOnce({
      ok: false,
      error: { code: "FAILED", message: "Save failed" },
    });
    await click("Book preview");
    expect(previewBook).not.toHaveBeenCalled();
    expect(editor().getText()).toBe("Latest unsaved prose");
    expect(editor().isEditable).toBe(true);
    expect(saveStatus()).toBe("Unsaved changes");
    expect(container.textContent).toContain("Preview was cancelled");
  });

  it("labels incomplete preview and explains missing assets without hiding the diagnostic", async () => {
    await openChapter();
    previewBook.mockResolvedValueOnce({
      ok: true,
      value: {
        revision: "partial",
        document: '<span role="img" aria-label="Missing alternative"></span>',
        complete: false,
        diagnostics: [
          {
            code: "missing-asset",
            severity: "error",
            chapterId: "123e4567-e89b-42d3-a456-426614174001",
            path: [0],
          },
        ],
      },
    });
    await click("Book preview");
    expect(container.textContent).toContain("This preview is incomplete");
    expect(container.textContent).toContain(
      "A local image is missing. Restore or replace the image.",
    );
    expect(container.querySelector("iframe")?.srcdoc).toContain(
      "Missing alternative",
    );
    await click("Close preview");
  });

  async function openChapter() {
    open.mockResolvedValueOnce({
      ok: true,
      value: {
        ...workspace,
        chapters: [
          {
            id: "123e4567-e89b-42d3-a456-426614174001",
            title: "Chapter",
            status: "draft",
            wordCount: 0,
          },
        ],
      },
    });
    await click("Open project");
  }
  function editor() {
    return (
      container.querySelector(".tiptap") as HTMLElement & {
        editor: import("@tiptap/core").Editor;
      }
    ).editor;
  }
  it("retains edits across word-count updates, saves serialized formatting and permits retry", async () => {
    await openChapter();
    await act(async () => {
      editor().commands.insertContent({
        type: "text",
        text: "Formatted prose",
        marks: [{ type: "bold" }, { type: "italic" }],
      });
    });
    const document = editor().getJSON();
    expect(loadChapter).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Formatted prose");
    saveChapter.mockResolvedValueOnce({
      ok: false,
      error: { code: "CHAPTER_SAVE_FAILED", message: "Save failed; retry." },
    });
    await click("Save chapter");
    expect(container.textContent).toContain("Save failed; retry.");
    expect(editor().getJSON()).toEqual(document);
    await click("Save chapter");
    expect(saveChapter).toHaveBeenLastCalledWith({
      chapterId: "123e4567-e89b-42d3-a456-426614174001",
      document,
      source: "manual",
    });
    expect(container.textContent).toContain("Chapter saved.");
    expect(loadChapter).toHaveBeenCalledTimes(1);
  });
  it("disables saving and editing until a chapter has loaded successfully", async () => {
    loadChapter.mockResolvedValueOnce({
      ok: false,
      error: { code: "CHAPTER_DOCUMENT_INVALID", message: "Invalid document" },
    });
    await openChapter();
    expect(button("Save chapter").disabled).toBe(true);
    expect(container.querySelector(".tiptap")).toBeNull();
    expect(container.textContent).toContain("Invalid document");
  });
  it("serializes newer edits while an immediate save flush is in flight", async () => {
    await openChapter();
    await editText("First edit");
    let finish!: (
      result: Awaited<ReturnType<DrelwickApi["project"]["saveChapter"]>>,
    ) => void;
    saveChapter.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await click("Save chapter");
    expect(button("Saving chapter...").disabled).toBe(true);
    expect(editor().isEditable).toBe(true);
    await act(async () => {
      editor().commands.insertContent("Newer edit");
    });
    await click("Saving chapter...");
    await shortcut({ ctrlKey: true });
    await shortcut({ metaKey: true });
    expect(saveChapter).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish({
        ok: true,
        value: {
          id: "123e4567-e89b-42d3-a456-426614174001",
          modified: "2026-09-16T12:00:00Z",
        },
      }),
    );
    expect(editor().isEditable).toBe(true);
    expect(container.textContent).toContain("Newer edit");
    expect(
      container.querySelector('[aria-label="Chapter save status"]')
        ?.textContent,
    ).toBe("All changes saved");
    expect(saveChapter.mock.calls[0]?.[0].document).not.toEqual(
      editor().getJSON(),
    );
    await click("Save chapter");
    expect(saveChapter.mock.calls[1]?.[0].document).toEqual(editor().getJSON());
    expect(
      container.querySelector('[aria-label="Chapter save status"]')
        ?.textContent,
    ).toBe("All changes saved");
  });
  function saveStatus() {
    return container.querySelector('[aria-label="Chapter save status"]')
      ?.textContent;
  }
  async function editText(text = "Unsaved prose") {
    await act(async () => {
      editor().commands.insertContent(text);
    });
  }
  async function openTwoChapters() {
    open.mockResolvedValueOnce({
      ok: true,
      value: {
        ...workspace,
        chapters: [
          {
            id: "123e4567-e89b-42d3-a456-426614174001",
            title: "First",
            status: "draft",
            wordCount: 0,
          },
          {
            id: "123e4567-e89b-42d3-a456-426614174002",
            title: "Second",
            status: "draft",
            wordCount: 0,
          },
        ],
      },
    });
    loadChapter.mockImplementation(async ({ chapterId }) => ({
      ok: true,
      value: {
        id: chapterId,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      },
    }));
    await click("Open project");
  }
  async function select(index: number) {
    await act(async () => {
      container
        .querySelectorAll<HTMLButtonElement>(".chapter-select")
        [index]?.click();
    });
  }
  it("flushes dirty chapter switches and keeps the current chapter after a failed save", async () => {
    await openTwoChapters();
    expect(saveStatus()).toBe("All changes saved");
    await editText();
    expect(saveStatus()).toBe("Unsaved changes");
    saveChapter.mockResolvedValue({
      ok: false,
      error: { code: "CHAPTER_SAVE_FAILED", message: "Retry saving" },
    });
    await select(1);
    expect(loadChapter).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[aria-current="page"]')?.textContent,
    ).toContain("First");
    expect(container.textContent).toContain("current chapter remains open");
    saveChapter.mockResolvedValue({
      ok: true,
      value: {
        id: "123e4567-e89b-42d3-a456-426614174001",
        modified: "2026-09-16T12:00:00Z",
      },
    });
    await select(1);
    expect(loadChapter).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[aria-current="page"]')?.textContent,
    ).toContain("Second");
    expect(saveStatus()).toBe("All changes saved");
  });
  it("blocks welcome and native imports when saving dirty content fails", async () => {
    mockImport();
    await openChapter();
    await editText("Unsaved import guard");
    saveChapter.mockResolvedValue({
      ok: false,
      error: { code: "CHAPTER_SAVE_FAILED", message: "Retry saving" },
    });
    await click("Import manuscript");
    await act(async () => {
      for (const listener of menuListeners) listener("import-manuscript");
    });
    expect(saveChapter).toHaveBeenCalled();
    expect(window.drelwick.imports.inspect).not.toHaveBeenCalled();
    expect(window.drelwick.imports.open).not.toHaveBeenCalled();
    expect(editor().getText()).toBe("Unsaved import guard");
    expect(saveStatus()).toBe("Unsaved changes");
  });
  it("protects dirty content from creation, active deletion and opening another project", async () => {
    await openChapter();
    await editText();
    saveChapter.mockResolvedValue({
      ok: false,
      error: { code: "CHAPTER_SAVE_FAILED", message: "Retry saving" },
    });
    await input("new-chapter-title", "New chapter");
    await click("New chapter");
    await click("Delete");
    await click("Open project");
    expect(createChapter).not.toHaveBeenCalled();
    expect(deleteChapter).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(editor().getText()).toBe("Unsaved prose");
    expect(saveStatus()).toBe("Unsaved changes");
  });
  it("waits for an in-flight save and leaves rejected saves dirty", async () => {
    await openTwoChapters();
    await editText();
    let reject!: (error: Error) => void;
    saveChapter.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    await click("Save chapter");
    await editText(" newer");
    act(() => {
      container
        .querySelectorAll<HTMLButtonElement>(".chapter-select")[1]
        ?.click();
    });
    expect(loadChapter).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("IPC failed")));
    expect(saveStatus()).toBe("Unsaved changes");
    expect(editor().getText()).toBe("Unsaved prose newer");
    await select(1);
    expect(loadChapter).toHaveBeenCalledTimes(2);
  });
  it("does not clear dirty state for an acknowledgement naming another chapter", async () => {
    await openChapter();
    await editText();
    saveChapter.mockResolvedValueOnce({
      ok: true,
      value: { id: "different-chapter", modified: "2026-09-16T12:00:00Z" },
    });
    await click("Save chapter");
    expect(saveStatus()).toBe("Unsaved changes");
    expect(container.textContent).toContain("acknowledgement did not match");
    await click("Save chapter");
    expect(saveStatus()).toBe("All changes saved");
  });
  it("captures edits made immediately before a save without waiting for a React render", async () => {
    await openChapter();
    await act(async () => {
      editor().commands.insertContent("Immediate edit");
      button("Save chapter").click();
    });
    expect(saveChapter.mock.calls[0]?.[0].document).toEqual(editor().getJSON());
    expect(saveStatus()).toBe("All changes saved");
  });
  it("flushes a chapter switch immediately after an editor transaction", async () => {
    await openTwoChapters();
    await act(async () => {
      editor().commands.insertContent("Immediate edit");
      container
        .querySelectorAll<HTMLButtonElement>(".chapter-select")[1]
        ?.click();
    });
    expect(loadChapter).toHaveBeenCalledTimes(2);
    expect(editor().getText()).toBe("");
    expect(saveStatus()).toBe("All changes saved");
    expect(saveChapter).toHaveBeenCalledTimes(1);
  });
  it("reloads a reopened project even if its first chapter has the same identity", async () => {
    await openChapter();
    await openChapter();
    expect(loadChapter).toHaveBeenCalledTimes(2);
    expect(saveStatus()).toBe("All changes saved");
  });
  it("keeps late chapter loads from replacing edits after a rapid switch back", async () => {
    await openTwoChapters();
    type LoadResult = Awaited<
      ReturnType<DrelwickApi["project"]["loadChapter"]>
    >;
    let finishSecond!: (result: LoadResult) => void;
    let finishFirst!: (result: LoadResult) => void;
    loadChapter.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSecond = resolve;
      }),
    );
    loadChapter.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    await select(1);
    await select(0);
    expect(container.querySelector(".tiptap")).toBeNull();
    expect(button("Save chapter").disabled).toBe(true);
    await act(async () =>
      finishFirst({
        ok: true,
        value: {
          id: "123e4567-e89b-42d3-a456-426614174001",
          content: { type: "doc", content: [{ type: "paragraph" }] },
        },
      }),
    );
    await editText("Keep these edits");
    await act(async () =>
      finishSecond({
        ok: true,
        value: {
          id: "123e4567-e89b-42d3-a456-426614174002",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Old response" }],
              },
            ],
          },
        },
      }),
    );
    expect(editor().getText()).toBe("Keep these edits");
    expect(saveStatus()).toBe("Unsaved changes");
  });
  it("pauses editing during project replacement so the in-flight open cannot discard new edits", async () => {
    await openChapter();
    let finish!: (
      result: ProjectOperationResult<ProjectWorkspace | null>,
    ) => void;
    open.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await click("Open project");
    expect(editor().isEditable).toBe(false);
    expect(button("Save chapter").disabled).toBe(true);
    await act(async () => finish({ ok: true, value: null }));
    expect(editor().isEditable).toBe(true);
    expect(saveStatus()).toBe("All changes saved");
  });
  describe("autosave triggers", () => {
    beforeEach(() =>
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }),
    );
    async function advance(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }
    it("automatically saves only after 750 ms of idle typing", async () => {
      await openChapter();
      await editText("First");
      await advance(749);
      expect(saveChapter).not.toHaveBeenCalled();
      await editText(" second");
      await advance(749);
      expect(saveChapter).not.toHaveBeenCalled();
      expect(editor().isEditable).toBe(true);
      expect(saveStatus()).toBe("Unsaved changes");
      await advance(1);
      expect(saveChapter).toHaveBeenCalledExactlyOnceWith({
        chapterId: "123e4567-e89b-42d3-a456-426614174001",
        document: editor().getJSON(),
        source: "autosave",
      });
      expect(saveStatus()).toBe("All changes saved");
      await advance(2000);
      expect(saveChapter).toHaveBeenCalledTimes(1);
    });
    it("keeps typing responsive and saves newer edits after their own debounce", async () => {
      await openChapter();
      let finish!: (
        result: Awaited<ReturnType<DrelwickApi["project"]["saveChapter"]>>,
      ) => void;
      saveChapter.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      await editText("First");
      await advance(750);
      expect(editor().isEditable).toBe(true);
      await editText(" newer");
      await act(async () =>
        finish({
          ok: true,
          value: {
            id: "123e4567-e89b-42d3-a456-426614174001",
            modified: "2026-09-16T12:00:00Z",
          },
        }),
      );
      expect(saveStatus()).toBe("Unsaved changes");
      expect(editor().getText()).toBe("First newer");
      await advance(749);
      expect(saveChapter).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(saveChapter).toHaveBeenCalledTimes(2);
      expect(saveStatus()).toBe("All changes saved");
    });
    it("reports an autosave failure, retains dirty content and retries after another edit", async () => {
      await openChapter();
      saveChapter.mockRejectedValueOnce(new Error("IPC failure"));
      await editText();
      await advance(750);
      expect(saveStatus()).toBe("Unsaved changes");
      expect(container.textContent).toContain("Unable to save the chapter");
      expect(editor().getText()).toBe("Unsaved prose");
      await advance(30000);
      expect(saveChapter).toHaveBeenCalledTimes(1);
      await editText(" retry");
      await advance(750);
      expect(saveChapter).toHaveBeenCalledTimes(2);
      expect(saveStatus()).toBe("All changes saved");
    });
    it("flushes on window focus loss without waiting for the timer", async () => {
      await openChapter();
      await editText();
      await act(async () => {
        window.dispatchEvent(new Event("blur"));
      });
      expect(saveChapter).toHaveBeenCalledTimes(1);
      expect(saveStatus()).toBe("All changes saved");
      await advance(750);
      expect(saveChapter).toHaveBeenCalledTimes(1);
    });
    it("flushes before leaving a project and requires retrying the guarded transition", async () => {
      await openChapter();
      await editText();
      await click("Open project");
      expect(saveChapter).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);
      expect(editor().getText()).toBe("Unsaved prose");
      expect(saveStatus()).toBe("All changes saved");
      await click("Open project");
      expect(open).toHaveBeenCalledTimes(2);
    });
    it("requests a flush on application close, keeps the window open on failure and permits a clean retry", async () => {
      await openChapter();
      await editText();
      saveChapter.mockResolvedValueOnce({
        ok: false,
        error: { code: "CHAPTER_SAVE_FAILED", message: "Cannot save now" },
      });
      const failedClose = new Event("beforeunload", { cancelable: true });
      await act(async () => {
        window.dispatchEvent(failedClose);
      });
      expect(failedClose.defaultPrevented).toBe(true);
      expect(saveStatus()).toBe("Unsaved changes");
      expect(container.textContent).toContain("Cannot save now");
      const retry = new Event("beforeunload", { cancelable: true });
      await act(async () => {
        window.dispatchEvent(retry);
      });
      expect(retry.defaultPrevented).toBe(true);
      expect(saveStatus()).toBe("All changes saved");
      const cleanClose = new Event("beforeunload", { cancelable: true });
      await act(async () => {
        window.dispatchEvent(cleanClose);
      });
      expect(cleanClose.defaultPrevented).toBe(false);
      expect(saveChapter).toHaveBeenCalledTimes(2);
    });
    it("survives StrictMode setup replay and removes timers and listeners on unmount", async () => {
      await act(async () =>
        root.render(createElement(StrictMode, null, createElement(App))),
      );
      await openChapter();
      await editText();
      await advance(750);
      expect(saveChapter).toHaveBeenCalledTimes(1);
      await editText(" more");
      await act(async () => root.render(null));
      await advance(1000);
      await act(async () => {
        window.dispatchEvent(new Event("blur"));
      });
      expect(saveChapter).toHaveBeenCalledTimes(1);
    });
  });
});

const importPreview = {
  operationId: selected.token,
  metadata: { title: "Imported novel", author: "Author", language: "en" },
  chapters: [
    {
      title: "One",
      type: "chapter",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First" }] },
        ],
      },
    },
    {
      title: "Two",
      type: "chapter",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Second" }] },
        ],
      },
    },
  ],
  assets: [],
  warnings: [
    {
      code: "DOCX_TABLE",
      message: "Table recovered as text.",
      location: { label: "Main document", chapter: 0, block: 0 },
    },
  ],
};
function mockImport() {
  vi.mocked(window.drelwick.imports.inspect).mockResolvedValue({
    ok: true,
    value: importPreview,
  });
  vi.mocked(window.drelwick.imports.cancel).mockResolvedValue({
    ok: true,
    value: null,
  });
  vi.mocked(window.drelwick.imports.commit).mockResolvedValue({
    ok: true,
    value: { projectId: selected.token },
  });
  vi.mocked(window.drelwick.imports.open).mockResolvedValue({
    ok: true,
    value: { ...workspace, title: "Imported novel" },
  });
}
async function approveWarning() {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
}
it("requires a decision, maps chapters and opens only after commit through the welcome workflow", async () => {
  mockImport();
  await click("Import manuscript");
  expect(container.textContent).toContain("Imported novel");
  expect(container.textContent).toContain("Main document");
  expect(container.textContent).toContain("Table recovered as text");
  expect(button("Choose destination and import").disabled).toBe(true);
  await click("Choose destination and import");
  expect(window.drelwick.imports.commit).not.toHaveBeenCalled();
  await approveWarning();
  await click("Remove boundary before Two");
  await click("Choose destination and import");
  expect(window.drelwick.imports.commit).toHaveBeenCalledWith(
    expect.any(String),
    {
      boundaries: [{ block: 0, title: "One" }],
      acceptedWarnings: [0],
    },
  );
  expect(window.drelwick.imports.open).toHaveBeenCalledOnce();
  expect(container.querySelector("dialog")).toBeNull();
  expect(container.textContent).toContain("Imported novel");
});
it("uses the same native workflow and preserves the active project after preview cancellation", async () => {
  mockImport();
  await click("Open project");
  await act(async () => {
    for (const listener of menuListeners) listener("import-manuscript");
  });
  expect(window.drelwick.imports.inspect).toHaveBeenCalledOnce();
  await click("Cancel import");
  expect(window.drelwick.imports.cancel).toHaveBeenCalledOnce();
  expect(window.drelwick.imports.commit).not.toHaveBeenCalled();
  expect(container.querySelector("dialog")).toBeNull();
  expect(container.textContent).toContain("Example");
});
it("retains review on destination cancellation and never opens a failed commit", async () => {
  mockImport();
  await click("Open project");
  await click("Import manuscript");
  await approveWarning();
  vi.mocked(window.drelwick.imports.commit).mockResolvedValueOnce({
    ok: true,
    value: null,
  });
  await click("Choose destination and import");
  expect(container.querySelector("dialog")).not.toBeNull();
  expect(window.drelwick.imports.open).not.toHaveBeenCalled();
  vi.mocked(window.drelwick.imports.commit).mockResolvedValueOnce({
    ok: false,
    error: {
      code: "IMPORT_FAILED",
      message: "Write failed; source preserved.",
    },
  });
  await click("Choose destination and import");
  expect(window.drelwick.imports.open).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Write failed");
  expect(container.textContent).toContain("Example");
  await click("Close import");
});
it("keeps the old project if committed project validation fails", async () => {
  mockImport();
  await click("Open project");
  vi.mocked(window.drelwick.imports.open).mockResolvedValueOnce({
    ok: false,
    error: {
      code: "PROJECT_SCHEMA_INVALID",
      message: "Invalid project format.",
    },
  });
  await click("Import manuscript");
  await approveWarning();
  await click("Choose destination and import");
  expect(container.textContent).toContain("Invalid project format");
  expect(container.textContent).toContain("Example");
  expect(button("Retry opening imported project").disabled).toBe(false);
  await click("Close import");
});
it("waits for privileged inspection cancellation to settle", async () => {
  mockImport();
  let finish!: (
    value: Awaited<ReturnType<DrelwickApi["imports"]["inspect"]>>,
  ) => void;
  vi.mocked(window.drelwick.imports.inspect).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click("Import manuscript");
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Inspecting document",
  );
  await click("Cancel import");
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Cancelling import and cleaning up",
  );
  expect(window.drelwick.imports.cancel).toHaveBeenCalledOnce();
  expect(container.querySelector("dialog")).not.toBeNull();
  await act(async () =>
    finish({
      ok: false,
      error: { code: "IMPORT_CANCELLED", message: "Cancelled" },
    }),
  );
  expect(container.querySelector("dialog")).toBeNull();
  expect(window.drelwick.imports.open).not.toHaveBeenCalled();
});

it("does not hide a completed preview until privileged cancellation acknowledges cleanup", async () => {
  mockImport();
  let finishInspection!: (
    value: Awaited<ReturnType<DrelwickApi["imports"]["inspect"]>>,
  ) => void;
  let finishCancellation!: (
    value: Awaited<ReturnType<DrelwickApi["imports"]["cancel"]>>,
  ) => void;
  vi.mocked(window.drelwick.imports.inspect).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishInspection = resolve;
      }),
  );
  vi.mocked(window.drelwick.imports.cancel).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCancellation = resolve;
      }),
  );
  await click("Import manuscript");
  await click("Cancel import");
  await act(async () => finishInspection({ ok: true, value: importPreview }));
  expect(container.querySelector("dialog")).not.toBeNull();
  await act(async () =>
    finishCancellation({
      ok: false,
      error: {
        code: "IMPORT_CLEANUP_REQUIRED",
        message: "Preserve the interrupted folder.",
      },
    }),
  );
  expect(container.textContent).toContain("Preserve the interrupted folder");
  expect(container.querySelector("dialog")).not.toBeNull();
  await click("Close import");
  expect(window.drelwick.imports.open).not.toHaveBeenCalled();
});
it("retains a project completed before late cancellation without opening it", async () => {
  mockImport();
  let finish!: (
    value: Awaited<ReturnType<DrelwickApi["imports"]["commit"]>>,
  ) => void;
  vi.mocked(window.drelwick.imports.commit).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click("Open project");
  await click("Import manuscript");
  await approveWarning();
  await click("Choose destination and import");
  expect(container.querySelector("dialog")?.textContent).toContain(
    "then stage and write the project",
  );
  await click("Cancel import");
  await act(async () =>
    finish({ ok: true, value: { projectId: selected.token } }),
  );
  expect(window.drelwick.imports.open).not.toHaveBeenCalled();
  expect(container.querySelector("dialog")).toBeNull();
  expect(container.textContent).toContain(
    "Import finished before cancellation",
  );
  expect(container.textContent).toContain("Example");
});
it("explains blocked tracked changes and prevents commit", async () => {
  mockImport();
  vi.mocked(window.drelwick.imports.inspect).mockResolvedValueOnce({
    ok: false,
    error: {
      code: "DOCX_REVISIONS",
      message:
        "Tracked changes are not supported. Resolve revisions in a copy first.",
    },
  });
  await click("Import manuscript");
  expect(container.textContent).toContain("Resolve revisions in a copy");
  expect(button("Choose destination and import").disabled).toBe(true);
  expect(window.drelwick.imports.commit).not.toHaveBeenCalled();
  await click("Close import");
});

it("shows semantic line and scene breaks in the reading-order preview", async () => {
  mockImport();
  vi.mocked(window.drelwick.imports.inspect).mockResolvedValueOnce({
    ok: true,
    value: {
      ...importPreview,
      chapters: [
        {
          title: "One",
          type: "chapter",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Line one" },
                  { type: "hardBreak" },
                  { type: "text", text: "Line two" },
                ],
              },
              { type: "sceneBreak" },
            ],
          },
        },
      ],
    },
  });
  await click("Import manuscript");
  expect(container.querySelector("details ol li")?.textContent).toBe(
    "Line one\nLine two",
  );
  expect(container.querySelectorAll("details ol li")[1]?.textContent).toBe(
    "[Scene break]",
  );
  await click("Cancel import");
});

it("allows cancellation to be retried after a transport failure during cancelled inspection", async () => {
  mockImport();
  let fail!: (error: Error) => void;
  vi.mocked(window.drelwick.imports.inspect).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await click("Import manuscript");
  await click("Cancel import");
  await act(async () => fail(new Error("transport failure")));
  expect(container.textContent).toContain("Unable to inspect");
  await click("Cancel import");
  expect(window.drelwick.imports.cancel).toHaveBeenCalledTimes(2);
  expect(container.querySelector("dialog")).toBeNull();
});

describe("chapter organisation", () => {
  const first = "123e4567-e89b-42d3-a456-426614174001";
  const second = "123e4567-e89b-42d3-a456-426614174002";
  const chapters: ProjectWorkspace["chapters"] = [
    { id: first, title: "First", status: "draft", wordCount: 0 },
    { id: second, title: "Second", status: "review", wordCount: 0 },
  ];
  const editor = () =>
    (
      container.querySelector(".tiptap") as HTMLElement & {
        editor: import("@tiptap/core").Editor;
      }
    ).editor;
  async function prepare() {
    open.mockResolvedValue({ ok: true, value: { ...workspace, chapters } });
    loadChapter.mockImplementation(async ({ chapterId }) => ({
      ok: true,
      value: {
        id: chapterId,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      },
    }));
    await click("Open project");
    await act(async () => {
      editor().commands.insertContent({
        type: "text",
        text: "Left Right",
        marks: [{ type: "italic" }],
      });
      editor().commands.setTextSelection(6);
    });
  }
  async function selectMerge() {
    await act(async () => {
      container
        .querySelector<HTMLInputElement>(
          '[aria-label="Select First for merge"]',
        )!
        .click();
      container
        .querySelector<HTMLInputElement>(
          '[aria-label="Select Second for merge"]',
        )!
        .click();
    });
  }
  it.each(["split", "merge", "duplicate"])(
    "aborts %s after failed flush and preserves live formatting",
    async (operation) => {
      await prepare();
      const before = editor().getJSON();
      saveChapter.mockResolvedValue({
        ok: false,
        error: {
          code: "CHAPTER_SAVE_FAILED",
          message: "Injected save failure",
        },
      });
      if (operation === "merge") await selectMerge();
      await click(
        operation === "merge"
          ? "Merge selected chapters"
          : operation === "split"
            ? "Split at cursor"
            : "Duplicate",
      );
      if (operation === "split") await click("Split chapter");
      expect(saveChapter).toHaveBeenCalled();
      expect(window.drelwick.project.organiseChapter).not.toHaveBeenCalled();
      expect(editor().getJSON()).toEqual(before);
      expect(container.textContent).toContain("Unsaved changes");
      expect(container.querySelectorAll(".chapter-select")).toHaveLength(2);
    },
  );
  it.each(["split", "merge"])(
    "cancels %s confirmation without saving or changing content",
    async (operation) => {
      await prepare();
      const before = editor().getJSON();
      vi.mocked(window.confirm).mockReturnValue(false);
      if (operation === "merge") await selectMerge();
      await click(
        operation === "merge" ? "Merge selected chapters" : "Split at cursor",
      );
      if (operation === "split") await click("Cancel");
      expect(window.drelwick.project.organiseChapter).not.toHaveBeenCalled();
      expect(saveChapter).not.toHaveBeenCalled();
      expect(editor().getJSON()).toEqual(before);
      if (operation === "merge")
        expect(window.confirm).toHaveBeenCalledWith(
          expect.stringContaining("First” followed by “Second"),
        );
    },
  );
  it("flushes the exact formatted revision before sending the actual cursor position", async () => {
    await prepare();
    const content = editor().getJSON();
    const events: string[] = [];
    saveChapter.mockImplementation(async () => {
      events.push("saved");
      return {
        ok: true,
        value: { id: first, modified: "2026-09-24T12:00:00Z" },
      };
    });
    vi.mocked(window.drelwick.project.organiseChapter).mockImplementation(
      async () => {
        events.push("split");
        return {
          ok: true,
          value: { workspace: { ...workspace, chapters }, chapterId: first },
        };
      },
    );
    await click("Split at cursor");
    expect(container.querySelector("dialog")?.textContent).toContain("First");
    expect(window.drelwick.project.organiseChapter).not.toHaveBeenCalled();
    await click("Split chapter");
    expect(container.querySelector("dialog")).toBeNull();
    expect(events).toEqual(["saved", "split"]);
    expect(window.drelwick.project.organiseChapter).toHaveBeenCalledWith({
      projectId: workspace.projectId,
      expectedOrder: [first, second],
      operation: "split",
      chapterId: first,
      position: 6,
      expectedContent: content,
    });
  });
  it("closes the split menu and cancels with Escape without changing the cursor or content", async () => {
    await prepare();
    const before = editor().getJSON();
    const menu = container.querySelector<HTMLDetailsElement>(".chapter-menu")!;
    menu.open = true;
    await click("Split at cursor");
    expect(menu.open).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => {
      container
        .querySelector("dialog")!
        .dispatchEvent(
          new Event("cancel", { bubbles: false, cancelable: true }),
        );
    });
    expect(container.querySelector("dialog")).toBeNull();
    expect(editor().getJSON()).toEqual(before);
    expect(editor().state.selection.from).toBe(6);
    expect(saveChapter).not.toHaveBeenCalled();
    expect(window.drelwick.project.organiseChapter).not.toHaveBeenCalled();
  });
  it("disables split at start, end and nonempty selection", async () => {
    await prepare();
    for (const selection of [1, 11, { from: 2, to: 4 }]) {
      await act(async () => {
        editor().commands.setTextSelection(selection);
      });
      expect(button("Split at cursor").disabled).toBe(true);
    }
  });
  it("keeps the editor locked on uncertain recovery and blocks closing during a transaction", async () => {
    await prepare();
    let finish!: (
      value: ProjectOperationResult<{
        workspace: ProjectWorkspace;
        chapterId: string;
      }>,
    ) => void;
    vi.mocked(window.drelwick.project.organiseChapter).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click("Duplicate");
    expect(editor().isEditable).toBe(false);
    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await [...shutdownListeners][0]!();
    });
    expect(allowed).toBe(false);
    await act(async () =>
      finish({
        ok: false,
        error: {
          code: "CHAPTER_RECOVERY_REQUIRED",
          message: "Reopen before editing",
        },
      }),
    );
    expect(editor().isEditable).toBe(false);
    expect(button("Duplicate").disabled).toBe(true);
  });
  it("exposes every canonical status and sends validated status changes after flushing", async () => {
    await prepare();
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Status for First"]',
    )!;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "draft",
      "revising",
      "review",
      "final",
    ]);
    vi.mocked(window.drelwick.project.organiseChapter).mockResolvedValue({
      ok: true,
      value: {
        workspace: {
          ...workspace,
          chapters: chapters.map((chapter) =>
            chapter.id === first ? { ...chapter, status: "final" } : chapter,
          ),
        },
        chapterId: first,
      },
    });
    const before = editor().getJSON();
    await act(async () => {
      select.value = "final";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(window.drelwick.project.organiseChapter).toHaveBeenCalledWith({
      projectId: workspace.projectId,
      expectedOrder: [first, second],
      operation: "status",
      chapterId: first,
      status: "final",
    });
    expect(editor().getJSON()).toEqual(before);
    expect(select.value).toBe("final");
  });
});
