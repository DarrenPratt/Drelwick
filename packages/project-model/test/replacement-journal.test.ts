import { expect, it } from "vitest";
import { ReplacementJournalSchema } from "../src/index.js";

const id = "00000000-0000-4000-8000-000000000001";
const createdId = "00000000-0000-4000-8000-000000000002";
const chapter = {
  schemaVersion: 1,
  id,
  type: "chapter",
  title: "Chapter",
  status: "draft",
  created: "2026-09-24T12:00:00.000Z",
  modified: "2026-09-24T12:00:00.000Z",
  content: { type: "doc", content: [{ type: "paragraph" }] },
};
const manifest = {
  schemaVersion: 1,
  projectId: id,
  created: chapter.created,
  modified: chapter.modified,
  bookFile: "book.json",
  manuscript: { order: [id] },
};
const journal = {
  schemaVersion: 1,
  token: id,
  pid: 123,
  host: "test",
  phase: "pending",
  entries: [],
};
const structure = {
  beforeManifest: manifest,
  afterManifest: { ...manifest, manuscript: { order: [id, createdId] } },
  created: [{ ...chapter, id: createdId }],
  removed: [],
};

it("reads existing replacement journals and structural journals without changing chapter formats", () => {
  expect(
    ReplacementJournalSchema.safeParse({
      ...journal,
      entries: [{ before: chapter, after: chapter }],
    }).success,
  ).toBe(true);
  expect(
    ReplacementJournalSchema.safeParse({ ...journal, structure }).success,
  ).toBe(true);
});
it("rejects malformed manifests through safeParse without throwing", () => {
  expect(
    ReplacementJournalSchema.safeParse({
      ...journal,
      structure: { ...structure, beforeManifest: {} },
    }).success,
  ).toBe(false);
});
it("rejects reused identities, missing identities and mismatched manifest transitions", () => {
  for (const invalid of [
    { ...structure, created: [chapter] },
    { ...structure, created: [] },
    { ...structure, removed: [{ ...chapter, id: createdId }] },
    { ...structure, afterManifest: { ...manifest, projectId: createdId } },
  ])
    expect(
      ReplacementJournalSchema.safeParse({ ...journal, structure: invalid })
        .success,
    ).toBe(false);
});
