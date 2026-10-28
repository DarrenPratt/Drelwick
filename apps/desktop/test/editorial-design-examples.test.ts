// #169 verifies documentation examples against the existing editor primitives.
// This is not an implementation of editorial persistence or revision review.
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { ReplaceStep, StepMap } from "@tiptap/pm/transform";
import {
  splitChapterDocument,
  mergeChapterDocuments,
} from "@drelwick/core/chapter-semantics";
import { ManuscriptDocumentSchema } from "@drelwick/project-model";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";

const root = new URL("../../../docs/examples/editorial-v1/", import.meta.url);
const read = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
const schema = getSchema(createManuscriptExtensions());
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
interface Patch {
  kind: string;
  from: number;
  to: number;
  before: object;
  after: object;
}

it("checks documented anchor affinities, deleted-target evidence and structural split/merge positions", async () => {
  const cases = (await read("cases.json")) as {
    mapCases: {
      range: [number, number];
      map: [number, number, number];
      expected: [number, number];
    }[];
  };
  for (const c of cases.mapCases) {
    const map = new StepMap(c.map);
    expect([map.map(c.range[0], 1), map.map(c.range[1], -1)]).toEqual(
      c.expected,
    );
  }
  expect(new StepMap([8, 0, 1]).map(8, 1)).toBe(9);
  // Equal replacement spelling must not be mistaken for retained identity.
  expect(new StepMap([5, 3, 3]).mapResult(6, 1).deleted).toBe(true);
  const [left, right] = splitChapterDocument(doc("red fox"), 5);
  expect(schema.nodeFromJSON(left).textContent).toBe("red ");
  expect(schema.nodeFromJSON(right).textContent).toBe("fox");
  expect(schema.nodeFromJSON(left).slice(1, 5).content.textBetween(0, 4)).toBe(
    "red ",
  );
  expect(schema.nodeFromJSON(right).slice(1, 4).content.textBetween(0, 3)).toBe(
    "fox",
  );
  const merged = schema.nodeFromJSON(mergeChapterDocuments(left, right));
  expect(schema.nodeFromJSON(left).content.size).toBe(6);
  expect(merged.slice(7, 10).content.textBetween(0, 3)).toBe("fox");
});

it("replays all documented revision slice kinds, inverses and accepted/proposed projections with the pinned schema", async () => {
  const chapter = (await read(
    "project/manuscript/00000000-0000-4000-8000-000000000002.json",
  )) as { content: object; review: { proposed: object; pending: Patch[] } };
  const base = schema.nodeFromJSON(chapter.content);
  let proposed = base;
  for (const patch of [...chapter.review.pending].reverse()) {
    expect(
      base.slice(patch.from, patch.to).eq(Slice.fromJSON(schema, patch.before)),
    ).toBe(true);
    const step = new ReplaceStep(
      patch.from,
      patch.to,
      Slice.fromJSON(schema, patch.after),
    );
    const result = step.apply(proposed);
    expect(result.failed).toBeNull();
    proposed = result.doc!;
    expect(step.invert(base).apply(proposed).doc?.eq(base)).toBe(true);
  }
  expect(proposed.eq(schema.nodeFromJSON(chapter.review.proposed))).toBe(true);
  expect(base.textContent).toBe("red fox");
  expect(proposed.textContent).toBe("red quick fox");
  ManuscriptDocumentSchema.parse(proposed.toJSON());
  const variants = (await read("revision-groups.json")) as {
    base: object;
    groups: Patch[];
    expectedText: string[];
  };
  for (const [index, patch] of variants.groups.entries()) {
    const before = schema.nodeFromJSON(variants.base);
    expect(
      before
        .slice(patch.from, patch.to)
        .eq(Slice.fromJSON(schema, patch.before)),
    ).toBe(true);
    const step = new ReplaceStep(
      patch.from,
      patch.to,
      Slice.fromJSON(schema, patch.after),
    );
    const after = step.apply(before).doc!;
    expect(after.textContent).toBe(variants.expectedText[index]);
    ManuscriptDocumentSchema.parse(after.toJSON());
    expect(step.invert(before).apply(after).doc?.eq(before)).toBe(true);
    if (patch.kind === "format")
      expect(after.nodeAt(5)?.marks[0]?.type.name).toBe("bold");
  }
});

it("checks Unicode fixture boundaries and preserves existing semantic JSON without normalization", () => {
  for (const text of ["e\u0301", "👩‍🚀", "😀"]) {
    const boundaries = [
      ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text),
    ].map((part) => part.index);
    expect(boundaries).toEqual([0]);
    const value = doc(text);
    expect(schema.nodeFromJSON(value).toJSON()).toEqual(value);
    expect(ManuscriptDocumentSchema.parse(value)).toEqual(value);
  }
});
