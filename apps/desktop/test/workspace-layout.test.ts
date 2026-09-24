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
