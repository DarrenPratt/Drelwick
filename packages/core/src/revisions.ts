/// <reference lib="dom" preserve="true" />
import {
  ReplaceStep,
  Step,
  StepMap,
  StepResult,
  Transform,
  Mapping,
} from "@tiptap/pm/transform";
import type { Node } from "@tiptap/pm/model";
import {
  decodeEditorialDocument,
  decodeEditorialSlice,
  isEditorialDocumentBoundary,
  revisionDocumentHash,
  revisionSlice,
  revisionTextAtoms,
  validateRevisionReview,
  type RevisionGroup,
  type RevisionReview,
} from "@drelwick/project-model";
import { ApplicationError } from "@drelwick/shared";

export interface RevisionState {
  content: Record<string, unknown>;
  review: RevisionReview;
}
export interface RevisionEditOptions {
  id: string;
  created: string;
  authorLabel: string | null;
  combineIds?: string[];
  tracking?: boolean;
  typingUnit?: string;
  continuationId?: string;
}
export interface RevisionEditPlan {
  state: RevisionState;
  requiresCombine: boolean;
  affectedIds: string[];
  wholeChapter: boolean;
  cancelledPending: boolean;
}
const stale = () =>
  new ApplicationError(
    "EDITORIAL_STALE",
    "The revision state changed. Refresh review; your draft was retained.",
  );
const same = (a: unknown, b: unknown) =>
  revisionDocumentHash(a) === revisionDocumentHash(b);
function groupMap(state: RevisionState) {
  const transform = new Transform(decodeEditorialDocument(state.content));
  for (const group of [...state.review.pending].reverse())
    transform.step(
      new ReplaceStep(group.from, group.to, decodeEditorialSlice(group.after)),
    );
  return transform.mapping;
}
function refreshGroups(
  content: Record<string, unknown>,
  groups: RevisionGroup[],
  mapping = new Mapping(),
): RevisionGroup[] {
  const base = decodeEditorialDocument(content),
    hash = revisionDocumentHash(content);
  return groups
    .map((group) => {
      const from = mapping.map(group.from, 1),
        to = mapping.map(group.to, -1);
      if (to < from) throw stale();
      return {
        ...group,
        from,
        to,
        baseHash: hash,
        before: revisionSlice(base.slice(from, to)),
      };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to || (a.id < b.id ? -1 : 1));
}
/** Pure preview. Callers must obtain consent before using a combine-required plan. */
export function normalizeRevision(
  state: RevisionState,
  document: Record<string, unknown>,
  options: RevisionEditOptions,
): RevisionEditPlan {
  validateRevisionReview(state.content, state.review);
  const base = decodeEditorialDocument(state.content),
    proposed = decodeEditorialDocument(state.review.proposed),
    next = decodeEditorialDocument(document);
  const start = proposed.content.findDiffStart(next.content);
  if (start === null)
    return {
      state,
      requiresCombine: false,
      affectedIds: [],
      wholeChapter: false,
      cancelledPending: false,
    };
  const end = proposed.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(end.a, end.b);
  let from = start,
    oldTo = end.a + Math.max(0, overlap),
    newTo = end.b + Math.max(0, overlap),
    wholeChapter = false;
  while (
    from > 0 &&
    (!isEditorialDocumentBoundary(proposed, from) ||
      !isEditorialDocumentBoundary(next, from))
  )
    from--;
  while (
    oldTo < proposed.content.size &&
    newTo < next.content.size &&
    (!isEditorialDocumentBoundary(proposed, oldTo) ||
      !isEditorialDocumentBoundary(next, newTo))
  ) {
    oldTo++;
    newTo++;
  }
  let edit: ReplaceStep;
  try {
    edit = new ReplaceStep(from, oldTo, next.slice(from, newTo));
    if (!edit.apply(proposed).doc?.eq(next)) throw stale();
  } catch {
    from = 0;
    oldTo = proposed.content.size;
    newTo = next.content.size;
    wholeChapter = true;
    edit = new ReplaceStep(from, oldTo, next.slice(from, newTo));
  }
  const forward = groupMap(state),
    inverse = forward.invert();
  let baseFrom = inverse.map(from, -1),
    baseTo = inverse.map(oldTo, 1);
  const affected = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const group of state.review.pending) {
      const proposedFrom = forward.map(group.from, -1),
        proposedTo = proposedFrom + decodeEditorialSlice(group.after).size;
      if (
        (from <= proposedTo && oldTo >= proposedFrom) ||
        (baseFrom <= group.to && baseTo >= group.from)
      ) {
        if (!affected.has(group.id)) {
          affected.add(group.id);
          changed = true;
        }
        baseFrom = Math.min(baseFrom, group.from);
        baseTo = Math.max(baseTo, group.to);
      }
    }
  }
  const affectedGroups = state.review.pending.filter((group) =>
    affected.has(group.id),
  );
  const affectedIds = [...affectedGroups]
    .sort((a, b) =>
      a.created < b.created
        ? -1
        : a.created > b.created
          ? 1
          : a.id < b.id
            ? -1
            : 1,
    )
    .map((group) => group.id);
  const tracking = options.tracking ?? state.review.mode === "track";
  const continuation =
    options.continuationId &&
    affectedIds.length === 1 &&
    affectedIds[0] === options.continuationId
      ? affectedGroups[0]
      : undefined;
  const requiresCombine = affectedIds.length > 0 && !continuation;
  const consent = options.combineIds ?? [];
  if (consent.length && !same([...consent].sort(), [...affectedIds].sort()))
    throw stale();
  if (!tracking && !requiresCombine) {
    const acceptedEdit = new ReplaceStep(
      baseFrom,
      baseTo,
      next.slice(from, newTo),
    );
    const applied = acceptedEdit.apply(base);
    if (applied.failed || !applied.doc) throw stale();
    const content = applied.doc.toJSON() as Record<string, unknown>;
    const result = {
      content,
      review: {
        ...state.review,
        proposed: next.toJSON() as Record<string, unknown>,
        pending: refreshGroups(
          content,
          state.review.pending,
          new Mapping([acceptedEdit.getMap()]),
        ),
      },
    };
    validateRevisionReview(result.content, result.review);
    return {
      state: result,
      requiresCombine: false,
      affectedIds,
      wholeChapter,
      cancelledPending: false,
    };
  }
  const before = base.slice(baseFrom, baseTo);
  const rangeFrom = forward.map(baseFrom, -1),
    rangeTo = forward.map(baseTo, 1);
  const after = next.slice(
    edit.getMap().map(rangeFrom, -1),
    edit.getMap().map(rangeTo, 1),
  );
  const pending = state.review.pending.filter(
    (group) => !affected.has(group.id),
  );
  const cancelledPending = before.eq(after);
  if (!cancelledPending)
    pending.push({
      schemaVersion: 1,
      id: continuation?.id ?? options.id,
      kind:
        before.size === 0
          ? "insert"
          : after.size === 0
            ? "delete"
            : revisionTextAtoms(before.content) ===
                revisionTextAtoms(after.content)
              ? "format"
              : "replace",
      created: continuation?.created ?? options.created,
      modified: options.created,
      authorLabel: continuation?.authorLabel ?? options.authorLabel,
      baseHash: revisionDocumentHash(state.content),
      from: baseFrom,
      to: baseTo,
      before: revisionSlice(before),
      after: revisionSlice(after),
      supersedes: continuation?.supersedes ?? affectedIds,
    });
  const result = {
    content: state.content,
    review: {
      ...state.review,
      mode: tracking ? ("track" as const) : state.review.mode,
      proposed: next.toJSON() as Record<string, unknown>,
      pending: refreshGroups(state.content, pending),
    },
  };
  validateRevisionReview(result.content, result.review);
  return {
    state: result,
    requiresCombine,
    affectedIds,
    wholeChapter,
    cancelledPending,
  };
}
/** Exact selected identities, descending base order; never best-effort review. */
export function planRevisionReview(
  state: RevisionState,
  ids: readonly string[],
  action: "accept" | "reject",
): { state: RevisionState; steps: Record<string, unknown>[] } {
  validateRevisionReview(state.content, state.review);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !state.review.pending.some((group) => group.id === id))
  )
    throw stale();
  const chosen = new Set(ids),
    base = new Transform(decodeEditorialDocument(state.content));
  const proposed = new Transform(
    decodeEditorialDocument(state.review.proposed),
  );
  const mapping = groupMap(state);
  for (const group of [...state.review.pending]
    .reverse()
    .filter((group) => chosen.has(group.id))) {
    if (action === "accept")
      base.step(
        new ReplaceStep(
          group.from,
          group.to,
          decodeEditorialSlice(group.after),
        ),
      );
    else {
      const from = mapping.map(group.from, -1);
      proposed.step(
        new ReplaceStep(
          from,
          from + decodeEditorialSlice(group.after).size,
          decodeEditorialSlice(group.before),
        ),
      );
    }
  }
  const content = base.doc.toJSON() as Record<string, unknown>;
  const result = {
    content,
    review: {
      ...state.review,
      proposed: proposed.doc.toJSON() as Record<string, unknown>,
      pending: refreshGroups(
        content,
        state.review.pending.filter((group) => !chosen.has(group.id)),
        base.mapping,
      ),
    },
  };
  validateRevisionReview(result.content, result.review);
  return {
    state: result,
    steps: proposed.steps.map(
      (step) => step.toJSON() as Record<string, unknown>,
    ),
  };
}
/** A native ProseMirror companion step, not another undo stack or authority. */
export class RevisionStateStep extends Step {
  constructor(
    readonly eventId: string,
    readonly beforeState: RevisionState,
    readonly afterState: RevisionState,
    readonly intent:
      | { kind: "edit"; options: RevisionEditOptions }
      | { kind: "mode" }
      | { kind: "recorded" },
    readonly direction: "forward" | "undo" | "redo" = "forward",
  ) {
    super();
  }
  override apply(doc: Node) {
    return StepResult.ok(doc);
  }
  override getMap() {
    return StepMap.empty;
  }
  override invert() {
    return new RevisionStateStep(
      this.eventId,
      this.beforeState,
      this.afterState,
      this.intent,
      this.direction === "undo" ? "redo" : "undo",
    );
  }
  override map() {
    return this;
  }
  override toJSON() {
    return {
      stepType: "drelwickRevisionState",
      eventId: this.eventId,
      beforeState: this.beforeState,
      afterState: this.afterState,
      intent: this.intent,
      direction: this.direction,
    };
  }
}
