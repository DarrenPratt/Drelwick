// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ManuscriptDocumentSchema } from "@bookeditor/project-model";
import { expect, it } from "vitest";
import { SceneBreak } from "../src/renderer/components/SceneBreak.js";

it("round-trips supported v0.1 content through JSON and editor deserialization", () => {
  const editor = new Editor({
    extensions: [StarterKit, SceneBreak],
    content:
      '<h2>Heading</h2><p><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s> <code>Code</code> <a href="https://example.com">Link</a><br>Break</p><blockquote><p>Quote</p></blockquote><ul><li><p>Bullet</p></li></ul><ol start="3"><li><p>Number</p></li></ol><pre><code>Code block</code></pre><hr><div data-scene-break="true"></div><p></p>',
  });
  let restored: Editor | undefined;
  try {
    const original = editor.getJSON();
    const serialized = JSON.stringify(editor.getJSON());
    const validated = ManuscriptDocumentSchema.parse(JSON.parse(serialized));
    restored = new Editor({
      extensions: [StarterKit, SceneBreak],
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
  ["empty block quote", { type: "blockquote", content: [] }],
  ["invalid inline node", { type: "paragraph", content: [{ type: "image" }] }],
])("rejects %s instead of silently dropping unsupported content", (_, node) => {
  expect(
    ManuscriptDocumentSchema.safeParse({ type: "doc", content: [node] })
      .success,
  ).toBe(false);
});
