// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DrelwickApi } from "@drelwick/shared";
import { EditorialSidebar } from "../src/renderer/EditorialSidebar.js";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";

it("retains annotation drafts after failed saves and refresh, and requires explicit discard", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const api = vi
    .fn<DrelwickApi["project"]["editorial"]>()
    .mockImplementation(async (request) =>
      request.operation === "get"
        ? {
            ok: true,
            value: { generation: 1, anchors: [], annotations: [], threads: [] },
          }
        : {
            ok: false,
            error: {
              code: "EDITORIAL_SAVE_FAILED",
              message: "Synthetic save failure",
            },
          },
    );
  vi.stubGlobal("drelwick", { project: { editorial: api } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const dirty = vi.fn();
  const editor = new Editor({
    extensions: createManuscriptExtensions(),
    content: "<p>quiet fox</p>",
  });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (label: string) => {
    const found = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === label,
    );
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  try {
    await act(async () => {
      root.render(
        createElement(EditorialSidebar, {
          editor,
          projectId: "00000000-0000-4000-8000-000000000001",
          chapterId: "00000000-0000-4000-8000-000000000002",
          flushManuscript: async () => true,
          onDirtyChange: dirty,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Private unsaved draft");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => button("Add annotation").click());
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "create",
        body: "Private unsaved draft",
      }),
    );
    expect(textarea.value).toBe("Private unsaved draft");
    expect(container.textContent).toContain("Synthetic save failure");
    await act(async () => button("Refresh annotations").click());
    expect(textarea.value).toBe("Private unsaved draft");
    await act(async () => button("Discard annotation drafts").click());
    expect(textarea.value).toBe("Private unsaved draft");
    confirm.mockReturnValue(true);
    await act(async () => button("Discard annotation drafts").click());
    expect(textarea.value).toBe("");
    expect(dirty).toHaveBeenLastCalledWith(false);
    api.mockImplementation(async (request) => ({
      ok: true,
      value:
        request.operation === "get"
          ? { generation: 2, anchors: [], annotations: [], threads: [] }
          : {},
    }));
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Saved draft");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Add annotation").click());
    expect(textarea.value).toBe("");
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(container.textContent).toContain("Annotation saved.");
  } finally {
    await act(async () => root.unmount());
    editor.destroy();
    container.remove();
    confirm.mockRestore();
    vi.unstubAllGlobals();
  }
});
