// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { Editor } from "../src/renderer/components/Editor.js";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("editor toolbar", () => {
  it("exposes named keyboard-operable controls and reflects editor state", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onChange = vi.fn<(content: JSONContent) => void>();

    await act(async () => {
      root?.render(
        createElement(Editor, {
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Editable prose" }],
              },
            ],
          },
          onChange,
        }),
      );
    });

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute("aria-orientation")).toBe("horizontal");
    for (const label of [
      "Bold",
      "Italic",
      "Block quote",
      "Insert scene break",
      "Undo",
      "Redo",
    ]) {
      expect(
        toolbar?.querySelector(`button[aria-label="${label}"]`),
      ).not.toBeNull();
    }

    const bold = toolbar?.querySelector<HTMLButtonElement>(
      'button[aria-label="Bold"]',
    );
    expect(bold?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => bold?.click());
    expect(bold?.type).toBe("button");
  });
});
