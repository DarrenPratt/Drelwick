// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLayout } from "../src/renderer/components/WorkspaceLayout.js";

const workspace = () =>
  createElement(WorkspaceLayout, {
    title: "My book",
    author: "Author",
    navigator: "Chapters",
    editor: "Manuscript",
    status: "Saved",
    library: "Projects",
  });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("authoring workspace layout", () => {
  it("keeps character and location panels accessible together", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(WorkspaceLayout, {
          ...workspace().props,
          storyBible: "Character records",
          locations: "Location records",
        }),
      ),
    );
    expect(container.textContent).not.toContain("Location records");
    for (const [label, content] of [
      ["Story bible", "Character records"],
      ["Locations", "Location records"],
      ["Story bible", "Character records"],
    ]) {
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      expect(button).toBeDefined();
      await act(async () => button?.click());
      expect(button?.getAttribute("aria-pressed")).toBe("true");
      expect(
        container.querySelector(".inspector-scroll")?.textContent,
      ).toContain(content);
      expect(
        container.querySelector<HTMLElement>(".inspector-scroll > div[hidden]")
          ?.textContent ?? "",
      ).not.toBe(content);
    }
  });
  it("starts narrow windows with room for the writing surface and can reopen the outline", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 800);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(workspace()));

    expect(
      container.querySelector<HTMLElement>("#book-navigation")?.hidden,
    ).toBe(true);
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[aria-controls="book-navigation"]')
        ?.click();
    });
    expect(
      container.querySelector<HTMLElement>("#book-navigation")?.hidden,
    ).toBe(false);
  });
});
