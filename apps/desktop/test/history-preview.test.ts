// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fixturePath } from "../../../tests/helpers/fixture-projects.js";
import { HistoryPreviewContent } from "../src/renderer/ChapterHistoryDialog.js";

it("renders semantic formatting read-only, treats prose as text, and fetches no remote or local resources", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const read = vi.fn();
  window.drelwick = { images: { read } } as unknown as typeof window.drelwick;
  const fixture = JSON.parse(
    await readFile(
      join(
        fixturePath("formatted-book"),
        "manuscript",
        "00000000-0000-4000-8000-000000000311.json",
      ),
      "utf8",
    ),
  );
  fixture.content.content.push(
    {
      type: "paragraph",
      content: [
        { type: "text", text: '<script>alert("Unicode 日本語")</script>' },
      ],
    },
    {
      type: "image",
      attrs: {
        assetId: "00000000-0000-4000-8000-000000000999",
        alt: "Missing image",
        size: "medium",
      },
    },
  );
  const source = JSON.stringify(fixture.content);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(HistoryPreviewContent, { content: fixture.content }),
      ),
    );
    for (const selector of [
      "h2",
      "strong",
      "em",
      "blockquote",
      "ul",
      "ol",
      "a",
      "hr",
    ])
      expect(container.querySelector(selector)).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(
      '<script>alert("Unicode 日本語")</script>',
    );
    expect(
      container
        .querySelector('[aria-label="Snapshot preview"]')
        ?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(container.querySelector("img[src]")).toBeNull();
    expect(container.querySelector("figure")?.textContent).toBe(
      "Missing image",
    );
    expect(container.querySelector("button")).toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    container.querySelector("a")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.content)).toBe(source);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
