import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  ChapterFileV2Schema,
  EditorialStateSchema,
} from "@drelwick/project-model";
import {
  assertEditorialGraphemeRange,
  isEditorialGraphemeBoundary,
  mapEditorialAnchors,
  mergeEditorialAnchors,
  orphanEditorialAnchors,
  splitEditorialAnchors,
} from "../src/editorial-anchors.js";
import { validateEditorialBundle } from "../src/editorial-bundle.js";

const fixture = new URL(
  "../../../docs/examples/editorial-v1/project/editorial/state.json",
  import.meta.url,
);
const state = EditorialStateSchema.parse(
  JSON.parse(await readFile(fixture, "utf8")),
);

it("history restore preserves segments and discussion identity in other chapters", () => {
  const original = state.anchors[0]!;
  const segment = original.segments[0]!;
  const other = {
    ...segment,
    chapterId: "00000000-0000-4000-8000-000000000099",
  };
  const anchor = { ...original, segments: [segment, other] };
  const result = orphanEditorialAnchors(
    [anchor],
    segment.chapterId,
    (item) => item.original,
    "history-restore",
  )[0]!;
  expect(result.id).toBe(anchor.id);
  expect(result.original).toEqual(anchor.original);
  expect(result.segments).toEqual([other]);
  expect(result.status).toBe("partial");
  expect(result.lost.at(-1)).toEqual({
    evidence: anchor.original,
    reason: "history-restore",
    revisionGroupId: null,
  });
  expect(anchor.segments).toEqual([segment, other]);
});

it("maps annotation ranges with ProseMirror boundary associations", () => {
  const anchors = mapEditorialAnchors(
    state.anchors,
    "00000000-0000-4000-8000-000000000002",
    3,
    "b".repeat(64),
    {
      map: (pos) => (pos >= 5 ? pos + 6 : pos),
      mapResult: (pos) => ({
        pos: pos >= 5 ? pos + 6 : pos,
        deleted: false,
      }),
    },
  );
  expect(anchors[0]?.segments[0]).toMatchObject({
    from: 17,
    to: 20,
    chapterRevision: 3,
    documentHash: "b".repeat(64),
  });
  expect(anchors[0]?.original.from).toBe(5);
});

it("maps an insertion inside the selection and preserves right-affinity points", () => {
  const anchor = state.anchors[0]!;
  const range = {
    ...anchor,
    segments: [{ ...anchor.segments[0]!, from: 5, to: 8 }],
  };
  const point = {
    ...anchor,
    id: "00000000-0000-4000-8000-000000000099",
    segments: [{ ...anchor.segments[0]!, from: 8, to: 8 }],
  };
  const map = {
    map: (pos: number, assoc = 1) =>
      pos > 6 || (pos === 6 && assoc > 0) ? pos + 1 : pos,
    mapResult: (pos: number, assoc = 1) => ({
      pos: pos > 6 || (pos === 6 && assoc > 0) ? pos + 1 : pos,
      deleted: false,
    }),
  };
  const mapped = mapEditorialAnchors(
    [range, point],
    range.segments[0]!.chapterId,
    3,
    "b".repeat(64),
    map,
  );
  expect(mapped[0]?.segments.map(({ from, to }) => [from, to])).toEqual([
    [5, 9],
  ]);
  expect(mapped[1]?.segments.map(({ from, to }) => [from, to])).toEqual([
    [9, 9],
  ]);
});

it("orphan replacement never quote-matches a duplicate and preserves overlapping evidence independently", () => {
  const base = state.anchors[0]!;
  const chapterId = base.segments[0]!.chapterId;
  const first = {
    ...base,
    segments: [{ ...base.segments[0]!, from: 5, to: 8 }],
  };
  const second = {
    ...base,
    id: "00000000-0000-4000-8000-000000000099",
    segments: [{ ...base.segments[0]!, from: 6, to: 9 }],
  };
  const evidence = { ...base.original, from: 5, to: 8 };
  const deleted = mapEditorialAnchors(
    [first],
    chapterId,
    3,
    "b".repeat(64),
    {
      map: (pos) => pos,
      mapResult: (pos) => ({ pos, deleted: pos === 5 || pos === 8 }),
    },
    [{ chapterId, from: 5, to: 8, evidence }],
  );
  expect(deleted[0]?.status).toBe("orphaned");
  expect(deleted[0]?.segments).toEqual([]);
  expect(deleted[0]?.lost[0]?.evidence).toEqual(evidence);
  const overlap = mapEditorialAnchors(
    [first, second],
    chapterId,
    3,
    "c".repeat(64),
    {
      map: (pos) => (pos > 7 ? pos - 1 : pos),
      mapResult: (pos) => ({
        pos: pos > 7 ? pos - 1 : pos,
        deleted: pos === 6 || pos === 7,
      }),
    },
    [{ chapterId, from: 6, to: 7, evidence }],
  );
  expect(overlap.map((anchor) => anchor.status)).toEqual([
    "partial",
    "partial",
  ]);
  expect(overlap.map((anchor) => anchor.lost.length)).toEqual([1, 1]);
  expect(overlap[0]?.id).not.toBe(overlap[1]?.id);
});

it("retains deleted evidence and marks the surviving range partial", () => {
  const evidence = { ...state.anchors[0]!.original, from: 12, to: 13 };
  const anchors = mapEditorialAnchors(
    state.anchors,
    "00000000-0000-4000-8000-000000000002",
    3,
    "b".repeat(64),
    {
      map: (pos) => (pos > 6 ? pos - 1 : pos),
      mapResult: (pos) => ({
        pos: pos > 6 ? pos - 1 : pos,
        deleted: pos === 6,
      }),
    },
    [
      {
        chapterId: "00000000-0000-4000-8000-000000000002",
        from: 12,
        to: 13,
        evidence,
      },
    ],
  );
  expect(anchors[0]?.status).toBe("partial");
  expect(anchors[0]?.lost).toHaveLength(1);
  expect(anchors[0]?.original).toEqual(state.anchors[0]?.original);
});

it("accepts grapheme edges and rejects offsets inside combining and joined emoji", () => {
  const combining = "e\u0301";
  expect(isEditorialGraphemeBoundary(combining, 0)).toBe(true);
  expect(isEditorialGraphemeBoundary(combining, 1)).toBe(false);
  expect(isEditorialGraphemeBoundary(combining, 2)).toBe(true);
  const joined = "👩‍🚀";
  expect(isEditorialGraphemeBoundary(joined, 2)).toBe(false);
  expect(isEditorialGraphemeBoundary(joined, joined.length)).toBe(true);
  expect(() => assertEditorialGraphemeRange(combining, 0, 1)).toThrow();
  expect(() => assertEditorialGraphemeRange(combining, 0, 2)).not.toThrow();
});

it("splits crossing ranges under the same anchor and merges by ProseMirror doc size", () => {
  const anchor = state.anchors[0]!;
  const source = {
    ...anchor,
    segments: [{ ...anchor.segments[0]!, from: 1, to: 8 }],
  };
  const split = splitEditorialAnchors(
    [source],
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000099",
    5,
    3,
    1,
    "c".repeat(64),
    "d".repeat(64),
  );
  expect(split[0]?.id).toBe(source.id);
  expect(split[0]?.segments.map(({ from, to }) => [from, to])).toEqual([
    [1, 5],
    [1, 4],
  ]);
  const merged = mergeEditorialAnchors(
    split,
    "00000000-0000-4000-8000-000000000099",
    "00000000-0000-4000-8000-000000000002",
    6,
    4,
    "e".repeat(64),
  );
  expect(merged[0]?.segments.map(({ from, to }) => [from, to])).toEqual([
    [1, 5],
    [7, 10],
  ]);
});

it("validates state references against chapter generations, hashes and range bounds", async () => {
  const chapterRaw = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/examples/editorial-v1/project/manuscript/00000000-0000-4000-8000-000000000002.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  chapterRaw.content = chapterRaw.review.proposed;
  chapterRaw.review = {
    schemaVersion: 1,
    mode: "off",
    proposed: chapterRaw.content,
    pending: [],
  };
  const chapter = ChapterFileV2Schema.parse(chapterRaw);
  const input = {
    projectId: state.projectId,
    generation: state.generation,
    chapterOrder: [chapter.id],
    chapters: [chapter],
    state,
  };
  expect(() => validateEditorialBundle(input)).not.toThrow();
  expect(() => validateEditorialBundle({ ...input, generation: 8 })).toThrow();
  expect(() =>
    validateEditorialBundle({
      ...input,
      chapters: [{ ...chapter, revision: 3 }],
    }),
  ).toThrow();
});
