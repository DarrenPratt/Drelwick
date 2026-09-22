// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { Editor } from "../src/renderer/components/Editor.js";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect());
});

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
      "Bullet list",
      "Numbered list",
      "Add link",
      "Epigraph",
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

    const blockStyle = toolbar?.querySelector<HTMLSelectElement>(
      'select[aria-label="Block style"]',
    );
    expect(
      Array.from(blockStyle?.options ?? []).map((option) => option.value),
    ).toEqual([
      "paragraph",
      "heading-1",
      "heading-2",
      "heading-3",
      "heading-4",
      "heading-5",
      "heading-6",
    ]);
  });

  it("applies headings, lists and epigraphs through toolbar interactions", async () => {
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
              { type: "paragraph", content: [{ type: "text", text: "Prose" }] },
            ],
          },
          onChange,
        }),
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Block style"]',
    )!;
    select.value = "heading-3";
    await act(async () =>
      select.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(onChange.mock.lastCall?.[0].content?.[0]?.type).toBe("heading");
    expect(onChange.mock.lastCall?.[0].content?.[0]?.attrs).toEqual({
      level: 3,
    });

    select.value = "paragraph";
    await act(async () =>
      select.dispatchEvent(new Event("change", { bubbles: true })),
    );
    const bullet = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Bullet list"]',
    )!;
    await act(async () => bullet.click());
    expect(onChange.mock.lastCall?.[0].content?.[0]?.type).toBe("bulletList");
    await act(async () => bullet.click());

    const numbered = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Numbered list"]',
    )!;
    await act(async () => numbered.click());
    expect(onChange.mock.lastCall?.[0].content?.[0]?.type).toBe("orderedList");
    await act(async () => numbered.click());

    const epigraph = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Epigraph"]',
    )!;
    await act(async () => epigraph.click());
    expect(onChange.mock.lastCall?.[0].content?.[0]?.type).toBe("epigraph");
  });

  it("removes an existing link and rejects an unsafe requested link", async () => {
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
                content: [
                  {
                    type: "text",
                    text: "Linked",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: "https://example.invalid" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          onChange,
        }),
      );
    });

    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove link"]',
    );
    expect(remove).not.toBeNull();
    await act(async () => remove?.click());
    expect(
      onChange.mock.lastCall?.[0].content?.[0]?.content?.[0]?.marks,
    ).toBeUndefined();

    vi.spyOn(window, "prompt").mockReturnValue("javascript:alert(1)");
    const add = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add link"]',
    );
    await act(async () => add?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "safe http",
    );
  });
});
