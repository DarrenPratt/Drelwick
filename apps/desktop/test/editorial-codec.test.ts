import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import {
  decodeEditorialDocument,
  decodeEditorialSlice,
  isEditorialDocumentBoundary,
} from "@drelwick/project-model";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";

it("DOM-free editorial codec preserves the pinned editor's semantic nodes, marks, defaults and slices", () => {
  const editor = getSchema(createManuscriptExtensions());
  const document = editor.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          {
            type: "text",
            text: "Heading",
            marks: [
              { type: "link", attrs: { href: "https://example.com" } },
              { type: "bold" },
              { type: "italic" },
            ],
          },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "List" }] },
            ],
          },
        ],
      },
      {
        type: "epigraph",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Quote" }] },
        ],
      },
      { type: "sceneBreak" },
      { type: "paragraph", content: [{ type: "hardBreak" }] },
    ],
  });
  const decoded = decodeEditorialDocument(document.toJSON());
  expect(decoded.toJSON()).toEqual(document.toJSON());
  for (let from = 0; from <= document.content.size; from++) {
    const to = Math.min(document.content.size, from + 3);
    const slice = document.slice(from, to);
    const encoded = {
      content: slice.content.toJSON() ?? [],
      openStart: slice.openStart,
      openEnd: slice.openEnd,
    };
    expect(decodeEditorialSlice(encoded).toJSON()).toEqual(slice.toJSON());
  }
});
it("rejects grapheme boundaries across differently marked text and malformed Unicode", () => {
  const doc = decodeEditorialDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "e" },
          { type: "text", text: "\u0301", marks: [{ type: "bold" }] },
        ],
      },
    ],
  });
  expect(isEditorialDocumentBoundary(doc, 2)).toBe(false);
  expect(isEditorialDocumentBoundary(doc, 1)).toBe(true);
  expect(isEditorialDocumentBoundary(doc, 3)).toBe(true);
  expect(() =>
    decodeEditorialDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "\ud800" }] },
      ],
    }),
  ).toThrow();
});
