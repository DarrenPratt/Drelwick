import { expect, it } from "vitest";
import {
  GLOBAL_SEARCH_LIMITS,
  type GlobalSearchEntry,
  type ReferenceRecord,
} from "@drelwick/shared";
import {
  GlobalSearchIndex,
  chapterSearchEntry,
  referenceSearchEntry,
  searchGlobalIndex,
  resolveGlobalSearchHit,
} from "../src/global-search.js";
import { searchChapter } from "../src/manuscript-search.js";

const fingerprint = "a".repeat(64);
const document = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const entry = (text: string, id = "one"): GlobalSearchEntry => ({
  kind: "note",
  id,
  title: id,
  fingerprint,
  fields: [{ name: "body", text }],
});
const search = (entries: GlobalSearchEntry[], query: string, extra = {}) => {
  const index = new GlobalSearchIndex();
  entries.forEach((value) => index.add(value));
  return searchGlobalIndex(
    index.snapshot(),
    { query, matchCase: false, wholeWord: false, kinds: [], ...extra },
    new AbortController().signal,
  );
};

it("matches every approved reference text field and array item, excluding metadata and links", async () => {
  const base = {
    schemaVersion: 1 as const,
    id: "id",
    projectId: "private-project",
    created: "timestamp",
    modified: "timestamp",
    revision: 1,
    deletedAt: null,
    tags: ["needle-tag"],
    links: [],
  };
  const records: ReferenceRecord[] = [
    {
      ...base,
      kind: "character",
      name: "needle-name",
      aliases: ["needle-alias", "second"],
      role: "needle-role",
      description: "needle-description",
      appearance: "needle-appearance",
      personality: "needle-personality",
      background: "needle-background",
      notes: "needle-notes",
    },
    {
      ...base,
      kind: "location",
      name: "needle-name",
      type: "needle-type",
      description: "needle-description",
      notes: "needle-notes",
    },
    {
      ...base,
      kind: "canon",
      title: "needle-title",
      statement: "needle-statement",
      category: "technology",
      notes: "needle-notes",
    },
    {
      ...base,
      kind: "timeline",
      title: "needle-title",
      date: "needle-date",
      sequence: 42,
      description: "needle-description",
      notes: "needle-notes",
    },
    {
      ...base,
      kind: "note",
      title: "needle-title",
      body: "needle-body",
      source: "needle-source",
    },
  ];
  for (const record of records) {
    const value = referenceSearchEntry(record, fingerprint);
    const expected = Object.values(record)
      .flatMap((v): unknown[] => (Array.isArray(v) ? v : [v]))
      .filter((v) => typeof v === "string" && v.includes("needle")).length;
    expect((await search([value], "needle")).hits).toHaveLength(expected);
    expect((await search([value], "private-project")).hits).toHaveLength(0);
    expect(
      (await search([value], "needle", { kinds: [record.kind] })).hits,
    ).toHaveLength(expected);
    expect(
      (await search([value], "needle", { kinds: ["chapter"] })).hits,
    ).toHaveLength(0);
  }
  expect(
    (
      await search(
        [referenceSearchEntry(records[0]!, fingerprint)],
        "alias second",
      )
    ).hits,
  ).toHaveLength(0);
  expect(
    (
      await search(
        [referenceSearchEntry(records[2]!, fingerprint)],
        "technology",
      )
    ).hits[0]?.field,
  ).toBe("category");
});

it("shares manuscript matching, marks, block boundaries and exact UTF-16 selection positions", async () => {
  const content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a quick " },
          { type: "text", text: "fox", marks: [{ type: "bold" }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "quick fox" }] },
    ],
  };
  const chapter = chapterSearchEntry(
    { id: "chapter", title: "Quick fox", content },
    fingerprint,
  );
  const hits = (await search([chapter], "quick fox")).hits;
  expect(hits[0]?.field).toBe("title");
  expect(hits.slice(1).map(({ from, to }) => ({ from, to }))).toEqual(
    searchChapter("chapter", content, {
      query: "quick fox",
      matchCase: false,
      wholeWord: false,
    }).map(({ from, to }) => ({ from, to })),
  );
  expect((await search([chapter], "foxquick")).hits).toHaveLength(0);
});

it.each([
  ["é e\u0301", "é", false, false, 1],
  ["é e\u0301", "e", false, false, 0],
  ["é e\u0301", "e\u0301", false, false, 1],
  ["Σ σ ς", "σ", false, false, 3],
  ["Σ σ ς", "σ", true, false, 1],
  ["ß ss", "ss", false, false, 1],
  ["I i İ ı", "i", false, false, 2],
  ["cat cats _cat cat-cat", "cat", false, true, 3],
  ["👩‍🚀 👩", "👩", false, false, 1],
  ["aaaa", "aa", false, false, 2],
  ["[a].* [a]", "[a].*", false, false, 1],
  ["hello", "", false, false, 0],
])(
  "uses approved Unicode policy for fixture %s / %s",
  async (text, query, matchCase, wholeWord, count) => {
    expect(
      (await search([entry(text)], query, { matchCase, wholeWord })).hits,
    ).toHaveLength(count);
    expect(
      searchChapter("chapter", document(text), { query, matchCase, wholeWord }),
    ).toHaveLength(count);
  },
);

it("orders by type, Unicode code point label, identity and field/offset, independent of insertion order", async () => {
  const entries = [
    entry("hit", "b"),
    { ...entry("hit", "z"), kind: "character" as const },
    { ...entry("hit", "a"), title: "b" },
    { ...entry("hit", "x"), title: "\u{10000}" },
    { ...entry("hit", "y"), title: "\uE000" },
  ];
  const first = (await search(entries, "hit")).hits;
  expect(first.map((hit) => hit.id)).toEqual(["z", "a", "b", "y", "x"]);
  expect((await search(entries.reverse(), "hit")).hits).toEqual(first);
});

it("rejects stale identities, fingerprints and invalid positions", async () => {
  const value = entry("hit");
  const hit = (await search([value], "hit")).hits[0]!;
  expect(resolveGlobalSearchHit(value, hit)).toBe(true);
  expect(
    resolveGlobalSearchHit({ ...value, fingerprint: "b".repeat(64) }, hit),
  ).toBe(false);
  expect(
    resolveGlobalSearchHit({ ...value, id: "deleted-replacement" }, hit),
  ).toBe(false);
  expect(resolveGlobalSearchHit(value, { ...hit, end: 99 })).toBe(false);
});

it("bounds index characters, fields, records, queries and results with explicit partial results", async () => {
  const index = new GlobalSearchIndex();
  index.add(entry("x".repeat(GLOBAL_SEARCH_LIMITS.fieldCharacters + 1)));
  expect(index.snapshot()).toEqual({ entries: [], incomplete: true });
  const total = new GlobalSearchIndex();
  for (let i = 0; i < 100; i++)
    total.add(entry("x".repeat(200_000), String(i)));
  expect(total.snapshot().entries.length).toBe(80);
  expect(total.incomplete).toBe(true);
  const fields = new GlobalSearchIndex();
  fields.add({
    ...entry(""),
    fields: Array.from({ length: GLOBAL_SEARCH_LIMITS.fields + 1 }, () => ({
      name: "x",
      text: "",
    })),
  });
  expect(fields.incomplete).toBe(true);
  const records = new GlobalSearchIndex();
  for (let i = 0; i <= GLOBAL_SEARCH_LIMITS.records; i++)
    records.add(entry("", String(i)));
  expect(records.snapshot().entries.length).toBe(GLOBAL_SEARCH_LIMITS.records);
  expect(records.incomplete).toBe(true);
  const results = await search([entry("hit ".repeat(501))], "hit");
  expect(results.hits).toHaveLength(500);
  expect(results.limited).toBe(true);
  await expect(search([entry("hit")], "x".repeat(501))).rejects.toThrow(
    "too long",
  );
});

it("cancels pre-aborted and in-flight queries, yielding even on nonmatching text", async () => {
  const controller = new AbortController();
  const index = new GlobalSearchIndex();
  for (let i = 0; i < 20; i++) index.add(entry("x".repeat(16_384), String(i)));
  let yields = 0;
  const options = {
    query: "absent",
    matchCase: false,
    wholeWord: false,
    kinds: [],
  };
  await expect(
    searchGlobalIndex(
      index.snapshot(),
      options,
      controller.signal,
      async () => {
        yields++;
        controller.abort();
      },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(yields).toBe(1);
  await expect(
    searchGlobalIndex(index.snapshot(), options, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("compares a representative 300,000-word novel to independent synthetic source expectations", async () => {
  const index = new GlobalSearchIndex();
  const began = performance.now();
  for (let i = 0; i < 120; i++) {
    const content = {
      type: "doc",
      content: Array.from({ length: 100 }, (_, passage) => ({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `chapter-${i}-passage-${passage} ` + "synthetic ".repeat(24),
          },
        ],
      })),
    };
    index.add(
      chapterSearchEntry(
        {
          id: String(i),
          title: `Chapter ${String(i).padStart(3, "0")}`,
          content,
        },
        fingerprint,
      ),
    );
  }
  const snapshot = index.snapshot();
  const indexed = performance.now();
  const result = await searchGlobalIndex(
    snapshot,
    { query: "passage-99", matchCase: true, wholeWord: false, kinds: [] },
    new AbortController().signal,
  );
  const ended = performance.now();
  expect(snapshot.incomplete).toBe(false);
  expect(result.hits.map((hit) => hit.id)).toEqual(
    Array.from({ length: 120 }, (_, i) => String(i)),
  );
  expect(result.hits.every((hit) => hit.field === "text · passage 100")).toBe(
    true,
  );
  expect(ended - began).toBeLessThan(15_000);
  console.info(
    `Synthetic 300000-word search: index=${Math.round(indexed - began)}ms query=${Math.round(ended - indexed)}ms fields=12120`,
  );
});
