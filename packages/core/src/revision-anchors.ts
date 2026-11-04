import { Mapping, ReplaceStep, Transform } from "@tiptap/pm/transform";
import {
  decodeEditorialDocument,
  decodeEditorialSlice,
  revisionDocumentHash,
  type EditorialAnchor,
} from "@drelwick/project-model";
import type { RevisionState } from "./revisions.js";

export function revisionProjectionMap(state: RevisionState): Mapping {
  const transform = new Transform(decodeEditorialDocument(state.content));
  for (const group of [...state.review.pending].reverse())
    transform.step(
      new ReplaceStep(group.from, group.to, decodeEditorialSlice(group.after)),
    );
  return transform.mapping;
}
function acceptedMap(before: RevisionState, after: RevisionState): Mapping {
  const oldDoc = decodeEditorialDocument(before.content),
    newDoc = decodeEditorialDocument(after.content);
  const accepted = new Transform(oldDoc);
  for (const group of [...before.review.pending].reverse())
    if (!after.review.pending.some((value) => value.id === group.id))
      accepted.step(
        new ReplaceStep(
          group.from,
          group.to,
          decodeEditorialSlice(group.after),
        ),
      );
  if (accepted.doc.eq(newDoc)) return accepted.mapping;
  const from = oldDoc.content.findDiffStart(newDoc.content);
  if (from === null) return new Mapping();
  const end = oldDoc.content.findDiffEnd(newDoc.content)!;
  const overlap = Math.max(0, from - Math.min(end.a, end.b));
  return new Mapping([
    new ReplaceStep(
      from,
      end.a + overlap,
      newDoc.slice(from, end.b + overlap),
    ).getMap(),
  ]);
}
/** Preserve original loss evidence; only the derived, exact inverse target moves. */
export function advanceRevisionAnchorTargets(
  anchors: EditorialAnchor[],
  beforeAnchors: readonly EditorialAnchor[],
  chapterId: string,
  before: RevisionState,
  after: RevisionState,
  sourceMaps: Map<string, Mapping>,
): EditorialAnchor[] {
  const priorHash = revisionDocumentHash(before.content),
    nextHash = revisionDocumentHash(after.content),
    baselineMap = acceptedMap(before, after),
    inverse = revisionProjectionMap(before).invert();
  const accepted = decodeEditorialDocument(before.content);
  return anchors.map((anchor) => {
    const original = beforeAnchors.find((value) => value.id === anchor.id),
      priorLoss = new Set(
        (original?.lost ?? []).map((loss) => revisionDocumentHash(loss)),
      );
    return {
      ...anchor,
      lost: anchor.lost.map((loss) => {
        if (loss.evidence.chapterId !== chapterId) return loss;
        const target = loss.reviewTarget;
        if (target && target.baseHash === priorHash) {
          const replacement = after.review.pending.find(
            (group) =>
              group.id === target.groupId ||
              group.supersedes.includes(target.groupId),
          );
          if (!replacement) {
            const result = { ...loss };
            delete result.reviewTarget;
            return result;
          }
          return {
            ...loss,
            revisionGroupId: replacement.id,
            reviewTarget: {
              groupId: replacement.id,
              baseHash: nextHash,
              from: baselineMap.map(target.from, 1),
              to: baselineMap.map(target.to, -1),
            },
          };
        }
        if (priorLoss.has(revisionDocumentHash(loss))) return loss;
        const source = sourceMaps.get(loss.evidence.documentHash);
        if (!source) return loss;
        const from = inverse.map(source.invert().map(loss.evidence.from, 1), 1),
          to = inverse.map(source.invert().map(loss.evidence.to, -1), -1);
        const group = after.review.pending.find(
          (group) =>
            group.from <= baselineMap.map(from, 1) &&
            group.to >= baselineMap.map(to, -1),
        );
        if (!group) return loss;
        if (
          from >= to ||
          from < 0 ||
          to > accepted.content.size ||
          !accepted
            .slice(from, to)
            .eq(decodeEditorialSlice(loss.evidence.slice))
        )
          return { ...loss, revisionGroupId: group.id };
        return {
          ...loss,
          revisionGroupId: group.id,
          reviewTarget: {
            groupId: group.id,
            baseHash: nextHash,
            from: baselineMap.map(from, 1),
            to: baselineMap.map(to, -1),
          },
        };
      }),
    };
  });
}
/** Reject resurrects only a recorded inverse target; no quote or similarity lookup. */
export function restoreRejectedRevisionAnchors(
  anchors: EditorialAnchor[],
  chapterId: string,
  revision: number,
  state: RevisionState,
  ids: readonly string[],
  order: readonly string[],
): EditorialAnchor[] {
  const selected = new Set(ids),
    hash = revisionDocumentHash(state.content),
    document = decodeEditorialDocument(state.review.proposed),
    documentHash = revisionDocumentHash(state.review.proposed),
    mapping = revisionProjectionMap(state);
  return anchors.map((anchor) => {
    if (anchor.status === "unverified") return anchor;
    const restored: EditorialAnchor["segments"] = [],
      lost: EditorialAnchor["lost"] = [];
    for (const loss of anchor.lost) {
      const target = loss.reviewTarget;
      if (
        !target ||
        !selected.has(target.groupId) ||
        target.baseHash !== hash ||
        loss.evidence.chapterId !== chapterId
      ) {
        lost.push(loss);
        continue;
      }
      const from = mapping.map(target.from, 1),
        to = mapping.map(target.to, -1);
      if (
        from >= to ||
        to > document.content.size ||
        !document.slice(from, to).eq(decodeEditorialSlice(loss.evidence.slice))
      ) {
        lost.push(loss);
        continue;
      }
      restored.push({
        chapterId,
        chapterRevision: revision,
        documentHash,
        from,
        to,
        pointAffinity: "right",
      });
    }
    if (!restored.length) return anchor;
    const segments = [...anchor.segments, ...restored].sort(
        (a, b) =>
          order.indexOf(a.chapterId) - order.indexOf(b.chapterId) ||
          a.from - b.from ||
          a.to - b.to,
      ),
      compact: typeof segments = [];
    for (const segment of segments) {
      const last = compact.at(-1);
      if (
        last &&
        last.chapterId === segment.chapterId &&
        last.to >= segment.from
      )
        last.to = Math.max(last.to, segment.to);
      else compact.push({ ...segment });
    }
    return {
      ...anchor,
      modified: new Date().toISOString(),
      segments: compact,
      lost,
      status: lost.length ? ("partial" as const) : ("attached" as const),
    };
  });
}
