import { expect, it } from "vitest";
import { validateImportedManuscript } from "@drelwick/project-model";
import { reviewImportedManuscript } from "../src/manuscript-import.js";
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const original = validateImportedManuscript(
  JSON.stringify({
    metadata: { title: "Book", author: "Writer", language: "en" },
    chapters: [
      {
        title: "One",
        type: "chapter",
        content: {
          type: "doc",
          content: [paragraph("Café 🌱"), paragraph("Second")],
        },
      },
      {
        title: "Two",
        type: "chapter",
        content: {
          type: "doc",
          content: [paragraph("Third"), paragraph("Last")],
        },
      },
    ],
    assets: [],
    warnings: [
      {
        code: "DOCX_TABLE",
        message: "Table text recovered in reading order.",
        location: { chapter: 1, block: 3, label: "Table" },
      },
    ],
  }),
);
it("splits and merges by partitioning original blocks exactly once, without mutation", () => {
  const bytes = JSON.stringify(original);
  const reviewed = reviewImportedManuscript(original, {
    boundaries: [
      { block: 0, title: "Opening" },
      { block: 1, title: "New chapter" },
      { block: 3, title: "End" },
    ],
    acceptedWarnings: [0],
  });
  expect(
    reviewed.chapters.map((chapter) => chapter.content.content?.length),
  ).toEqual([1, 2, 1]);
  expect(
    reviewed.chapters.flatMap((chapter) => chapter.content.content ?? []),
  ).toEqual(
    original.chapters.flatMap((chapter) => chapter.content.content ?? []),
  );
  expect(reviewed.warnings[0]?.location).toEqual({
    chapter: 1,
    block: 3,
    label: "Table",
  });
  expect(JSON.stringify(original)).toBe(bytes);
  expect(
    reviewImportedManuscript(original, {
      boundaries: [{ block: 0, title: "Whole book" }],
      acceptedWarnings: [0],
    }).chapters,
  ).toHaveLength(1);
});
it.each(
  [[], [1], [0, 0], [0, 1]].map((acceptedWarnings) => ({ acceptedWarnings })),
)(
  "rejects unresolved, invented or duplicate warning decisions %j",
  ({ acceptedWarnings }) => {
    expect(() =>
      reviewImportedManuscript(original, {
        boundaries: [{ block: 0, title: "Book" }],
        acceptedWarnings,
      }),
    ).toThrow(expect.objectContaining({ code: "IMPORT_REVIEW_REQUIRED" }));
  },
);
it.each(
  [[1], [0, 0], [0, 3, 2], [0, 4], [0, -1], [0, 1.5]].map((positions) => ({
    positions,
  })),
)(
  "rejects boundaries that could omit or duplicate blocks %j",
  ({ positions }) => {
    expect(() =>
      reviewImportedManuscript(original, {
        boundaries: positions.map((block) => ({ block, title: "Chapter" })),
        acceptedWarnings: [0],
      }),
    ).toThrow(expect.objectContaining({ code: "IMPORT_REVIEW_REQUIRED" }));
  },
);
