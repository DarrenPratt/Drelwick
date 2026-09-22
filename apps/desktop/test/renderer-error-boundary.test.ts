// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { RendererErrorBoundary } from "../src/renderer/RendererErrorBoundary.js";

const chapterId = "00000000-0000-4000-8000-000000000111";
const sentinel = "SENTINEL UNSAVED MANUSCRIPT PROSE";
const reportRendererError = vi.fn(() => Promise.resolve());
let container: HTMLDivElement;
let fixture: FixtureCopy;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sarel", { reportRendererError });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  reportRendererError.mockClear();
  fixture = await copyFixture("minimal-book");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await fixture.cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows a useful fallback, preserves dirty state and leaves project files untouched", async () => {
  const chapterPath = join(
    fixture.projectPath,
    "manuscript",
    `${chapterId}.json`,
  );
  const before = await readFile(chapterPath, "utf8");
  let shouldThrow = false;
  let observedState = "";

  function FaultyEditor({ content }: { content: string }) {
    if (shouldThrow) throw new Error(sentinel);
    return createElement("p", { "data-editor": true }, content);
  }

  function Harness() {
    const [content, setContent] = useState("Saved content");
    observedState = content;
    return createElement(
      "div",
      null,
      createElement(
        "button",
        {
          onClick: () => {
            shouldThrow = true;
            setContent(sentinel);
          },
        },
        "Inject failure",
      ),
      createElement(
        RendererErrorBoundary,
        { preserveWorkspaceState: true },
        createElement(FaultyEditor, { content }),
      ),
    );
  }

  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find(({ textContent }) => textContent === "Inject failure")!
      .click();
  });

  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "unsaved edits remain in this window",
  );
  expect(container.textContent).not.toContain(sentinel);
  expect(observedState).toBe(sentinel);
  expect(reportRendererError).toHaveBeenCalledWith({ errorName: "Error" });
  expect(JSON.stringify(reportRendererError.mock.calls)).not.toContain(
    sentinel,
  );
  expect(await readFile(chapterPath, "utf8")).toBe(before);

  shouldThrow = false;
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find(({ textContent }) => textContent === "Try interface again")!
      .click();
  });
  expect(container.querySelector("[data-editor]")?.textContent).toBe(sentinel);
});

it("keeps the fallback usable when sanitized error reporting fails", async () => {
  reportRendererError.mockRejectedValueOnce(new Error("unavailable"));
  function Failure(): never {
    const error = new Error("private author content");
    error.name = "SENTINEL MANUSCRIPT PROSE";
    throw error;
  }

  await act(async () =>
    root.render(
      createElement(RendererErrorBoundary, null, createElement(Failure)),
    ),
  );
  await act(async () => Promise.resolve());

  expect(container.textContent).toContain(
    "Saved project files were not changed",
  );
  expect(container.textContent).not.toContain("private author content");
  expect(reportRendererError).toHaveBeenCalledWith({
    errorName: "UnknownError",
  });
  expect(JSON.stringify(reportRendererError.mock.calls)).not.toContain(
    "SENTINEL",
  );
});
