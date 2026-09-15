// @vitest-environment jsdom
import { act, createElement } from "react";
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
};
const create = vi.fn<BookEditorApi["project"]["create"]>();
const selectLocation = vi.fn<BookEditorApi["project"]["selectLocation"]>();
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
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
  window.bookEditor = {
    project: { create, selectLocation, open: vi.fn() },
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
