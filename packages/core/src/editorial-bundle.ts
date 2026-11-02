import { createHash } from "node:crypto";
import {
  decodeEditorialDocument,
  isEditorialDocumentBoundary,
  type ChapterFileV2,
  type EditorialState,
  type EditorialAnchor,
} from "@drelwick/project-model";
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
  const identities = [
    input.projectId,
    ...input.chapterOrder,
    ...input.state.anchors.map((item) => item.id),
    ...input.state.annotations.map((item) => item.id),
    ...input.state.threads.map((item) => item.id),
    ...input.state.threads.flatMap((thread) =>
      thread.comments.map((item) => item.id),
    ),
  ].map((id) => id.toLowerCase());
  if (new Set(identities).size !== identities.length) throw invalid();
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
  const documents = new Map(
    input.chapters.map((chapter) => [
      chapter.id,
      decodeEditorialDocument(chapter.review.proposed),
    ]),
  );
  const hashes = new Map(
    input.chapters.map((chapter) => [
      chapter.id,
      editorialDocumentHash(chapter.review.proposed),
    ]),
  );
  const order = new Map(input.chapterOrder.map((id, index) => [id, index]));
  for (const anchor of input.state.anchors) {
    if (anchor.status === "unverified") continue;
    for (const [index, segment] of anchor.segments.entries()) {
      const previous = anchor.segments[index - 1];
      if (
        previous &&
        (order.get(previous.chapterId)! > order.get(segment.chapterId)! ||
          (previous.chapterId === segment.chapterId &&
            (previous.from > segment.from || previous.to > segment.from)))
      )
        throw invalid();
      const chapter = chapters.get(segment.chapterId);
      if (!chapter) throw invalid();
      if (
        segment.chapterRevision !== chapter.revision ||
        segment.documentHash !== hashes.get(segment.chapterId) ||
        !isEditorialDocumentBoundary(
          documents.get(segment.chapterId)!,
          segment.from,
        ) ||
        !isEditorialDocumentBoundary(
          documents.get(segment.chapterId)!,
          segment.to,
        )
      )
        throw invalid();
    }
    for (const lost of anchor.lost)
      if (lost.evidence.to < lost.evidence.from) throw invalid();
  }
}

/** Capture the actual last verified range, rather than substituting its older original quote. */
export function editorialSegmentEvidence(
  document: unknown,
  anchor: EditorialAnchor,
  segment: EditorialAnchor["segments"][number],
) {
  if (segment.documentHash !== editorialDocumentHash(document))
    return anchor.original;
  const doc = decodeEditorialDocument(document);
  if (
    !isEditorialDocumentBoundary(doc, segment.from) ||
    !isEditorialDocumentBoundary(doc, segment.to)
  )
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "The annotation range cannot be preserved safely.",
    );
  const slice = doc.slice(segment.from, segment.to);
  const graphemes = (text: string) => [
    ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text),
  ];
  return {
    chapterId: segment.chapterId,
    documentHash: segment.documentHash,
    from: segment.from,
    to: segment.to,
    slice: {
      content: (slice.content.toJSON() ?? []) as Record<string, unknown>[],
      openStart: slice.openStart,
      openEnd: slice.openEnd,
    },
    prefix: graphemes(doc.textBetween(0, segment.from, " ", " "))
      .slice(-32)
      .map((part) => part.segment)
      .join(""),
    suffix: graphemes(doc.textBetween(segment.to, doc.content.size, " ", " "))
      .slice(0, 32)
      .map((part) => part.segment)
      .join(""),
  };
}
