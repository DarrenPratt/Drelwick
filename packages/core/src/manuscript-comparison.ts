import { setImmediate } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { decodeEditorialDocument } from "@drelwick/project-model";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  ApplicationError,
  type ComparisonSourceToken,
  type ComparisonDiagnostic,
  type ComparisonV1,
  type ComparisonChange,
  type ComparisonLocation,
  type ComparisonValue,
} from "@drelwick/shared";

/** Transient input, built only from validated saved sources; never persisted. */
export interface ComparisonInput {
  source: ComparisonSourceToken;
  chapters: {
    id: string;
    title: string;
    status: string;
    document: Record<string, unknown>;
  }[];
  metadata: Record<string, unknown>;
  assets: Record<string, string | null>;
}
export const COMPARISON_LIMITS = Object.freeze({
  chapters: 10_000,
  semanticBytes: 256 * 1024 ** 2,
  tokens: 1_000_000,
  expansions: 10_000_000,
  changes: 100_000,
});
export interface ComparisonOptions {
  signal?: AbortSignal;
  authorized?: () => boolean;
  // Lower ceilings are useful to callers/tests; callers cannot raise policy limits.
  limits?: Partial<Record<keyof typeof COMPARISON_LIMITS, number>>;
}
class Limit extends Error {}
function cancellation(options: ComparisonOptions) {
  if (options.signal?.aborted || options.authorized?.() === false)
    throw new ApplicationError("COMPARISON_CANCELLED", "Comparison cancelled.");
}
function scheduler(options: ComparisonOptions) {
  let last = performance.now(),
    ticks = 0;
  return async (force = false) => {
    cancellation(options);
    if (force || (++ticks % 128 === 0 && performance.now() - last >= 4)) {
      await setImmediate();
      last = performance.now();
      cancellation(options);
    }
  };
}
type Token = {
  key: string;
  type: "text" | "open" | "close" | "atom";
  nodeType: string;
  location: ComparisonLocation;
  marks: unknown;
  attrs: unknown;
};
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const canonicalMarks = (node: PMNode) =>
  node.marks
    .map((mark) => mark.toJSON())
    .sort((a: { type: string }, b: { type: string }) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
    );
const metadata = (value: unknown): ComparisonValue => ({
  type: "metadata",
  value,
});

async function tokenize(
  doc: PMNode,
  limit: number,
  tick: ReturnType<typeof scheduler>,
): Promise<Token[]> {
  const tokens: Token[] = [];
  const push = (token: Token) => {
    if (tokens.length >= limit) throw new Limit();
    tokens.push(token);
  };
  const walk = async (
    node: PMNode,
    position: number,
    path: number[],
  ): Promise<void> => {
    await tick();
    if (node.isLeaf) {
      push({
        key: `atom:${node.type.name}`,
        type: "atom",
        nodeType: node.type.name,
        location: {
          nodePath: path,
          from: position,
          to: position + node.nodeSize,
        },
        marks: canonicalMarks(node),
        attrs: node.attrs,
      });
      return;
    }
    if (node.type.name !== "doc")
      push({
        key: `open:${node.type.name}`,
        type: "open",
        nodeType: node.type.name,
        location: { nodePath: path, from: position, to: position + 1 },
        marks: [],
        attrs: node.attrs,
      });
    let offset = node.type.name === "doc" ? 0 : position + 1;
    for (let i = 0; i < node.childCount;) {
      const child = node.child(i);
      if (!child.isText) {
        await walk(child, offset, [...path, i]);
        offset += child.nodeSize;
        i++;
        continue;
      }
      // Segment across adjacent marked runs so a mark boundary cannot split an emoji
      // or combining sequence. Preserve the original per-run mark information.
      const runs: {
        start: number;
        end: number;
        node: PMNode;
        path: number[];
      }[] = [];
      let text = "";
      while (i < node.childCount && node.child(i).isText) {
        const run = node.child(i);
        runs.push({
          start: text.length,
          end: text.length + run.nodeSize,
          node: run,
          path: [...path, i],
        });
        text += run.text!;
        i++;
      }
      let runIndex = 0;
      for (const part of segmenter.segment(text)) {
        await tick();
        const end = part.index + part.segment.length;
        while (runs[runIndex]!.end <= part.index) runIndex++;
        const marks: unknown[] = [];
        for (let j = runIndex; j < runs.length && runs[j]!.start < end; j++) {
          const run = runs[j]!;
          marks.push({
            text: text.slice(
              Math.max(run.start, part.index),
              Math.min(run.end, end),
            ),
            marks: canonicalMarks(run.node),
          });
        }
        push({
          key: `text:${part.segment}`,
          type: "text",
          nodeType: "text",
          location: {
            nodePath: runs[runIndex]!.path,
            from: offset + part.index,
            to: offset + end,
          },
          marks,
          attrs: null,
        });
      }
      offset += text.length;
    }
    if (node.type.name !== "doc")
      push({
        key: `close:${node.type.name}`,
        type: "close",
        nodeType: node.type.name,
        location: {
          nodePath: path,
          from: position + node.nodeSize - 1,
          to: position + node.nodeSize,
        },
        marks: [],
        attrs: null,
      });
  };
  await walk(doc, 0, []);
  return tokens;
}

type Edit = { kind: "equal" | "delete" | "insert"; old: number; next: number };
/** Myers SES. Equal frontiers prefer deletion; all loops share the cooperative budget. */
async function myers(
  a: Token[],
  b: Token[],
  limit: number,
  tick: ReturnType<typeof scheduler>,
): Promise<Edit[]> {
  const trace: Int32Array[] = [];
  let expansions = 0;
  const get = (v: Int32Array | undefined, d: number, k: number) =>
    v && Math.abs(k) <= d ? v[k + d]! : -1;
  for (let d = 0; d <= a.length + b.length; d++) {
    const v = new Int32Array(2 * d + 1).fill(-1);
    for (let k = -d; k <= d; k += 2) {
      if (++expansions > limit) throw new Limit();
      await tick();
      const previous = trace[d - 1];
      let x =
        d === 0
          ? 0
          : k === -d ||
              (k !== d &&
                get(previous, d - 1, k - 1) < get(previous, d - 1, k + 1))
            ? get(previous, d - 1, k + 1)
            : get(previous, d - 1, k - 1) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x]!.key === b[y]!.key) {
        if (++expansions > limit) throw new Limit();
        await tick();
        x++;
        y++;
      }
      v[k + d] = x;
      if (x >= a.length && y >= b.length) {
        const edits: Edit[] = [];
        for (let depth = d; depth > 0; depth--) {
          await tick();
          const oldK = x - y,
            prev = trace[depth - 1];
          const prevK =
            oldK === -depth ||
            (oldK !== depth &&
              get(prev, depth - 1, oldK - 1) < get(prev, depth - 1, oldK + 1))
              ? oldK + 1
              : oldK - 1;
          const prevX = get(prev, depth - 1, prevK),
            prevY = prevX - prevK;
          while (x > prevX && y > prevY) {
            await tick();
            edits.push({ kind: "equal", old: --x, next: --y });
          }
          if (x === prevX) edits.push({ kind: "insert", old: x, next: --y });
          else edits.push({ kind: "delete", old: --x, next: y });
        }
        while (x > 0 && y > 0) {
          await tick();
          edits.push({ kind: "equal", old: --x, next: --y });
        }
        return edits.reverse();
      }
    }
    trace.push(v);
  }
  throw new Limit();
}
function location(
  tokens: Token[],
  start: number,
  end: number,
  doc: PMNode,
): ComparisonLocation {
  const first = tokens[start];
  const from = first?.location.from ?? doc.content.size;
  return {
    nodePath: first?.location.nodePath ?? [],
    from,
    to: end > start ? tokens[end - 1]!.location.to : from,
  };
}
function slice(doc: PMNode, loc: ComparisonLocation): ComparisonValue {
  const value = doc.slice(loc.from, loc.to);
  return {
    type: "slice",
    value: {
      content: value.content.toJSON() ?? [],
      openStart: value.openStart,
      openEnd: value.openEnd,
    },
  };
}

export async function compareSnapshots(
  left: ComparisonInput,
  right: ComparisonInput,
  options: ComparisonOptions = {},
): Promise<ComparisonV1> {
  const tick = scheduler(options);
  const limits = Object.fromEntries(
    Object.entries(COMPARISON_LIMITS).map(([key, value]) => {
      const requested = options.limits?.[key as keyof typeof COMPARISON_LIMITS];
      return [
        key,
        requested !== undefined &&
        Number.isSafeInteger(requested) &&
        requested >= 0
          ? Math.min(value, requested)
          : value,
      ];
    }),
  ) as unknown as typeof COMPARISON_LIMITS;
  const result: ComparisonV1 = {
    schemaVersion: 1,
    algorithm: "semantic-grapheme-v1",
    left: left.source,
    right: right.source,
    complete: true,
    changes: [],
    diagnostics: [],
    chapters: [],
  };
  const diagnostic = (
    source: "left" | "right",
    code: ComparisonDiagnostic["code"],
    chapterId: string | null = null,
    assetId: string | null = null,
  ) => {
    result.complete = false;
    result.diagnostics.push({ source, code, chapterId, assetId });
  };
  const add = (change: Omit<ComparisonChange, "ordinal">) => {
    if (result.changes.length >= limits.changes) throw new Limit();
    result.changes.push({ ordinal: result.changes.length, ...change });
  };
  const meta = (
    kind: ComparisonChange["kind"],
    chapterId: string | null,
    before: unknown,
    after: unknown,
  ) =>
    add({
      kind,
      chapterId,
      oldLocation: null,
      newLocation: null,
      before: metadata(before),
      after: metadata(after),
    });
  await tick(true);
  if (left.source.projectId !== right.source.projectId) {
    diagnostic("right", "INVALID_SOURCE");
    return result;
  }
  for (const [side, input] of [
    ["left", left],
    ["right", right],
  ] as const) {
    if (
      input.chapters.length > limits.chapters ||
      Buffer.byteLength(JSON.stringify(input.chapters)) +
        Buffer.byteLength(JSON.stringify(input.metadata)) >
        limits.semanticBytes
    )
      diagnostic(side, "LIMIT");
    if (new Set(input.chapters.map((c) => c.id)).size !== input.chapters.length)
      diagnostic(side, "INVALID_SOURCE");
  }
  if (!result.complete) return result;
  const oldMap = new Map(
    left.chapters.map((c, index) => [c.id, { ...c, index }]),
  );
  const newMap = new Map(
    right.chapters.map((c, index) => [c.id, { ...c, index }]),
  );
  const invalid = new Set<string>();
  for (const [side, input] of [
    ["left", left],
    ["right", right],
  ] as const) {
    for (const chapter of input.chapters) {
      await tick();
      try {
        decodeEditorialDocument(chapter.document);
      } catch {
        diagnostic(side, "INVALID_SOURCE", chapter.id);
        invalid.add(chapter.id);
      }
    }
  }
  result.chapters = [
    ...right.chapters,
    ...left.chapters.filter((c) => !newMap.has(c.id)),
  ].map((c) => ({ id: c.id, title: c.title }));
  try {
    if (!equal(left.metadata, right.metadata))
      meta("metadata", null, left.metadata, right.metadata);
    for (const [side, chapters, other] of [
      ["right", right.chapters, oldMap],
      ["left", left.chapters, newMap],
    ] as const) {
      for (const chapter of chapters.filter((c) => !other.has(c.id))) {
        if (invalid.has(chapter.id)) continue;
        try {
          await tokenize(
            decodeEditorialDocument(chapter.document),
            limits.tokens,
            tick,
          );
        } catch (error) {
          cancellation(options);
          diagnostic(
            side,
            error instanceof Limit ? "LIMIT" : "INVALID_SOURCE",
            chapter.id,
          );
          continue;
        }
        if (side === "right") meta("chapter-added", chapter.id, null, chapter);
        else meta("chapter-removed", chapter.id, chapter, null);
      }
    }
    const survivingOld = new Map(
      left.chapters.filter((c) => newMap.has(c.id)).map((c, i) => [c.id, i]),
    );
    const survivingNew = new Map(
      right.chapters.filter((c) => oldMap.has(c.id)).map((c, i) => [c.id, i]),
    );
    for (const chapter of right.chapters) {
      await tick();
      const old = oldMap.get(chapter.id);
      if (!old || invalid.has(chapter.id)) continue;
      if (survivingOld.get(chapter.id) !== survivingNew.get(chapter.id))
        meta(
          "chapter-moved",
          chapter.id,
          old.index,
          newMap.get(chapter.id)!.index,
        );
      if (old.title !== chapter.title)
        meta("title", chapter.id, old.title, chapter.title);
      if (old.status !== chapter.status)
        meta("status", chapter.id, old.status, chapter.status);
      const start = result.changes.length;
      try {
        const before = decodeEditorialDocument(old.document),
          after = decodeEditorialDocument(chapter.document);
        const a = await tokenize(before, limits.tokens, tick),
          b = await tokenize(after, limits.tokens, tick);
        const edits = await myers(a, b, limits.expansions, tick);
        // Group adjacent changed tokens into a single readable hunk or mark run.
        for (let i = 0; i < edits.length;) {
          await tick();
          const edit = edits[i]!;
          if (edit.kind === "equal") {
            const x = a[edit.old]!,
              y = b[edit.next]!;
            const mark = !equal(x.marks, y.marks),
              attr = !equal(x.attrs, y.attrs);
            if (!mark && !attr) {
              i++;
              continue;
            }
            let end = i + 1;
            if (mark && !attr)
              while (
                end < edits.length &&
                edits[end]!.kind === "equal" &&
                !equal(a[edits[end]!.old]!.marks, b[edits[end]!.next]!.marks) &&
                equal(a[edits[end]!.old]!.attrs, b[edits[end]!.next]!.attrs)
              ) {
                await tick();
                end++;
              }
            const last = edits[end - 1]!;
            const oldLocation = location(a, edit.old, last.old + 1, before),
              newLocation = location(b, edit.next, last.next + 1, after);
            add({
              kind: attr
                ? x.nodeType === "image"
                  ? "asset-change"
                  : "attribute-change"
                : "mark-change",
              chapterId: chapter.id,
              oldLocation,
              newLocation,
              before: slice(before, oldLocation),
              after: slice(after, newLocation),
            });
            i = end;
          } else {
            let end = i,
              oldEnd = edit.old,
              newEnd = edit.next;
            let structural = false;
            while (end < edits.length && edits[end]!.kind !== "equal") {
              await tick();
              const item = edits[end++]!;
              if (item.kind === "delete") {
                oldEnd = item.old + 1;
                structural ||= a[item.old]!.type !== "text";
              }
              if (item.kind === "insert") {
                newEnd = item.next + 1;
                structural ||= b[item.next]!.type !== "text";
              }
            }
            const oldLocation = location(a, edit.old, oldEnd, before),
              newLocation = location(b, edit.next, newEnd, after);
            add({
              kind: structural
                ? "node-change"
                : oldEnd === edit.old
                  ? "text-insert"
                  : newEnd === edit.next
                    ? "text-delete"
                    : "text-replace",
              chapterId: chapter.id,
              oldLocation,
              newLocation,
              before: slice(before, oldLocation),
              after: slice(after, newLocation),
            });
            i = end;
          }
        }
      } catch (error) {
        cancellation(options);
        result.changes.splice(start);
        diagnostic(
          "right",
          error instanceof Limit ? "LIMIT" : "INVALID_SOURCE",
          chapter.id,
        );
      }
    }
    const assetIds = [
      ...new Set([...Object.keys(left.assets), ...Object.keys(right.assets)]),
    ].sort();
    for (const id of assetIds) {
      await tick();
      for (const [side, input] of [
        ["left", left],
        ["right", right],
      ] as const)
        if (id in input.assets && input.assets[id] === null)
          diagnostic(side, "MISSING_ASSET", null, id);
      if (
        left.assets[id] !== null &&
        right.assets[id] !== null &&
        left.assets[id] !== right.assets[id]
      )
        meta(
          "asset-change",
          null,
          { assetId: id, hash: left.assets[id] ?? null },
          { assetId: id, hash: right.assets[id] ?? null },
        );
    }
  } catch (error) {
    cancellation(options);
    if (!(error instanceof Limit)) throw error;
    diagnostic("right", "LIMIT");
  }
  return result;
}
