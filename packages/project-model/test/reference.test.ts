import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  ReferenceRecordSchema,
  ReferenceDraftSchema,
  parseReferenceJson,
} from "../src/reference.js";

const examples = JSON.parse(
  readFileSync(
    new URL("../../../docs/examples/story-bible-v1.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>[];
it("validates every approved example without changing fields", () => {
  for (const value of examples)
    expect(ReferenceRecordSchema.parse(value)).toEqual(value);
});
it.each([
  { schemaVersion: 2 },
  { schemaVersion: "1" },
  { schemaVersion: 0 },
  { id: "../escape" },
  { id: "00000000-0000-1000-8000-000000000010" },
  { projectId: "bad" },
  { future: true },
  { tags: ["x", "x"] },
  { name: " " },
  { revision: 0 },
  { revision: Number.MAX_SAFE_INTEGER + 1 },
  { created: "tomorrow" },
  { modified: "2020-01-01T00:00:00.000Z" },
  { deletedAt: "2099-01-01T00:00:00.000Z" },
  { name: "\ud800" },
  { notes: "private\0content" },
  { aliases: ["x", "x"] },
])("rejects malformed record %#", (patch) => {
  expect(
    ReferenceRecordSchema.safeParse({ ...examples[0], ...patch }).success,
  ).toBe(false);
});
it("rejects duplicate/self links and unknown nested fields", () => {
  const base = examples[0]!;
  const link = {
    id: "00000000-0000-4000-8000-000000000100",
    target: { kind: "character", id: base.id },
  };
  expect(
    ReferenceRecordSchema.safeParse({ ...base, links: [link] }).success,
  ).toBe(false);
  const other = {
    ...link,
    target: { kind: "chapter", id: "00000000-0000-4000-8000-000000000002" },
  };
  expect(
    ReferenceRecordSchema.safeParse({ ...base, links: [other, other] }).success,
  ).toBe(false);
  expect(
    ReferenceRecordSchema.safeParse({
      ...base,
      links: [{ ...other, target: { ...other.target, path: "bad" } }],
    }).success,
  ).toBe(false);
});
it("validates draft identity and base revision, not just nested content", () => {
  const record = examples[0]!;
  const draft = {
    schemaVersion: 1,
    projectId: record.projectId,
    recordId: record.id,
    draftId: "00000000-0000-4000-8000-000000000099",
    captured: record.created,
    generation: 1,
    baseRevision: null,
    baseSha256: null,
    record,
  };
  expect(ReferenceDraftSchema.safeParse(draft).success).toBe(true);
  for (const patch of [
    { recordId: "00000000-0000-4000-8000-000000000098" },
    { baseRevision: 1 },
    { future: "private" },
  ])
    expect(ReferenceDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(
      false,
    );
});
it.each([
  '{"id":1,"id":2}',
  '{"x":{"a":1,"\\u0061":2}}',
  '{"x":[{"a":1,"a":2}]}',
  '{"x":',
  "\ufeff{}",
  '{"x":01}',
  "[1,]",
  '{"x":1} false',
])("rejects malformed/ambiguous JSON %#", (text) => {
  expect(() => parseReferenceJson(text)).toThrow();
});
it("preserves Unicode, escaped quotes, newlines and empty prose", () => {
  const value = { ...examples[4], body: 'é é 日本語 " \\ \n', source: "" };
  expect(parseReferenceJson(JSON.stringify(value))).toEqual(value);
  expect(ReferenceRecordSchema.parse(value)).toEqual(value);
});
