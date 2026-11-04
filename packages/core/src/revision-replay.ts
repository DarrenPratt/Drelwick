import { Step } from "@tiptap/pm/transform";
import {
  decodeEditorialDocument,
  editorialManuscriptSchema,
  ChapterFileV2Schema,
  revisionDocumentHash,
  type ChapterFileV2,
} from "@drelwick/project-model";
import { ApplicationError } from "@drelwick/shared";
import {
  normalizeRevision,
  type RevisionState,
  type RevisionEditOptions,
} from "./revisions.js";
import type {
  EditorialEditorTransaction,
  EditorialReplaySession,
} from "./editorial-editing.js";

const same = (a: unknown, b: unknown) =>
  revisionDocumentHash(a) === revisionDocumentHash(b);
const fail = () =>
  new ApplicationError(
    "EDITORIAL_STALE",
    "The revision history or source changed. Preserve the draft and refresh review.",
  );
export function replayRevisionEdits(
  chapter: ChapterFileV2,
  document: Record<string, unknown>,
  transactions: readonly EditorialEditorTransaction[] | undefined,
  session: EditorialReplaySession,
): RevisionState {
  let state: RevisionState = {
    content: chapter.content,
    review: chapter.review,
  };
  if (
    !transactions?.some((tx) =>
      tx.steps.some((step) => step["stepType"] === "drelwickRevisionState"),
    )
  ) {
    if (state.review.pending.length || state.review.mode !== "off")
      throw new ApplicationError(
        "EDITORIAL_REVIEW_REQUIRED",
        "Review pending changes or use the revision-aware editor before changing this chapter.",
      );
    return {
      content: document,
      review: { ...state.review, proposed: document },
    };
  }
  const events = (session.revisionEvents ??= new Map());
  let doc = decodeEditorialDocument(chapter.review.proposed);
  for (const tx of transactions ?? []) {
    if (doc.content.size === 0 && !doc.eq(decodeEditorialDocument(tx.before))) {
      const initial = decodeEditorialDocument(tx.before);
      if (
        initial.childCount === 1 &&
        initial.firstChild?.type.name === "paragraph" &&
        initial.firstChild.content.size === 0
      )
        doc = initial;
    }
    if (!doc.eq(decodeEditorialDocument(tx.before))) throw fail();
    for (const raw of tx.steps) {
      if (raw["stepType"] === "drelwickEditorialHistory") continue;
      if (raw["stepType"] !== "drelwickRevisionState") {
        const applied = Step.fromJSON(editorialManuscriptSchema, raw).apply(
          doc,
        );
        if (!applied.doc || applied.failed) throw fail();
        doc = applied.doc;
        continue;
      }
      const id = raw["eventId"],
        direction = raw["direction"];
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw fail();
      const before = raw["beforeState"] as RevisionState,
        after = raw["afterState"] as RevisionState;
      ChapterFileV2Schema.parse({ ...chapter, ...before });
      ChapterFileV2Schema.parse({ ...chapter, ...after });
      if (direction === "forward") {
        if (!same(state, before) || events.has(id)) throw fail();
        const intent = raw["intent"] as {
          kind: string;
          options?: RevisionEditOptions;
        };
        if (intent.kind === "edit" && intent.options) {
          if (
            intent.options.continuationId &&
            (state.review.mode !== "track" ||
              !intent.options.typingUnit ||
              session.revisionTyping?.get(intent.options.typingUnit) !==
                intent.options.continuationId)
          )
            throw fail();
          const plan = normalizeRevision(
            state,
            doc.toJSON() as Record<string, unknown>,
            intent.options,
          );
          if (
            plan.requiresCombine &&
            !same(
              [...plan.affectedIds].sort(),
              [...(intent.options.combineIds ?? [])].sort(),
            )
          )
            throw fail();
          if (!same(plan.state, after)) throw fail();
          if (intent.options.typingUnit) {
            const group = after.review.pending.find(
              (group) =>
                group.id ===
                (intent.options!.continuationId ?? intent.options!.id),
            );
            if (group)
              (session.revisionTyping ??= new Map()).set(
                intent.options.typingUnit,
                group.id,
              );
            while ((session.revisionTyping?.size ?? 0) > 1000)
              session.revisionTyping!.delete(
                session.revisionTyping!.keys().next().value!,
              );
          }
        } else if (intent.kind === "mode") {
          if (
            !same(
              {
                ...state,
                review: { ...state.review, mode: after.review.mode },
              },
              after,
            )
          )
            throw fail();
        } else throw fail();
        events.set(id, {
          before: structuredClone(before),
          after: structuredClone(after),
        });
        state = after;
      } else {
        const event = events.get(id);
        if (!event || !same(event, { before, after })) throw fail();
        const expected =
          direction === "undo" ? after : direction === "redo" ? before : null;
        if (!expected || !same(state, expected)) throw fail();
        state = direction === "undo" ? before : after;
      }
    }
    const projection = decodeEditorialDocument(state.review.proposed);
    if (
      !doc.eq(projection) &&
      !(
        projection.content.size === 0 &&
        doc.childCount === 1 &&
        doc.firstChild?.type.name === "paragraph" &&
        doc.firstChild.content.size === 0
      )
    )
      throw fail();
  }
  if (!doc.eq(decodeEditorialDocument(document))) throw fail();
  let size = 0;
  for (const [id, event] of [...events].reverse()) {
    size += JSON.stringify(event).length * 2;
    if (size > 128 * 1024 ** 2 || events.size > 10_000) events.delete(id);
  }
  return state;
}
