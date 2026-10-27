import { ManuscriptDocumentSchema } from "@drelwick/project-model";

export interface SearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
}
export interface SearchMatch {
  chapterId: string;
  /** ProseMirror UTF-16 positions, ready for editor selection. */
  from: number;
  to: number;
  blockPath: number[];
  start: number;
  end: number;
}
interface Node {
  type: string;
  text?: string;
  content?: Node[];
  marks?: unknown[];
  [key: string]: unknown;
}
interface Run {
  path: number[];
  text: string;
  from: number;
  offset: number;
}

/** Shared semantic extraction; global search keeps the same structural boundaries. */
export function manuscriptSearchRuns(document: Record<string, unknown>): Run[] {
  return runs(validated(document));
}

function validated(document: Record<string, unknown>): Node {
  const result = ManuscriptDocumentSchema.safeParse(document);
  if (!result.success) throw new Error("Invalid manuscript search document.");
  return result.data as Node;
}

function runs(document: Node): Run[] {
  const result: Run[] = [];
  function visit(node: Node, position: number, path: number[]): number {
    if (node.type === "text") return node.text!.length;
    if (!node.content)
      return node.type === "doc"
        ? 0
        : ["paragraph", "heading", "codeBlock"].includes(node.type)
          ? 2
          : 1;
    let cursor = position + (node.type === "doc" ? 0 : 1);
    let run: Run | undefined;
    let offset = 0;
    node.content.forEach((child, index) => {
      if (child.type === "text") {
        if (!run) {
          run = { path, text: "", from: cursor, offset };
          result.push(run);
        }
        run.text += child.text!;
      } else run = undefined;
      const size = visit(child, cursor, [...path, index]);
      cursor += size;
      offset += size;
    });
    return cursor - position + (node.type === "doc" ? 0 : 1);
  }
  visit(document, 0, []);
  return result;
}

const wordCharacter = /[\p{L}\p{M}\p{N}\p{Pc}]/u;
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Shared literal matching policy. Offsets are UTF-16; input is never normalized. */
export function* literalSearchMatches(
  text: string,
  options: SearchOptions,
): Generator<{ start: number; end: number }> {
  if (!options.query) return;
  const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(escaped, options.matchCase ? "gu" : "giu");
  // Most paragraphs do not match. Avoid segmenting them just to prove absence.
  if (!expression.test(text)) return;
  expression.lastIndex = 0;
  const boundaries = new Set<number>();
  for (const segment of graphemes.segment(text)) boundaries.add(segment.index);
  boundaries.add(text.length);
  for (const match of text.matchAll(expression)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!boundaries.has(start) || !boundaries.has(end)) continue;
    if (options.wholeWord) {
      const before =
        [...text.slice(Math.max(0, start - 2), start)].at(-1) ?? "";
      const after = String.fromCodePoint(text.codePointAt(end) ?? 0);
      if (wordCharacter.test(before) || wordCharacter.test(after)) continue;
    }
    yield { start, end };
  }
}

/** Literal, non-overlapping matches; no normalization or locale-dependent fold. */
export function searchChapter(
  chapterId: string,
  document: Record<string, unknown>,
  options: SearchOptions,
): SearchMatch[] {
  const root = validated(document);
  if (!options.query) return [];
  const matches: SearchMatch[] = [];
  for (const run of runs(root)) {
    for (const { start, end } of literalSearchMatches(run.text, options)) {
      matches.push({
        chapterId,
        from: run.from + start,
        to: run.from + end,
        blockPath: run.path,
        start: run.offset + start,
        end: run.offset + end,
      });
    }
  }
  return matches;
}

export function searchManuscript(
  chapters: { id: string; content: Record<string, unknown> }[],
  options: SearchOptions,
): SearchMatch[] {
  return chapters.flatMap((chapter) =>
    searchChapter(chapter.id, chapter.content, options),
  );
}

/** Recompute and validate every supplied match before editing a cloned tree. */
export function replaceMatches(
  chapterId: string,
  document: Record<string, unknown>,
  options: SearchOptions,
  matches: SearchMatch[],
  replacement: string,
): Record<string, unknown> {
  const available = new Set(
    searchChapter(chapterId, document, options).map((match) =>
      JSON.stringify(match),
    ),
  );
  const keys = matches.map((match) => JSON.stringify(match));
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !available.has(key))
  )
    throw new Error("Search results changed. Search again before replacing.");
  const root = validated(document);
  const originalRuns = runs(root);
  for (const match of [...matches].sort((a, b) => b.from - a.from)) {
    const run = originalRuns.find(
      (run) => run.from <= match.from && run.from + run.text.length >= match.to,
    );
    if (
      run?.text.slice(match.from - run.from, match.to - run.from) ===
      replacement
    )
      continue;
    let block = root;
    for (const index of match.blockPath) block = block.content![index]!;
    let offset = 0;
    let inserted = false;
    block.content = block.content!.flatMap((node): Node[] => {
      const start = offset;
      offset += node.type === "text" ? node.text!.length : 1;
      if (offset <= match.start || start >= match.end) return [node];
      if (node.type !== "text") throw new Error("Invalid search range.");
      const parts: Node[] = [];
      const prefix = node.text!.slice(0, Math.max(0, match.start - start));
      const suffix = node.text!.slice(Math.max(0, match.end - start));
      if (prefix) parts.push({ ...node, text: prefix });
      if (!inserted) {
        if (replacement) parts.push({ ...node, text: replacement });
        inserted = true;
      }
      if (suffix) parts.push({ ...node, text: suffix });
      return parts;
    });
  }
  return validated(root);
}
