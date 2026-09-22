// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import {
  isSupportedManuscriptLink,
  ManuscriptDocumentSchema,
} from "@bookeditor/project-model";
import { describe, expect, it } from "vitest";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";

it("round-trips supported v0.1 content through JSON and editor deserialization", () => {
  const editor = new Editor({
    extensions: createManuscriptExtensions(),
    content:
      '<h2>Heading</h2><p><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s> <code>Code</code> <a href="https://example.com">Link</a><br>Break</p><blockquote><p>Quote</p></blockquote><ul><li><p>Bullet</p></li></ul><ol start="3"><li><p>Number</p></li></ol><pre><code>Code block</code></pre><hr><div data-scene-break="true"></div><p></p>',
  });
  let restored: Editor | undefined;
  try {
    const original = editor.getJSON();
    const serialized = JSON.stringify(editor.getJSON());
    const validated = ManuscriptDocumentSchema.parse(JSON.parse(serialized));
    restored = new Editor({
      extensions: createManuscriptExtensions(),
      content: validated as JSONContent,
    });

    expect(restored.getJSON()).toEqual(original);
    expect(restored.getHTML()).toContain("<blockquote>");
    expect(restored.getHTML()).toContain('<div data-scene-break="true"');
    expect(restored.getText()).not.toContain("***");
  } finally {
    restored?.destroy();
    editor.destroy();
  }
});

it("round-trips deliberate publishing elements, nested lists and Unicode", () => {
  const document: JSONContent = {
    type: "doc",
    content: [
      ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `Heading ${level}` }],
      })),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Parent" }],
              },
              {
                type: "orderedList",
                attrs: { start: 2 },
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          {
                            type: "text",
                            text: "\u5b50\u9805\u76ee \u{1f31f}",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Safe link",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.invalid/r%C3%A9f" },
              },
            ],
          },
        ],
      },
      {
        type: "epigraph",
        attrs: { attribution: "\u03a3\u03b1\u03c0\u03c6\u03ce" },
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Synthetic epigraph \u2014 \u661f" },
            ],
          },
        ],
      },
    ],
  };
  const validated = ManuscriptDocumentSchema.parse(document);
  const editor = new Editor({
    extensions: createManuscriptExtensions(),
    content: validated as JSONContent,
  });
  try {
    expect(editor.getJSON()).toMatchObject(document);
    expect(ManuscriptDocumentSchema.parse(editor.getJSON())).toEqual(
      editor.getJSON(),
    );
    expect(editor.getHTML()).toContain('data-epigraph="true"');
    expect(editor.getHTML()).toContain('<ol start="2">');
  } finally {
    editor.destroy();
  }
});

describe("manuscript links", () => {
  it.each([
    "https://example.invalid/path?q=1",
    "http://example.invalid",
    "mailto:writer@example.invalid",
    "#chapter-2",
  ])("accepts the supported target %s", (href) => {
    expect(isSupportedManuscriptLink(href)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///private/manuscript",
    "//example.invalid/path",
    "relative/path",
    " https://example.invalid",
    "#",
  ])("rejects the unsafe or ambiguous target %s", (href) => {
    expect(isSupportedManuscriptLink(href)).toBe(false);
    expect(
      ManuscriptDocumentSchema.safeParse({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Unsafe",
                marks: [{ type: "link", attrs: { href } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

it.each([
  ["unknown node", { type: "mysteryNode" }],
  [
    "unknown mark",
    { type: "text", text: "Text", marks: [{ type: "highlight" }] },
  ],
  [
    "invalid scene-break attributes",
    { type: "sceneBreak", attrs: { glyph: "***" } },
  ],
  [
    "unsupported heading level",
    { type: "heading", attrs: { level: 7 }, content: [] },
  ],
  ["empty block quote", { type: "blockquote", content: [] }],
  ["empty epigraph", { type: "epigraph", content: [] }],
  [
    "heading inside an epigraph",
    {
      type: "epigraph",
      content: [{ type: "heading", attrs: { level: 2 } }],
    },
  ],
  ["invalid inline node", { type: "paragraph", content: [{ type: "image" }] }],
])("rejects %s instead of silently dropping unsupported content", (_, node) => {
  expect(
    ManuscriptDocumentSchema.safeParse({ type: "doc", content: [node] })
      .success,
  ).toBe(false);
});
