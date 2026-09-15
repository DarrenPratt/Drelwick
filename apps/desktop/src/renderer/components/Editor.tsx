import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { useEffect } from "react";
import { SceneBreak } from "./SceneBreak.js";

const escapedCharacters: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => escapedCharacters[character]!);
}

function sanitizeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag =
    {
      B: "strong",
      BLOCKQUOTE: "blockquote",
      BR: "br",
      DIV: "p",
      EM: "em",
      I: "em",
      P: "p",
      STRONG: "strong",
    }[element.tagName] ?? "";
  if (
    ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(
      element.tagName,
    )
  )
    return "";

  const children = Array.from(element.childNodes).map(sanitizeNode).join("");
  return tag ? `<${tag}>${children}</${tag}>` : children;
}

export function sanitizePastedHtml(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  return Array.from(container.childNodes).map(sanitizeNode).join("");
}

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
    editorProps: {
      handlePaste: (view, event) => {
        const html = event.clipboardData?.getData("text/html");
        if (!html) return false;
        const sanitized = sanitizePastedHtml(html);
        const container = document.createElement("div");
        container.innerHTML = sanitized;
        const slice = ProseMirrorDOMParser.fromSchema(
          view.state.schema,
        ).parseSlice(container, { preserveWhitespace: true });
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content))
      editor.commands.setContent(content);
  }, [content, editor]);

  if (!editor) return <p>Loading editor…</p>;

  return (
    <section className="editor-panel" aria-label="Chapter editor">
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Formatting"
        aria-orientation="horizontal"
      >
        <button
          type="button"
          aria-label="Bold"
          title="Bold (Ctrl/⌘+B)"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          aria-label="Italic"
          title="Italic (Ctrl/⌘+I)"
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          aria-label="Block quote"
          title="Block quote"
          aria-pressed={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Block quote
        </button>
        <button
          type="button"
          aria-label="Insert scene break"
          title="Insert scene break"
          onClick={() => editor.chain().focus().insertSceneBreak().run()}
        >
          Scene break
        </button>
        <button
          type="button"
          aria-label="Undo"
          title="Undo (Ctrl/⌘+Z)"
          onClick={() => editor.chain().focus().undo()}
          disabled={!editor.can().undo()}
        >
          Undo
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo (Ctrl/⌘+Y)"
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
