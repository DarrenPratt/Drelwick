// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDemo } from "../src/renderer/components/WorkspaceDemo.js";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("isolated authoring workspace demonstration", () => {
  it("edits only sample content and clearly marks unimplemented features", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onExit = vi.fn();

    await act(async () => {
      root?.render(createElement(WorkspaceDemo, { onExit }));
    });

    expect(container.textContent).toContain("SAMPLE WORKSPACE");
    expect(container.textContent).toContain("The returning light");
    expect(container.textContent).toContain("Illustrative sample text");
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="Export your book (mock)"]',
        )
        ?.click();
    });
    expect(
      container.querySelector<HTMLButtonElement>(".planned-export")?.disabled,
    ).toBe(true);

    await act(async () => {
      const editor = container?.querySelector<HTMLElement>(".tiptap") as
        | (HTMLElement & {
            editor: { commands: { insertContent(text: string): void } };
          })
        | null;
      editor?.editor.commands.insertContent(" Ephemeral demo words.");
    });

    expect(container.textContent).toContain("Ephemeral demo words");
    expect(container.textContent).toContain("Sample session · not saved");
    expect(window.bookEditor).toBeUndefined();

    expect(container.textContent).toContain("No file will be created");
    expect(container.textContent).toContain("Ephemeral demo words");

    await act(async () => {
      const exit = Array.from(
        container?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((button) => button.textContent?.trim() === "Exit demo");
      exit?.click();
    });
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("starts narrow windows with room for the writing surface and can reopen the outline", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 800);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(createElement(WorkspaceDemo, { onExit: vi.fn() })),
    );

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
