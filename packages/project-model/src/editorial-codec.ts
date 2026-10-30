/// <reference lib="dom" preserve="true" />
import {
  Schema,
  Slice,
  Fragment,
  type ContentMatch,
  type Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { parseReferenceJson } from "./reference.js";
import { ManuscriptDocumentSchema } from "./manuscript-document.js";

/** DOM-free persisted vocabulary. Keep ranks/defaults aligned with the pinned editor. */
export const editorialManuscriptSchema = new Schema({
  nodes: {
    paragraph: { content: "inline*", group: "block" },
    blockquote: { content: "block+", group: "block", defining: true },
    bulletList: { content: "listItem+", group: "block list" },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    doc: { content: "block*" },
    hardBreak: { inline: true, group: "inline", selectable: false },
    heading: {
      content: "inline*",
      group: "block",
      defining: true,
      attrs: { level: { default: 1 } },
    },
    horizontalRule: { group: "block" },
    listItem: { content: "paragraph block*", defining: true },
    orderedList: {
      content: "listItem+",
      group: "block list",
      attrs: { start: { default: 1 }, type: { default: null } },
    },
    text: { group: "inline" },
    sceneBreak: { group: "block", atom: true, isolating: true },
    epigraph: {
      content: "paragraph+",
      group: "block",
      defining: true,
      attrs: { attribution: { default: null } },
    },
    image: {
      group: "block",
      atom: true,
      draggable: true,
      attrs: {
        assetId: { default: "" },
        alt: { default: "" },
        size: { default: "medium" },
      },
    },
  },
  marks: {
    link: {
      attrs: {
        href: { default: null },
        target: { default: "_blank" },
        rel: { default: "noopener noreferrer nofollow" },
        class: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
    bold: {},
    code: { excludes: "_", code: true },
    italic: {},
    strike: {},
    underline: {},
  },
});

function validStrings(value: unknown): boolean {
  if (typeof value === "string")
    return (
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        value,
      ) && !value.includes("\0")
    );
  if (Array.isArray(value)) return value.every(validStrings);
  if (value && typeof value === "object")
    return Object.values(value).every(validStrings);
  return true;
}

export function decodeEditorialDocument(value: unknown): ProseMirrorNode {
  const parsed = ManuscriptDocumentSchema.safeParse(value);
  if (!parsed.success || !validStrings(value))
    throw new Error("EDITORIAL_DOCUMENT_INVALID");
  const node = editorialManuscriptSchema.nodeFromJSON(value);
  node.check();
  return node;
}

export function decodeEditorialSlice(value: unknown): Slice {
  if (!value || typeof value !== "object" || !validStrings(value))
    throw new Error("EDITORIAL_SLICE_INVALID");
  const raw = value as {
    content?: unknown;
    openStart?: unknown;
    openEnd?: unknown;
  };
  if (!Array.isArray(raw.content)) throw new Error("EDITORIAL_SLICE_INVALID");
  // Validate names, attributes, marks and child grammar before ProseMirror can
  // discard unknown fields. Open slices may start with inline or listItem nodes.
  const validateNode = (item: unknown): void => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("EDITORIAL_SLICE_INVALID");
    const record = item as Record<string, unknown>;
    const type = record["type"];
    if (typeof type !== "string" || type === "doc")
      throw new Error("EDITORIAL_SLICE_INVALID");
    const nodeType = editorialManuscriptSchema.nodes[type];
    if (!nodeType) throw new Error("EDITORIAL_SLICE_INVALID");
    let shape = record;
    if (!nodeType.isLeaf) {
      const filler = nodeType.createAndFill();
      if (!filler) throw new Error("EDITORIAL_SLICE_INVALID");
      shape = { ...record, content: filler.toJSON().content ?? [] };
      if (record["content"] !== undefined && !Array.isArray(record["content"]))
        throw new Error("EDITORIAL_SLICE_INVALID");
      for (const child of (record["content"] ?? []) as unknown[])
        validateNode(child);
    }
    const content =
      type === "text" || type === "hardBreak"
        ? [{ type: "paragraph", content: [shape] }]
        : type === "listItem"
          ? [{ type: "bulletList", content: [shape] }]
          : [shape];
    if (!ManuscriptDocumentSchema.safeParse({ type: "doc", content }).success)
      throw new Error("EDITORIAL_SLICE_INVALID");
  };
  for (const item of raw.content) validateNode(item);
  const slice = Slice.fromJSON(editorialManuscriptSchema, value);
  const depth = (side: "firstChild" | "lastChild") => {
    let node = slice.content[side];
    let result = 0;
    while (node && !node.isLeaf) {
      result++;
      node = node[side];
    }
    return result;
  };
  if (
    slice.openStart > depth("firstChild") ||
    slice.openEnd > depth("lastChild")
  )
    throw new Error("EDITORIAL_SLICE_INVALID");
  const validateContent = (
    node: ProseMirrorNode,
    left: number,
    right: number,
  ): void => {
    if (node.isLeaf) {
      if (left || right) throw new Error("EDITORIAL_SLICE_INVALID");
      return;
    }
    const starts = new Set<ContentMatch>([node.type.contentMatch]);
    if (left > 0) {
      const queue = [...starts];
      for (const match of queue)
        for (let index = 0; index < match.edgeCount; index++) {
          const next = match.edge(index).next;
          if (!starts.has(next)) {
            starts.add(next);
            queue.push(next);
          }
        }
    }
    if (
      ![...starts].some((match) => {
        const end = match.matchFragment(node.content);
        return (
          end &&
          (end.validEnd ||
            (right > 0 && end.fillBefore(Fragment.empty, true) !== null))
        );
      })
    )
      throw new Error("EDITORIAL_SLICE_INVALID");
    node.forEach((child, _offset, index) => {
      if (!node.type.allowsMarks(child.marks))
        throw new Error("EDITORIAL_SLICE_INVALID");
      validateContent(
        child,
        index === 0 ? Math.max(0, left - 1) : 0,
        index === node.childCount - 1 ? Math.max(0, right - 1) : 0,
      );
    });
  };
  slice.content.forEach((node, _offset, index) =>
    validateContent(
      node,
      index === 0 ? slice.openStart : 0,
      index === slice.content.childCount - 1 ? slice.openEnd : 0,
    ),
  );
  return slice;
}

/** Graphemes can cross adjacent text nodes whose marks differ. */
export function isEditorialDocumentBoundary(
  doc: ProseMirrorNode,
  position: number,
): boolean {
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    position > doc.content.size
  )
    return false;
  const resolved = doc.resolve(position);
  if (!resolved.parent.isTextblock) return true;
  let cursor = resolved.start();
  let run = "";
  let start = cursor;
  const check = () =>
    position <= start ||
    position >= start + run.length ||
    [
      ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(run),
    ].some((s) => start + s.index === position);
  let valid = true;
  resolved.parent.forEach((child) => {
    if (child.isText) run += child.text!;
    else {
      valid = valid && check();
      run = "";
      start = cursor + child.nodeSize;
    }
    cursor += child.nodeSize;
  });
  return valid && check();
}

/** The existing bounded strict JSON parser also protects editorial envelope keys. */
export function parseEditorialJson(source: string | Uint8Array): unknown {
  const text =
    typeof source === "string"
      ? source
      : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          source,
        );
  const value = parseReferenceJson(text);
  if (!validStrings(value)) throw new Error("EDITORIAL_JSON_INVALID");
  return value;
}
