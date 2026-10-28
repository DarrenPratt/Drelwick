import { createHash } from "node:crypto";
import type { ChapterFileV2, EditorialState } from "@drelwick/project-model";
import { ApplicationError } from "@drelwick/shared";

function canonical(value: unknown): string {
  const normalize = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(normalize)
      : input !== null && typeof input === "object"
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : input;
  return JSON.stringify(normalize(value));
}
export function editorialDocumentHash(document: unknown): string {
  return createHash("sha256").update(canonical(document), "utf8").digest("hex");
}
function nodeSize(node: unknown): number {
  if (node === null || typeof node !== "object") return 0;
  const value = node as { type?: unknown; text?: unknown; content?: unknown };
  if (value.type === "text")
    return typeof value.text === "string" ? value.text.length : 0;
  if (!Array.isArray(value.content)) return value.type === "doc" ? 0 : 1;
  const content = value.content.reduce<number>(
    (sum, child) => sum + nodeSize(child),
    0,
  );
  return value.type === "doc" ? content : content + 2;
}

/** Validate cross-file editorial references before a caller stages or publishes a write. */
export function validateEditorialBundle(input: {
  projectId: string;
  generation: number;
  chapterOrder: readonly string[];
  chapters: readonly ChapterFileV2[];
  state: EditorialState;
}): void {
  const invalid = () =>
    new ApplicationError(
      "EDITORIAL_INVALID",
      "Editorial data does not match the saved manuscript bundle.",
    );
  if (
    input.state.projectId !== input.projectId ||
    input.state.generation !== input.generation
  )
    throw invalid();
  const chapters = new Map(
    input.chapters.map((chapter) => [chapter.id, chapter]),
  );
  if (
    chapters.size !== input.chapters.length ||
    input.chapterOrder.length !== chapters.size ||
    input.chapterOrder.some((id) => !chapters.has(id))
  )
    throw invalid();
  for (const chapter of input.chapters) {
    if (
      chapter.review.pending.length !== 0 ||
      chapter.review.mode !== "off" ||
      JSON.stringify(chapter.content) !==
        JSON.stringify(chapter.review.proposed)
    )
      throw new ApplicationError(
        "EDITORIAL_UNSUPPORTED",
        "Pending revision data requires a newer compatible editor.",
      );
  }
  for (const anchor of input.state.anchors) {
    if (anchor.status === "unverified") continue;
    for (const segment of anchor.segments) {
      const chapter = chapters.get(segment.chapterId);
      if (!chapter) throw invalid();
      if (
        segment.chapterRevision !== chapter.revision ||
        segment.documentHash !==
          editorialDocumentHash(chapter.review.proposed) ||
        segment.to > nodeSize(chapter.review.proposed)
      )
        throw invalid();
    }
    for (const lost of anchor.lost)
      if (lost.evidence.to < lost.evidence.from) throw invalid();
  }
}
