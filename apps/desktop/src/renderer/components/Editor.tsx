import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import { useEffect } from "react";
import { SceneBreak } from "./SceneBreak.js";

interface EditorProps {
  content: JSONContent;
  onChange(content: JSONContent): void;
}

export function Editor({ content, onChange }: EditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, SceneBreak],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content))
      editor.commands.setContent(content);
  }, [content, editor]);

  if (!editor) return <p>Loading editor…</p>;

  return (
    <section className="editor-panel" aria-label="Chapter editor">
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          aria-label="Block quote"
          aria-pressed={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Block quote
        </button>
        <button
          type="button"
          aria-label="Insert scene break"
          onClick={() => editor.chain().focus().insertSceneBreak().run()}
        >
          Scene break
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().undo()}
          disabled={!editor.can().undo()}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo()}
          disabled={!editor.can().redo()}
        >
          Redo
        </button>
      </div>
      <EditorContent editor={editor} />
    </section>
  );
}
