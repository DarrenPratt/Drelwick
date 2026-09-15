// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { SceneBreak } from "../src/renderer/components/SceneBreak.js";

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe("scene break editor node", () => {
  it("serializes a scene break between paragraphs without text content", () => {
    editor = new Editor({
      extensions: [StarterKit, SceneBreak],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          { type: "sceneBreak" },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ],
      },
    });

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        { type: "sceneBreak" },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    });
    expect(editor.getText()).not.toContain("***");
  });

  it("inserts an isolated semantic node instead of decorative text", () => {
    editor = new Editor({
      extensions: [StarterKit, SceneBreak],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Text" }] },
        ],
      },
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(editor.commands.insertSceneBreak()).toBe(true);
    expect(editor.getJSON().content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Text" }] },
      { type: "sceneBreak" },
      { type: "paragraph" },
    ]);
    expect(editor.getHTML()).toContain(
      '<div data-scene-break="true" aria-label="Scene break">***</div>',
    );
  });
});
