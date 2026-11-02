// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { expect, it } from "vitest";
import { setEditorialDecorations } from "../src/renderer/components/EditorialDecorations.js";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";

it("renders private annotation decorations and clears stale ranges on text edits", () => {
  const editor = new Editor({
    extensions: createManuscriptExtensions(),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "quiet fox" }] },
      ],
    },
  });
  try {
    setEditorialDecorations(editor, [
      {
        from: 1,
        to: 6,
        annotationId: "00000000-0000-4000-8000-000000000001",
        kind: "highlight",
        colour: "yellow",
      },
    ]);
    expect(
      editor.view.dom.querySelector(".editorial-highlight-yellow")?.textContent,
    ).toBe("quiet");
    editor.view.dispatch(editor.state.tr.insertText("x", 1));
    expect(editor.view.dom.querySelector(".editorial-annotation")).toBeNull();
  } finally {
    editor.destroy();
  }
});
