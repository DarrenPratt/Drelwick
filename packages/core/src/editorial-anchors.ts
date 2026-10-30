import type {
  EditorialAnchor,
  EditorialLostSegment,
} from "@drelwick/project-model";

export interface EditorialStepMap {
  map(position: number, association?: number): number;
  mapResult(
    position: number,
    association?: number,
  ): { pos: number; deleted: boolean; deletedAcross?: boolean };
}
export interface RemovedEditorialRange {
  chapterId: string;
  from: number;
  to: number;
  evidence: EditorialLostSegment["evidence"];
}

/** ProseMirror offsets are UTF-16; selections must also respect grapheme edges. */
export function isEditorialGraphemeBoundary(
  text: string,
  offset: number,
): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    return false;
  if (offset === 0 || offset === text.length) return true;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const segment of segmenter.segment(text))
    if (segment.index === offset) return true;
  return false;
}

export function assertEditorialGraphemeRange(
  text: string,
  from: number,
  to: number,
): void {
  if (
    from > to ||
    !isEditorialGraphemeBoundary(text, from) ||
    !isEditorialGraphemeBoundary(text, to)
  )
    throw new Error("Editorial range must use Unicode grapheme boundaries");
}

/** Apply one committed ProseMirror StepMap to all live ranges without quote rematching. */
export function mapEditorialAnchors(
  anchors: readonly EditorialAnchor[],
  chapterId: string,
  revision: number,
  documentHash: string,
  map: EditorialStepMap,
  removed: readonly RemovedEditorialRange[] = [],
): EditorialAnchor[] {
  return anchors.map((anchor) => {
    let changed = false;
    let unverifiable = false;
    const segments = anchor.segments.flatMap((segment) => {
      if (segment.chapterId !== chapterId) return [segment];
      changed = true;
      const cuts = removed
        .filter(
          (item) =>
            item.chapterId === chapterId &&
            item.from < segment.to &&
            item.to > segment.from,
        )
        .map((item) => ({
          from: Math.max(item.from, segment.from),
          to: Math.min(item.to, segment.to),
          evidence: item.evidence,
        }))
        .sort((a, b) => a.from - b.from);
      const start = map.mapResult(segment.from, 1);
      const end = map.mapResult(segment.to, -1);
      if (
        !cuts.length &&
        (start.deleted ||
          end.deleted ||
          start.deletedAcross ||
          end.deletedAcross)
      ) {
        unverifiable = true;
        // Keep the last known location and hash for recovery; the UI must not
        // navigate it while the anchor is unverified.
        return [segment];
      }
      const pieces: Array<{ from: number; to: number }> = [];
      let cursor = segment.from;
      for (const cut of cuts) {
        if (cut.from > cursor) pieces.push({ from: cursor, to: cut.from });
        cursor = Math.max(cursor, cut.to);
      }
      if (cursor < segment.to) pieces.push({ from: cursor, to: segment.to });
      if (!cuts.length && segment.from === segment.to) {
        const point = map.map(segment.from, 1);
        pieces.push({ from: point, to: point });
      }
      return pieces
        .map((piece) => ({
          ...segment,
          chapterRevision: revision,
          documentHash,
          from: piece.from === piece.to ? piece.from : map.map(piece.from, 1),
          to: piece.from === piece.to ? piece.to : map.map(piece.to, -1),
        }))
        .filter((piece) => piece.from <= piece.to);
    });
    if (!changed) return anchor;
    // Deletion can join surviving pieces; preserve one contiguous live target.
    const compact: typeof segments = [];
    for (const segment of segments) {
      const last = compact.at(-1);
      if (
        last &&
        last.chapterId === segment.chapterId &&
        last.to === segment.from &&
        last.documentHash === segment.documentHash &&
        last.chapterRevision === segment.chapterRevision
      )
        last.to = segment.to;
      else compact.push({ ...segment });
    }
    const lost: EditorialLostSegment[] = [...anchor.lost];
    for (const segment of anchor.segments) {
      if (segment.chapterId !== chapterId) continue;
      for (const cut of removed) {
        if (
          cut.chapterId === chapterId &&
          cut.from < segment.to &&
          cut.to > segment.from
        )
          lost.push({
            evidence: cut.evidence,
            reason: "deleted-text",
            revisionGroupId: null,
          });
      }
    }
    const status = unverifiable
      ? "unverified"
      : lost.length
        ? segments.length
          ? "partial"
          : "orphaned"
        : anchor.status;
    return {
      ...anchor,
      modified: new Date().toISOString(),
      status,
      segments: compact,
      lost,
    };
  });
}

export function orphanEditorialAnchors(
  anchors: readonly EditorialAnchor[],
  chapterId: string,
  evidenceFor: (
    anchor: EditorialAnchor,
    segment: EditorialAnchor["segments"][number],
  ) => EditorialLostSegment["evidence"],
  reason: "deleted-chapter" | "history-restore" = "deleted-chapter",
): EditorialAnchor[] {
  return anchors.map((anchor) => {
    const affected = anchor.segments.filter(
      (segment) => segment.chapterId === chapterId,
    );
    if (!affected.length) return anchor;
    const segments = anchor.segments.filter(
      (segment) => segment.chapterId !== chapterId,
    );
    const lost = [
      ...anchor.lost,
      ...affected.map((segment) => ({
        evidence: evidenceFor(anchor, segment),
        reason,
        revisionGroupId: null,
      })),
    ];
    return {
      ...anchor,
      modified: new Date().toISOString(),
      segments,
      lost,
      status: segments.length ? "partial" : "orphaned",
    };
  });
}

export function splitEditorialAnchors(
  anchors: readonly EditorialAnchor[],
  sourceChapterId: string,
  leftChapterId: string,
  rightChapterId: string,
  splitPosition: number,
  leftRevision: number,
  rightRevision: number,
  leftHash: string,
  rightHash: string,
  rightStart = 1,
  leftSize = splitPosition,
): EditorialAnchor[] {
  if (!Number.isSafeInteger(splitPosition) || splitPosition < 0)
    throw new Error("Invalid chapter split position");
  return anchors.map((anchor) => {
    let changed = false;
    const segments = anchor.segments.flatMap((segment) => {
      if (segment.chapterId !== sourceChapterId) return [segment];
      changed = true;
      if (segment.to <= splitPosition && segment.from < splitPosition)
        return [
          {
            ...segment,
            chapterId: leftChapterId,
            chapterRevision: leftRevision,
            documentHash: leftHash,
            from: Math.min(segment.from, leftSize),
            to: Math.min(segment.to, leftSize),
          },
        ];
      if (segment.from >= splitPosition)
        return [
          {
            ...segment,
            chapterId: rightChapterId,
            chapterRevision: rightRevision,
            documentHash: rightHash,
            from: rightStart + segment.from - splitPosition,
            to: rightStart + segment.to - splitPosition,
          },
        ];
      return [
        {
          ...segment,
          chapterId: leftChapterId,
          chapterRevision: leftRevision,
          documentHash: leftHash,
          to: Math.min(splitPosition, leftSize),
        },
        {
          ...segment,
          chapterId: rightChapterId,
          chapterRevision: rightRevision,
          documentHash: rightHash,
          from: rightStart,
          to: rightStart + segment.to - splitPosition,
        },
      ];
    });
    return changed
      ? {
          ...anchor,
          segments,
          status: anchor.lost.length ? "partial" : anchor.status,
        }
      : anchor;
  });
}

export function mergeEditorialAnchors(
  anchors: readonly EditorialAnchor[],
  removedChapterId: string,
  survivingChapterId: string,
  firstDocumentSize: number,
  revision: number,
  documentHash: string,
): EditorialAnchor[] {
  if (!Number.isSafeInteger(firstDocumentSize) || firstDocumentSize < 0)
    throw new Error("Invalid merge offset");
  return anchors.map((anchor) => {
    let changed = false;
    const segments = anchor.segments
      .map((segment) => {
        if (
          segment.chapterId !== removedChapterId &&
          segment.chapterId !== survivingChapterId
        )
          return segment;
        changed = true;
        return {
          ...segment,
          chapterId: survivingChapterId,
          chapterRevision: revision,
          documentHash,
          ...(segment.chapterId === removedChapterId
            ? {
                from: segment.from + firstDocumentSize,
                to: segment.to + firstDocumentSize,
              }
            : {}),
        };
      })
      .sort((a, b) => a.from - b.from || a.to - b.to);
    return changed
      ? {
          ...anchor,
          segments,
          status: anchor.lost.length ? "partial" : anchor.status,
        }
      : anchor;
  });
}
