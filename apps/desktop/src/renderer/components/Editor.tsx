import {
  isSupportedManuscriptLink,
  MANUSCRIPT_HEADING_LEVELS,
} from "@bookeditor/project-model";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { useEffect, useState } from "react";
import { createManuscriptExtensions } from "./manuscript-extensions.js";

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

function wrap(tag: string, children: string, attributes = ""): string {
  return `<${tag}${attributes}>${children}</${tag}>`;
}

function sanitizeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  if (
    ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(
      element.tagName,
    )
  )
    return "";

  const children = Array.from(element.childNodes).map(sanitizeNode).join("");
  const simpleTags: Record<string, string> = {
    B: "strong",
    BLOCKQUOTE: "blockquote",
    CODE: "code",
    DEL: "s",
    DIV: "p",
    EM: "em",
    I: "em",
    LI: "li",
    P: "p",
    S: "s",
    STRIKE: "s",
    STRONG: "strong",
    U: "u",
    UL: "ul",
  };
  const simpleTag = simpleTags[element.tagName];
  if (simpleTag) return wrap(simpleTag, children);
  if (/^H[1-6]$/.test(element.tagName))
    return wrap(element.tagName.toLowerCase(), children);
  if (element.tagName === "BR" || element.tagName === "HR")
    return `<${element.tagName.toLowerCase()}>`;
  if (element.tagName === "OL") {
    const start = element.getAttribute("start");
    const parsed = start === null ? undefined : Number(start);
    const attribute =
      parsed !== undefined && Number.isInteger(parsed)
        ? ` start="${parsed}"`
        : "";
    return wrap("ol", children, attribute);
  }
  if (element.tagName === "A") {
    const href = element.getAttribute("href") ?? "";
    if (!isSupportedManuscriptLink(href)) return children;
    const title = element.getAttribute("title");
    const attributes = ` href="${escapeHtml(href)}"${
      title ? ` title="${escapeHtml(title)}"` : ""
    }`;
    return wrap("a", children, attributes);
  }
  if (element.tagName === "ASIDE" && element.hasAttribute("data-epigraph")) {
    const attribution = element.getAttribute("data-attribution");
    const attributes = ` data-epigraph="true"${
      attribution ? ` data-attribution="${escapeHtml(attribution)}"` : ""
    }`;
    return wrap("aside", children, attributes);
  }
  return children;
}

export function sanitizePastedHtml(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  return Array.from(container.childNodes).map(sanitizeNode).join("");
}

interface EditorProps {
  content: JSONContent;
  editable?: boolean;
  title?: string;
  chapterLabel?: string;
  onChange(content: JSONContent): void;
}

export function Editor({
  content,
  onChange,
  editable = true,
  title,
  chapterLabel,
}: EditorProps) {
  const [linkError, setLinkError] = useState<string>();
  const editor = useEditor({
    extensions: createManuscriptExtensions(),
    content,
    editable,
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
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      heading: MANUSCRIPT_HEADING_LEVELS.find((level) =>
        current?.isActive("heading", { level }),
      ),
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      link: current?.isActive("link") ?? false,
      epigraph: current?.isActive("epigraph") ?? false,
      blockquote: current?.isActive("blockquote") ?? false,
      canUndo: current?.can().undo() ?? false,
      canRedo: current?.can().redo() ?? false,
    }),
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content))
      editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);

  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  if (!editor) return <p>Loading editor…</p>;

  const activeHeading = active?.heading;
  const blockType = activeHeading ? `heading-${activeHeading}` : "paragraph";

  function editLink() {
    setLinkError(undefined);
    if (active?.link) {
      editor?.chain().focus().unsetLink().run();
      return;
    }
    const href = window.prompt(
      "Link address (http, https, mailto or #fragment)",
      "https://",
    );
    if (href === null) return;
    if (!isSupportedManuscriptLink(href)) {
      setLinkError("Enter a safe http, https, email or #fragment link.");
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  return (
    <section className="editor-panel" aria-label="Chapter editor">
      <fieldset
        disabled={!editable}
        className="editor-toolbar"
        role="toolbar"
        aria-label="Formatting"
        aria-orientation="horizontal"
      >
        <span className="toolbar-label">Text</span>
        <label className="toolbar-select-label">
          <span>Block style</span>
          <select
            aria-label="Block style"
            value={blockType}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "paragraph")
                editor.chain().focus().setParagraph().run();
              else {
                const level = Number(value.slice("heading-".length)) as
                  1 | 2 | 3 | 4 | 5 | 6;
                editor.chain().focus().setHeading({ level }).run();
              }
            }}
          >
            <option value="paragraph">Paragraph</option>
            {MANUSCRIPT_HEADING_LEVELS.map((level) => (
              <option key={level} value={`heading-${level}`}>
                Heading {level}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Bold"
          title="Bold (Ctrl/⌘+B)"
          aria-pressed={active?.bold ?? false}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          title="Italic (Ctrl/⌘+I)"
          aria-pressed={active?.italic ?? false}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="Bullet list"
          title="Bullet list"
          aria-pressed={active?.bulletList ?? false}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <span aria-hidden="true">&bull;</span>
        </button>
        <button
          type="button"
          aria-label="Numbered list"
          title="Numbered list"
          aria-pressed={active?.orderedList ?? false}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <span aria-hidden="true">1.</span>
        </button>
        <button
          type="button"
          aria-label={active?.link ? "Remove link" : "Add link"}
          title={active?.link ? "Remove link" : "Add link"}
          aria-pressed={active?.link ?? false}
          onClick={editLink}
        >
          <span aria-hidden="true">Link</span>
        </button>
        <button
          type="button"
          aria-label="Epigraph"
          title="Epigraph"
          aria-pressed={active?.epigraph ?? false}
          onClick={() => editor.chain().focus().toggleEpigraph().run()}
        >
          <span aria-hidden="true">E</span>
        </button>
        <button
          type="button"
          aria-label="Block quote"
          title="Block quote"
          aria-pressed={active?.blockquote ?? false}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <span aria-hidden="true">❞</span>
        </button>
        <button
          type="button"
          aria-label="Insert scene break"
          title="Insert scene break"
          onClick={() => editor.chain().focus().insertSceneBreak().run()}
        >
          <span aria-hidden="true">✧</span>
        </button>
        <button
          type="button"
          aria-label="Undo"
          title="Undo (Ctrl/⌘+Z)"
          onClick={() => editor.chain().focus().undo()}
          disabled={!active?.canUndo}
        >
          <span aria-hidden="true">↶</span>
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo (Ctrl/⌘+Y)"
          onClick={() => editor.chain().focus().redo()}
          disabled={!active?.canRedo}
        >
          <span aria-hidden="true">↷</span>
        </button>
      </fieldset>
      {linkError && (
        <p className="editor-toolbar-error" role="alert">
          {linkError}
        </p>
      )}
      <div className="editor-document">
        {title && (
          <header className="manuscript-title">
            <p>{chapterLabel}</p>
            <h2>{title}</h2>
          </header>
        )}
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}
