// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { DrelwickApi, SpellingState } from "@drelwick/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";
import { SpellingPanel } from "../src/renderer/components/SpellingPanel.js";
import {
  replaceSpelling,
  spellingWords,
} from "../src/renderer/components/spelling-document.js";

let editor: Editor;
let root: Root;
let container: HTMLDivElement;
let settings: SpellingState;
let api: DrelwickApi["spelling"];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect());
  editor = new Editor({
    extensions: createManuscriptExtensions(),
    content: "<p><strong>helo</strong> world</p>",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  settings = {
    language: "en-US",
    words: [],
    languages: [
      { id: "en-US", label: "English (US)", available: true },
      { id: "en-GB", label: "English (UK)", available: true },
    ],
  };
  api = {
    get: vi.fn<DrelwickApi["spelling"]["get"]>(async () => ({
      ok: true,
      value: settings,
    })),
    update: vi.fn<DrelwickApi["spelling"]["update"]>(async (input) => {
      settings = {
        ...settings,
        ...(input.operation === "language"
          ? { language: input.language }
          : {
              words:
                input.operation === "add"
                  ? [...settings.words, input.word]
                  : settings.words.filter((word) => word !== input.word),
            }),
      };
      return { ok: true, value: settings };
    }),
    check: vi.fn<DrelwickApi["spelling"]["check"]>(async () => ({
      ok: true,
      value: { available: true, incorrect: ["helo"] },
    })),
    suggest: vi.fn<DrelwickApi["spelling"]["suggest"]>(async () => ({
      ok: true,
      value: ["hello"],
    })),
  };
  Object.defineProperty(window, "drelwick", {
    configurable: true,
    value: { spelling: api },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(createElement(SpellingPanel, { editor, editable: true })),
  );
}
async function click(name: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent === name,
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}

it("offers explicit suggestions without edits, preserves marks and uses ordinary undo/redo and onUpdate", async () => {
  const changed = vi.fn();
  editor.on("update", changed);
  const before = editor.getJSON();
  await render();
  await click("Check chapter");
  await click("Suggestions");
  expect(editor.getJSON()).toEqual(before);
  expect(changed).not.toHaveBeenCalled();
  await click("Replace with hello");
  expect(editor.getHTML()).toBe("<p><strong>hello</strong> world</p>");
  expect(changed).toHaveBeenCalledOnce();
  await act(async () => {
    editor.commands.undo();
  });
  expect(editor.getJSON()).toEqual(before);
  await act(async () => {
    editor.commands.redo();
  });
  expect(editor.getText()).toBe("hello world");
  expect(container.textContent).toContain("Chapter changed");
});

it("ignores asynchronous suggestions after typing, never applies a stale range, and rejects read-only edits", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.suggest>>) => void;
  api.suggest = vi.fn<DrelwickApi["spelling"]["suggest"]>(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await click("Check chapter");
  const reviewed = editor.state.doc;
  const occurrence = spellingWords(reviewed).words[0]!;
  await click("Suggestions");
  await act(async () => {
    editor.commands.insertContentAt(1, "new ");
  });
  await act(async () => {
    resolve({ ok: true, value: ["hello"] });
  });
  expect(container.textContent).not.toContain("Replace with hello");
  expect(replaceSpelling(editor, reviewed, occurrence, "hello")).toBe(false);
  editor.setEditable(false);
  expect(
    replaceSpelling(
      editor,
      editor.state.doc,
      spellingWords(editor.state.doc).words[0]!,
      "other",
    ),
  ).toBe(false);
});

it("changes language and manages personal words without modifying the manuscript", async () => {
  const before = editor.getJSON();
  await render();
  await click("Check chapter");
  await click("Add to personal dictionary");
  expect(api.update).toHaveBeenCalledWith({ operation: "add", word: "helo" });
  await click("Remove");
  expect(settings.words).toEqual([]);
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "en-GB";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Check chapter");
  expect(api.check).toHaveBeenLastCalledWith({
    language: "en-GB",
    words: ["helo", "world"],
  });
  expect(editor.getJSON()).toEqual(before);
});

it("shows missing resources and sanitized errors while keeping the document editable", async () => {
  settings = { ...settings, language: "fr-FR" };
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "missing or unsupported",
  );
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Check chapter",
    )?.disabled,
  ).toBe(true);
  await act(async () => {
    editor.commands.insertContent("Still editable ");
  });
  expect(editor.getText()).toContain("Still editable");
  api.update = vi.fn(async () => {
    throw new Error("privatecontent");
  });
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "en-US";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("Editing remains available");
  expect(container.textContent).not.toContain("privatecontent");
});

it("tokenizes Unicode and mark-split words, keeping UTF-16 editor positions and atom boundaries", () => {
  editor.commands.setContent(
    "<p>😀 <strong>he</strong>lo café l’été co-operate<br>world</p><blockquote><p>next</p></blockquote>",
  );
  const { words } = spellingWords(editor.state.doc);
  expect(words.map((entry) => entry.word)).toEqual([
    "helo",
    "café",
    "l’été",
    "co-operate",
    "world",
    "next",
  ]);
  for (const entry of words)
    expect(editor.state.doc.textBetween(entry.from, entry.to)).toBe(entry.word);
  expect(replaceSpelling(editor, editor.state.doc, words[1]!, "cafe")).toBe(
    true,
  );
  expect(editor.getText()).toContain("😀 helo cafe l’été");
});

it("uses the reviewed word's marks rather than unrelated stored typing marks", () => {
  editor.commands.setContent("<p>before <strong>helo</strong> after</p>");
  editor.commands.setTextSelection(1);
  editor.commands.toggleItalic();
  const reviewed = editor.state.doc;
  const occurrence = spellingWords(reviewed).words[1]!;
  expect(replaceSpelling(editor, reviewed, occurrence, "hello")).toBe(true);
  expect(editor.getHTML()).toBe("<p>before <strong>hello</strong> after</p>");
  editor.commands.undo();
  expect(editor.state.doc.eq(reviewed)).toBe(true);
});

it("batches long chapters and discards results when the document changes mid-check", async () => {
  const words = Array.from(
    { length: 600 },
    (_, index) =>
      `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
  );
  editor.commands.setContent(`<p>${words.join(" ")} ${"a".repeat(129)}</p>`);
  await render();
  await click("Check chapter");
  expect(
    vi.mocked(api.check).mock.calls.map(([input]) => input.words.length),
  ).toEqual([256, 256, 88]);
  expect(container.textContent).toContain(
    "1 words over 128 characters were skipped",
  );
  let resolve!: (value: Awaited<ReturnType<typeof api.check>>) => void;
  api.check = vi.fn<DrelwickApi["spelling"]["check"]>(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click("Check chapter");
  await act(async () => {
    editor.commands.setContent("<p>new chapter</p>");
  });
  await act(async () => {
    resolve({ ok: true, value: { available: true, incorrect: [words[0]!] } });
  });
  expect(container.textContent).not.toContain("Review:");
  expect(api.check).toHaveBeenCalledOnce();
});
