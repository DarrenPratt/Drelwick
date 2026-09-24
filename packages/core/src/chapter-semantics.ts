import { ManuscriptDocumentSchema } from "@drelwick/project-model";

interface Node {
  type: string;
  text?: string;
  content?: Node[];
  [key: string]: unknown;
}
const textblocks = new Set(["paragraph", "heading", "codeBlock"]);
const invalid = () =>
  new Error(
    "Choose a cursor boundary with content on both sides. This structural boundary cannot be split safely.",
  );

/** ProseMirror positions count UTF-16 text, one for atoms and two for containers. */
function size(node: Node): number {
  if (node.type === "text") return node.text!.length;
  if (node.content || textblocks.has(node.type))
    return (
      2 + (node.content ?? []).reduce((sum, child) => sum + size(child), 0)
    );
  return 1;
}
function meaningful(node: Node): boolean {
  return (
    Boolean(node.text?.length) ||
    ["image", "sceneBreak", "horizontalRule", "hardBreak"].includes(
      node.type,
    ) ||
    (node.content ?? []).some(meaningful)
  );
}

/** Split a validated tree at the actual editor position, retaining ancestor/mark attributes. */
export function splitChapterDocument(
  document: Record<string, unknown>,
  position: number,
): [Record<string, unknown>, Record<string, unknown>] {
  const parsed = ManuscriptDocumentSchema.safeParse(document);
  if (!parsed.success || !Number.isSafeInteger(position)) throw invalid();
  const root = parsed.data as Node;
  function cut(children: Node[], offset: number): [Node[], Node[]] {
    const left: Node[] = [];
    const right: Node[] = [];
    let cursor = 0;
    for (const node of children) {
      const end = cursor + size(node);
      if (end <= offset) left.push(node);
      else if (cursor >= offset) right.push(node);
      else if (node.type === "text") {
        const at = offset - cursor;
        const boundaries = new Set(
          [
            ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(
              node.text!,
            ),
          ].map((segment) => segment.index),
        );
        if (!boundaries.has(at)) throw invalid();
        left.push({ ...node, text: node.text!.slice(0, at) });
        right.push({ ...node, text: node.text!.slice(at) });
      } else if (node.content || textblocks.has(node.type)) {
        if (textblocks.has(node.type)) {
          // Graphemes can span adjacent text nodes with different marks.
          const inline = node.content ?? [];
          let start = 0;
          let run = "";
          const at = offset - cursor - 1;
          const check = () => {
            if (
              at > start &&
              at < start + run.length &&
              ![
                ...new Intl.Segmenter("und", {
                  granularity: "grapheme",
                }).segment(run),
              ].some((segment) => segment.index === at - start)
            )
              throw invalid();
          };
          for (const child of inline) {
            if (child.type === "text") run += child.text!;
            else {
              check();
              start += run.length + size(child);
              run = "";
            }
          }
          check();
        }
        const [before, after] = cut(node.content ?? [], offset - cursor - 1);
        if (before.length) left.push({ ...node, content: before });
        if (after.length) right.push({ ...node, content: after });
      } else throw invalid();
      cursor = end;
    }
    if (offset < 0 || offset > cursor) throw invalid();
    return [left, right];
  }
  const [left, right] = cut(root.content ?? [], position);
  const first = { type: "doc", content: left };
  const second = { type: "doc", content: right };
  if (
    !left.some(meaningful) ||
    !right.some(meaningful) ||
    !ManuscriptDocumentSchema.safeParse(first).success ||
    !ManuscriptDocumentSchema.safeParse(second).success
  )
    throw invalid();
  return [first, second];
}

export function mergeChapterDocuments(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
): Record<string, unknown> {
  const a = ManuscriptDocumentSchema.parse(first);
  const b = ManuscriptDocumentSchema.parse(second);
  return ManuscriptDocumentSchema.parse({
    type: "doc",
    content: [...(a.content ?? []), ...(b.content ?? [])],
  });
}
