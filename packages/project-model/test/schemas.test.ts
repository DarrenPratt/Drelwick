import { describe, expect, it } from "vitest";

import {
  BookMetadataSchema,
  ChapterFileSchema,
  ChapterSummarySchema,
  ChapterSummaryCacheSchema,
  CountedChapterSummarySchema,
  ProjectConfigSchema,
} from "../src/index.js";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const chapterId = "123e4567-e89b-42d3-a456-426614174001";
const timestamps = {
  created: "2026-09-14T12:00:00.000Z",
  modified: "2026-09-14T12:30:00.000Z",
};

describe("persistent project schemas", () => {
  it("parses a valid project and book", () => {
    expect(
      ProjectConfigSchema.parse({
        schemaVersion: 1,
        projectId,
        ...timestamps,
        bookFile: "book.json",
        manuscript: { order: [chapterId] },
      }),
    ).toMatchObject({ projectId, manuscript: { order: [chapterId] } });

    expect(
      BookMetadataSchema.parse({
        schemaVersion: 1,
        title: "The Example",
        author: "Author",
        language: "en-GB",
        ...timestamps,
      }),
    ).toMatchObject({ title: "The Example", schemaVersion: 1 });
  });

  it("parses chapter files and summaries", () => {
    const chapter = {
      schemaVersion: 1,
      id: chapterId,
      type: "chapter",
      title: "A beginning",
      status: "draft",
      content: { type: "doc", content: [] },
      ...timestamps,
    };

    expect(ChapterFileSchema.parse(chapter)).toEqual(chapter);
    expect(ChapterSummarySchema.parse(chapter)).not.toHaveProperty("content");
  });

  it("rejects unsupported versions and invalid IDs", () => {
    expect(() =>
      ProjectConfigSchema.parse({
        schemaVersion: 2,
        projectId,
        ...timestamps,
        bookFile: "book.json",
        manuscript: { order: [] },
      }),
    ).toThrow();
    expect(() =>
      ChapterFileSchema.parse({
        schemaVersion: 1,
        id: "chapter-1",
        type: "chapter",
        title: "A beginning",
        status: "draft",
        content: { type: "doc" },
        ...timestamps,
      }),
    ).toThrow();
  });

  it("rejects duplicate chapter order and invalid documents", () => {
    expect(() =>
      ProjectConfigSchema.parse({
        schemaVersion: 1,
        projectId,
        ...timestamps,
        bookFile: "book.json",
        manuscript: { order: [chapterId, chapterId] },
      }),
    ).toThrow();
    expect(() =>
      ChapterFileSchema.parse({
        schemaVersion: 1,
        id: chapterId,
        type: "chapter",
        title: "A beginning",
        status: "draft",
        content: { type: "paragraph" },
        ...timestamps,
      }),
    ).toThrow();
  });
});

describe("chapter summary cache schemas", () => {
  const summary = {
    schemaVersion: 1,
    id: chapterId,
    type: "chapter",
    title: "Example",
    status: "draft",
    ...timestamps,
    wordCount: 10,
  };
  const entry = { size: 100, mtimeMs: 1234, ctimeMs: 1235, summary };
  const cache = { schemaVersion: 1, projectId, entries: [entry] };

  it("validates the cache envelope and strips bodies from summaries", () => {
    expect(ChapterSummaryCacheSchema.parse(cache)).toEqual(cache);
    expect(
      CountedChapterSummarySchema.parse({
        ...summary,
        content: { type: "doc" },
      }),
    ).toEqual(summary);
    expect(ChapterSummarySchema.parse(summary)).not.toHaveProperty("wordCount");
  });

  it.each([-1, 1.5, Infinity, NaN, "10", undefined])(
    "rejects invalid word counts (%s)",
    (wordCount) => {
      expect(
        CountedChapterSummarySchema.safeParse({ ...summary, wordCount })
          .success,
      ).toBe(false);
    },
  );

  it("rejects unsupported caches, invalid fingerprints and duplicate identities", () => {
    for (const invalid of [
      { ...cache, schemaVersion: 2 },
      { ...cache, projectId: "invalid" },
      { ...cache, entries: [{ ...entry, size: -1 }] },
      { ...cache, entries: [{ ...entry, mtimeMs: Infinity }] },
      {
        ...cache,
        entries: [
          entry,
          { ...entry, summary: { ...summary, id: chapterId.toUpperCase() } },
        ],
      },
    ])
      expect(ChapterSummaryCacheSchema.safeParse(invalid).success).toBe(false);
    expect(
      ProjectConfigSchema.safeParse({
        schemaVersion: 1,
        projectId,
        ...timestamps,
        bookFile: "book.json",
        manuscript: { order: [chapterId, chapterId.toUpperCase()] },
      }).success,
    ).toBe(false);
  });
});
