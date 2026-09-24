import {
  isSupportedManuscriptLink,
  MANUSCRIPT_HEADING_LEVELS,
  IMAGE_SIZES,
} from "@drelwick/project-model";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { JSONContent, Editor as TipTapEditor } from "@tiptap/core";
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
  if (element.tagName === "IMG")
    return escapeHtml(
      `[Image omitted${element.getAttribute("alt") ? `: ${element.getAttribute("alt")}` : ""}; use Insert image]`,
    );
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
  // Template content is inert: even detached <img> elements in an ordinary div
  // can start network requests before sanitization has removed their URLs.
  const container = document.createElement("template");
  container.innerHTML = html;
  return Array.from(container.content.childNodes).map(sanitizeNode).join("");
}

interface EditorProps {
  onReady?(editor: TipTapEditor | null): void;
  projectId?: string;
  chapterId?: string;
  prepareImageImport?(): Promise<boolean>;
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
  projectId,
  chapterId,
  prepareImageImport,
  onReady,
}: EditorProps) {
  const [linkError, setLinkError] = useState<string>();
  const [imageError, setImageError] = useState<string>();
  const [importing, setImporting] = useState(false);
  const editor = useEditor({
    extensions: createManuscriptExtensions(projectId),
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        if (event.dataTransfer?.files.length) {
          setImageError(
            "Use Insert image to copy a local PNG or JPEG into the project.",
          );
          return true;
        }
        const html = event.dataTransfer?.getData("text/html");
        if (!html) return false;
        const container = document.createElement("div");
        container.innerHTML = sanitizePastedHtml(html);
        const slice = ProseMirrorDOMParser.fromSchema(
          view.state.schema,
        ).parseSlice(container, { preserveWhitespace: true });
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
      handlePaste: (view, event) => {
        if (event.clipboardData?.files.length)
          setImageError("Use Insert image to import local image files.");
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
      image: current?.isActive("image") ?? false,
      imageAlt: String(current?.getAttributes("image").alt ?? ""),
      imageSize: String(current?.getAttributes("image").size ?? "medium"),
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
    editor?.setEditable(editable && !importing, false);
  }, [editor, editable, importing]);

  // Consumers may focus the editor here. Initialise content and editability
  // first so setContent cannot replace their requested cursor position.
  useEffect(() => {
    onReady?.(editor);
    return () => onReady?.(null);
  }, [editor, onReady]);

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

  async function importImage(replace: boolean) {
    if (!editor || !projectId || !chapterId || importing) return;
    setImageError(undefined);
    const before = editor.state.doc;
    const selection = editor.state.selection;
    setImporting(true);
    try {
      if (prepareImageImport && !(await prepareImageImport())) {
        setImageError(
          "Save the current chapter successfully before importing an image. Your edits remain available.",
        );
        return;
      }
      if (editor.isDestroyed) return;
      const result = await window.drelwick.dialog.selectImage({
        projectId,
        chapterId,
      });
      if (editor.isDestroyed) return;
      if (!result.ok) {
        setImageError(result.error.message);
        return;
      }
      if (!result.value) return;
      if (editor.state.doc !== before) {
        setImageError(
          "The chapter changed during import. The imported asset was retained; retry inserting the image.",
        );
        return;
      }
      editor.commands.command(({ tr }) => {
        tr.setSelection(selection);
        return true;
      });
      const ok = replace
        ? editor
            .chain()
            .focus()
            .updateAttributes("image", { assetId: result.value.assetId })
            .run()
        : editor
            .chain()
            .focus()
            .insertContent({
              type: "image",
              attrs: { assetId: result.value.assetId, alt: "", size: "medium" },
            })
            .run();
      if (!ok)
        setImageError(
          "The image was imported but could not be inserted here. Choose a paragraph and retry.",
        );
    } catch {
      if (!editor.isDestroyed)
        setImageError(
          "Unable to import the image. The previous document was retained.",
        );
    } finally {
      if (!editor.isDestroyed) setImporting(false);
    }
  }

  return (
    <section className="editor-panel" aria-label="Chapter editor">
      <fieldset
        disabled={!editable || importing}
        className="editor-toolbar"
        role="toolbar"
        aria-label="Formatting"
        aria-orientation="horizontal"
      >
        <span className="toolbar-label">Text</span>
        <button
          type="button"
          disabled={!projectId || !chapterId}
          onClick={() => void importImage(false)}
        >
          Insert image
        </button>
        {active?.image && (
          <>
            <button
              type="button"
              disabled={!projectId || !chapterId}
              onClick={() => void importImage(true)}
            >
              Replace image
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteSelection().run()}
            >
              Remove image
            </button>
            <label>
              Alternative text
              <input
                aria-label="Alternative text"
                maxLength={4000}
                value={active.imageAlt}
                onChange={(event) =>
                  editor.commands.updateAttributes("image", {
                    alt: event.currentTarget.value,
                  })
                }
              />
            </label>
            <label>
              Image size
              <select
                aria-label="Image size"
                value={active.imageSize}
                onChange={(event) =>
                  editor.commands.updateAttributes("image", {
                    size: event.currentTarget.value,
                  })
                }
              >
                {IMAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
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
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!active?.canUndo}
        >
          <span aria-hidden="true">↶</span>
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo (Ctrl/⌘+Y)"
          onClick={() => editor.chain().focus().redo().run()}
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
      {importing && <p role="status">Importing image…</p>}
      {imageError && <p role="alert">{imageError}</p>}
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
