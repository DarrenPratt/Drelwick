// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe("block quote editor node", () => {
  it("round-trips a semantic block quote containing marked prose", () => {
    editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Quoted " },
                  { type: "text", marks: [{ type: "bold" }], text: "prose" },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Quoted " },
                { type: "text", marks: [{ type: "bold" }], text: "prose" },
              ],
            },
          ],
        },
      ],
    });
    expect(editor.getHTML()).toContain("<blockquote>");
    expect(editor.getHTML()).toContain("<strong>prose</strong>");
  });

  it("toggles the semantic block quote without adding presentation text", () => {
    editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Quoted" }] },
        ],
      },
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(editor.commands.toggleBlockquote()).toBe(true);
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Quoted" }],
            },
          ],
        },
        { type: "paragraph" },
      ],
    });
    expect(editor.getText()).toContain("Quoted");
    expect(editor.getText()).not.toContain(">");
  });
});
