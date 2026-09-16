// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ManuscriptDocumentSchema } from "@bookeditor/project-model";
import { expect, it } from "vitest";
import { SceneBreak } from "../src/renderer/components/SceneBreak.js";

it("accepts and preserves documents serialized by the installed editor extensions", () => {
  const editor = new Editor({
    extensions: [StarterKit, SceneBreak],
    content:
      '<h2>Heading</h2><p><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s> <code>Code</code> <a href="https://example.com">Link</a><br>Break</p><blockquote><p>Quote</p></blockquote><ul><li><p>Bullet</p></li></ul><ol start="3"><li><p>Number</p></li></ol><pre><code>Code block</code></pre><hr><div data-scene-break="true"></div><p></p>',
  });
  try {
    const original = editor.getJSON();
    const validated = ManuscriptDocumentSchema.parse(original);
    editor.commands.setContent(validated as JSONContent, { emitUpdate: false });
    expect(editor.getJSON()).toEqual(original);
  } finally {
    editor.destroy();
  }
});
