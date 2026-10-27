import {
  GLOBAL_SEARCH_LIMITS,
  type GlobalSearchEntry,
  type GlobalSearchHit,
  type GlobalSearchSnapshot,
  type ReferenceRecord,
  type ReferenceTarget,
} from "@drelwick/shared";
import {
  literalSearchMatches,
  manuscriptSearchRuns,
  type SearchOptions,
} from "./manuscript-search.js";

export function compareSearchText(a: string, b: string): number {
  const left = a[Symbol.iterator](),
    right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next(),
      y = right.next();
    if (x.done || y.done) return Number(!x.done) - Number(!y.done);
    const difference = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (difference) return difference;
  }
}

export function chapterSearchEntry(
  chapter: { id: string; title: string; content: Record<string, unknown> },
  fingerprint: string,
): GlobalSearchEntry {
  return {
    kind: "chapter",
    id: chapter.id,
    title: chapter.title,
    fingerprint,
    fields: [
      { name: "title", text: chapter.title },
      ...manuscriptSearchRuns(chapter.content).map((run, index) => ({
        name: `text · passage ${index + 1}`,
        text: run.text,
        from: run.from,
      })),
    ],
  };
}

const searchable = new Set([
  "name",
  "title",
  "aliases",
  "tags",
  "role",
  "description",
  "appearance",
  "personality",
  "background",
  "notes",
  "type",
  "category",
  "statement",
  "date",
  "body",
  "source",
]);
export function referenceSearchEntry(
  record: ReferenceRecord,
  fingerprint: string,
): GlobalSearchEntry {
  return {
    kind: record.kind,
    id: record.id,
    title: "name" in record ? record.name : record.title,
    fingerprint,
    fields: Object.entries(record)
      .filter(([key]) => searchable.has(key))
      .sort(([a], [b]) => compareSearchText(a, b))
      .flatMap(([name, value]) =>
        typeof value === "string"
          ? [{ name, text: value }]
          : Array.isArray(value)
            ? value.flatMap((text, index) =>
                typeof text === "string"
                  ? [
                      {
                        name: `${name}[${index + 1}]`,
                        text,
                      },
                    ]
                  : [],
              )
            : [],
      ),
  };
}

/** Reject an entire oversize record, never fabricate a truncated field match. */
export class GlobalSearchIndex {
  private entries: GlobalSearchEntry[] = [];
  private characters = 0;
  private fields = 0;
  incomplete = false;

  add(entry: GlobalSearchEntry): void {
    const size = entry.fields.reduce(
      (sum, field) => sum + field.text.length,
      0,
    );
    if (
      this.entries.length >= GLOBAL_SEARCH_LIMITS.records ||
      this.fields + entry.fields.length > GLOBAL_SEARCH_LIMITS.fields ||
      this.characters + size > GLOBAL_SEARCH_LIMITS.characters ||
      entry.fields.some(
        (field) => field.text.length > GLOBAL_SEARCH_LIMITS.fieldCharacters,
      )
    ) {
      this.incomplete = true;
      return;
    }
    this.entries.push(entry);
    this.characters += size;
    this.fields += entry.fields.length;
  }

  snapshot(): GlobalSearchSnapshot {
    return {
      entries: this.entries
        .slice()
        .sort(
          (a, b) =>
            compareSearchText(a.kind, b.kind) ||
            compareSearchText(a.title, b.title) ||
            compareSearchText(a.id, b.id),
        ),
      incomplete: this.incomplete,
    };
  }
}

export interface GlobalSearchOptions extends SearchOptions {
  kinds: ReferenceTarget["kind"][];
}
export async function searchGlobalIndex(
  snapshot: GlobalSearchSnapshot,
  options: GlobalSearchOptions,
  signal: AbortSignal,
  yieldWork: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<{ hits: GlobalSearchHit[]; limited: boolean }> {
  if (options.query.length > GLOBAL_SEARCH_LIMITS.queryCharacters)
    throw new Error("Search query is too long.");
  signal.throwIfAborted();
  const hits: GlobalSearchHit[] = [];
  if (!options.query) return { hits, limited: false };
  let work = 0;
  for (const entry of snapshot.entries) {
    if (options.kinds.length && !options.kinds.includes(entry.kind)) continue;
    for (let fieldIndex = 0; fieldIndex < entry.fields.length; fieldIndex++) {
      const field = entry.fields[fieldIndex]!;
      // Yield by bounded text work, including fields without any matches.
      if (work >= 65_536) {
        await yieldWork();
        signal.throwIfAborted();
        work = 0;
      }
      work += field.text.length + 256;
      for (const { start, end } of literalSearchMatches(field.text, options)) {
        signal.throwIfAborted();
        if (hits.length === GLOBAL_SEARCH_LIMITS.hits)
          return { hits, limited: true };
        hits.push({
          kind: entry.kind,
          id: entry.id,
          title: entry.title,
          fingerprint: entry.fingerprint,
          field: field.name,
          fieldIndex,
          start,
          end,
          context: field.text.slice(
            Math.max(0, start - 60),
            Math.min(field.text.length, end + 60),
          ),
          ...(field.from === undefined
            ? {}
            : { from: field.from + start, to: field.from + end }),
        });
      }
    }
  }
  return { hits, limited: false };
}

/** Exact identity and source revision are required before using any saved range. */
export function resolveGlobalSearchHit(
  entry: GlobalSearchEntry,
  hit: GlobalSearchHit,
): boolean {
  const field = entry.fields[hit.fieldIndex];
  return (
    entry.kind === hit.kind &&
    entry.id === hit.id &&
    entry.fingerprint === hit.fingerprint &&
    field?.name === hit.field &&
    hit.start >= 0 &&
    hit.end > hit.start &&
    hit.end <= field.text.length &&
    (field.from === undefined
      ? hit.from === undefined && hit.to === undefined
      : hit.from === field.from + hit.start && hit.to === field.from + hit.end)
  );
}
