// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookEditorApi,
  ProjectOperationResult,
  ProjectWorkspace,
} from "@bookeditor/shared";
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
const create = vi.fn<BookEditorApi["project"]["create"]>();
const selectLocation = vi.fn<BookEditorApi["project"]["selectLocation"]>();
const open = vi.fn<BookEditorApi["project"]["open"]>();
const listRecent = vi.fn<BookEditorApi["project"]["listRecent"]>();
const openRecent = vi.fn<BookEditorApi["project"]["openRecent"]>();
const removeRecent = vi.fn<BookEditorApi["project"]["removeRecent"]>();
const renameChapter = vi.fn<BookEditorApi["project"]["renameChapter"]>();
const deleteChapter = vi.fn<BookEditorApi["project"]["deleteChapter"]>();
const reorderChapters = vi.fn<BookEditorApi["project"]["reorderChapters"]>();
const createChapter = vi.fn<BookEditorApi["project"]["createChapter"]>();
const saveChapter = vi.fn<BookEditorApi["project"]["saveChapter"]>();
const loadChapter = vi.fn<BookEditorApi["project"]["loadChapter"]>();
let root: Root;
let container: HTMLDivElement;
const saveListeners = new Set<() => void>();

beforeEach(async () => {
  saveListeners.clear();
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
  window.bookEditor = {
    onSaveRequested: vi.fn((callback) => {
      saveListeners.add(callback);
      return () => {
        saveListeners.delete(callback);
      };
    }),
    project: {
      create,
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
      result: Awaited<ReturnType<BookEditorApi["project"]["saveChapter"]>>,
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
  it("blocks dirty chapter switches, including after failed saves, until the latest edits are saved", async () => {
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
    expect(container.textContent).toContain(
      "Try switching again after all changes are saved",
    );
    saveChapter.mockResolvedValueOnce({
      ok: false,
      error: { code: "CHAPTER_SAVE_FAILED", message: "Retry saving" },
    });
    await click("Save chapter");
    await select(1);
    expect(saveStatus()).toBe("Unsaved changes");
    expect(editor().getText()).toBe("Unsaved prose");
    expect(loadChapter).toHaveBeenCalledTimes(1);
    saveChapter.mockResolvedValue({
      ok: true,
      value: {
        id: "123e4567-e89b-42d3-a456-426614174001",
        modified: "2026-09-16T12:00:00Z",
      },
    });
    await click("Save chapter");
    await select(1);
    expect(loadChapter).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[aria-current="page"]')?.textContent,
    ).toContain("Second");
    expect(saveStatus()).toBe("All changes saved");
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
  it("blocks switches during an in-flight save and leaves rejected saves dirty", async () => {
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
    await select(1);
    expect(loadChapter).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Try switching again after all changes are saved",
    );
    await act(async () => reject(new Error("IPC failed")));
    expect(saveStatus()).toBe("Unsaved changes");
    expect(editor().getText()).toBe("Unsaved prose newer");
    await select(1);
    expect(loadChapter).toHaveBeenCalledTimes(1);
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
  it("prevents a chapter switch immediately after an editor transaction", async () => {
    await openTwoChapters();
    await act(async () => {
      editor().commands.insertContent("Immediate edit");
      container
        .querySelectorAll<HTMLButtonElement>(".chapter-select")[1]
        ?.click();
    });
    expect(loadChapter).toHaveBeenCalledTimes(1);
    expect(editor().getText()).toBe("Immediate edit");
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
      ReturnType<BookEditorApi["project"]["loadChapter"]>
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
      });
      expect(saveStatus()).toBe("All changes saved");
      await advance(2000);
      expect(saveChapter).toHaveBeenCalledTimes(1);
    });
    it("keeps typing responsive and saves newer edits after their own debounce", async () => {
      await openChapter();
      let finish!: (
        result: Awaited<ReturnType<BookEditorApi["project"]["saveChapter"]>>,
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
