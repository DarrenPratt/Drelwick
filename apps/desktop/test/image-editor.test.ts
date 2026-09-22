// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor as HeadlessEditor, type JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManuscriptDocumentSchema } from "@bookeditor/project-model";
import {
  Editor,
  sanitizePastedHtml,
} from "../src/renderer/components/Editor.js";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
let root: Root | undefined;
let container: HTMLDivElement;
const selectImage = vi.fn();
const read = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "bookEditor", {
    configurable: true,
    value: { dialog: { selectImage }, images: { read } },
  });
  selectImage
    .mockReset()
    .mockResolvedValue({ ok: true, value: { assetId: first } });
  read.mockReset().mockResolvedValue({
    ok: false,
    error: { code: "IMAGE_UNAVAILABLE", message: "Unavailable" },
  });
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect());
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});
const image = {
  type: "image",
  attrs: { assetId: first, alt: "海 — café 🌱", size: "large" },
};
const click = async (text: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  )!;
  expect(button).toBeDefined();
  await act(async () => {
    button.focus();
    button.click();
  });
};

it("round-trips semantic images and rejects paths, remote sources and arbitrary styling", () => {
  const content = { type: "doc", content: [image] };
  const editor = new HeadlessEditor({
    extensions: createManuscriptExtensions(),
    content,
  });
  expect(editor.getJSON()).toEqual(content);
  expect(ManuscriptDocumentSchema.parse(editor.getJSON())).toEqual(content);
  editor.destroy();
  for (const attrs of [
    { ...image.attrs, src: "https://remote.invalid/x" },
    { ...image.attrs, assetId: "../x" },
    { ...image.attrs, size: "427px" },
    { ...image.attrs, width: 427 },
  ])
    expect(
      ManuscriptDocumentSchema.safeParse({
        type: "doc",
        content: [{ type: "image", attrs }],
      }).success,
    ).toBe(false);
});

it.each(["small", "medium", "large", "full"])(
  "round-trips %s semantic size with empty decorative alt text",
  (size) => {
    const content = {
      type: "doc",
      content: [{ ...image, attrs: { ...image.attrs, size, alt: "" } }],
    };
    const editor = new HeadlessEditor({
      extensions: createManuscriptExtensions(),
      content,
    });
    expect(ManuscriptDocumentSchema.parse(editor.getJSON())).toEqual(content);
    editor.destroy();
  },
);

it("undoes and redoes image removal through the toolbar", async () => {
  let latest: JSONContent = {
    type: "doc",
    content: [image, { type: "paragraph" }],
  };
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(Editor, {
        projectId: first,
        chapterId: second,
        content: latest,
        onChange: (content) => {
          latest = content;
        },
      }),
    ),
  );
  const editor = (
    container.querySelector(".tiptap") as HTMLElement & {
      editor: HeadlessEditor;
    }
  ).editor;
  await act(async () => {
    editor.commands.setNodeSelection(0);
  });
  await click("Remove image");
  expect(latest.content?.some((node) => node.type === "image")).toBe(false);
  const undo = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Undo"]',
  )!;
  await act(async () => undo.click());
  expect(latest.content?.[0]).toEqual(image);
  const redo = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Redo"]',
  )!;
  await act(async () => redo.click());
  expect(latest.content?.some((node) => node.type === "image")).toBe(false);
});

it("supports keyboard-focusable insert, alt text, sizing, replace and remove controls", async () => {
  let latest: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(Editor, {
        projectId: first,
        chapterId: second,
        content: latest,
        onChange: (content) => {
          latest = content;
        },
      }),
    ),
  );
  await click("Insert image");
  expect(selectImage).toHaveBeenCalledWith({
    projectId: first,
    chapterId: second,
  });
  // Select the inserted atom as a keyboard cursor would, without relying on layout.
  const editor = (
    container.querySelector(".tiptap") as HTMLElement & {
      editor: HeadlessEditor;
    }
  ).editor;
  await act(async () => {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") editor.commands.setNodeSelection(pos);
    });
  });
  const alt = container.querySelector(
    'input[aria-label="Alternative text"]',
  ) as HTMLInputElement;
  expect(alt).not.toBeNull();
  await act(async () => {
    alt.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(alt, "海 — café 🌱");
    alt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const size = container.querySelector(
    'select[aria-label="Image size"]',
  ) as HTMLSelectElement;
  await act(async () => {
    size.value = "full";
    size.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(latest.content?.find((node) => node.type === "image")?.attrs).toEqual({
    assetId: first,
    alt: "海 — café 🌱",
    size: "full",
  });
  selectImage.mockResolvedValueOnce({
    ok: false,
    error: { code: "IMAGE_IMPORT_FAILED", message: "Import failed" },
  });
  await click("Replace image");
  expect(
    latest.content?.find((node) => node.type === "image")?.attrs?.assetId,
  ).toBe(first);
  selectImage.mockResolvedValueOnce({ ok: true, value: { assetId: second } });
  await click("Replace image");
  expect(latest.content?.find((node) => node.type === "image")?.attrs).toEqual({
    assetId: second,
    alt: "海 — café 🌱",
    size: "full",
  });
  await click("Remove image");
  expect(latest.content?.some((node) => node.type === "image")).toBe(false);
  expect(ManuscriptDocumentSchema.safeParse(latest).success).toBe(true);
});

it("shows a recoverable missing-image state without changing the manuscript", async () => {
  root = createRoot(container);
  const changed = vi.fn();
  await act(async () =>
    root?.render(
      createElement(Editor, {
        projectId: first,
        chapterId: second,
        content: { type: "doc", content: [image] },
        onChange: changed,
      }),
    ),
  );
  expect(container.textContent).toContain("Its reference is preserved");
  expect(changed).not.toHaveBeenCalled();
  await click("Retry image");
  expect(changed).not.toHaveBeenCalled();
});

it("blocks image selection if pending chapter edits cannot be saved", async () => {
  root = createRoot(container);
  const changed = vi.fn();
  await act(async () =>
    root?.render(
      createElement(Editor, {
        projectId: first,
        chapterId: second,
        content: { type: "doc", content: [image] },
        onChange: changed,
        prepareImageImport: async () => false,
      }),
    ),
  );
  await click("Insert image");
  expect(selectImage).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Your edits remain available");
});

it("makes pasted remote images inert and preserves their alt text and surrounding prose", () => {
  const html = sanitizePastedHtml(
    '<p>Before<img src="https://remote.invalid/pixel" srcset="//remote.invalid/2 2x" onerror="alert(1)" alt="海 🌱">After</p>',
  );
  expect(html).not.toMatch(/<img|src=|srcset|https:|onerror/);
  expect(html).toContain("Before");
  expect(html).toContain("海 🌱");
  expect(html).toContain("After");
  expect(html).toContain("use Insert image");
});
