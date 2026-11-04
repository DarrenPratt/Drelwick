import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  normalizeRevision,
  RevisionStateStep,
  type RevisionState,
  type RevisionEditPlan,
  type RevisionEditOptions,
} from "@drelwick/core/revisions";
import {
  decodeEditorialSlice,
  decodeEditorialDocument,
} from "@drelwick/project-model";

export const revisionKey = new PluginKey<RevisionState | null>(
  "drelwickRevisionTracking",
);
export interface BlockedRevisionEdit {
  plan: RevisionEditPlan;
  transaction: Transaction;
  options: RevisionEditOptions;
  state: RevisionState;
}
export const RevisionTracking = Extension.create<{
  initial: RevisionState | null;
}>({
  name: "drelwickRevisionTracking",
  addOptions: () => ({ initial: null }),
  addProseMirrorPlugins() {
    const initial = this.options.initial;
    let typing: {
      unit: string;
      groupId: string;
      end: number;
      time: number;
      composition: unknown;
    } | null = null;
    return [
      new Plugin<RevisionState | null>({
        key: revisionKey,
        filterTransaction(transaction, state) {
          const current = revisionKey.getState(state);
          if (!transaction.docChanged && transaction.selectionSet)
            typing = null;
          if (
            transaction.steps.some((step) => step instanceof RevisionStateStep)
          ) {
            typing = null;
            const marker = transaction.steps
              .filter(
                (step): step is RevisionStateStep =>
                  step instanceof RevisionStateStep,
              )
              .at(-1)!;
            const target =
              marker.direction === "undo"
                ? marker.beforeState
                : marker.afterState;
            const document = decodeEditorialDocument(target.review.proposed);
            const matches =
              JSON.stringify(document.toJSON()) ===
              JSON.stringify(transaction.doc.toJSON());
            const emptyView =
              document.content.size === 0 &&
              transaction.doc.childCount === 1 &&
              transaction.doc.firstChild?.type.name === "paragraph" &&
              transaction.doc.firstChild.content.size === 0;
            return matches || emptyView;
          }
          if (transaction.doc.eq(state.doc)) return true;
          if (
            !current ||
            !transaction.docChanged ||
            transaction.getMeta("preventUpdate") ||
            transaction.steps.some((step) => step instanceof RevisionStateStep)
          )
            return true;
          try {
            const options: RevisionEditOptions = {
              id: crypto.randomUUID(),
              created: new Date().toISOString(),
              authorLabel: null,
            };
            const raw =
              transaction.steps.length === 1
                ? (transaction.steps[0]!.toJSON() as {
                    stepType?: string;
                    from?: number;
                    to?: number;
                    slice?: { content?: { type: string; text?: string }[] };
                  })
                : null;
            const composition: unknown = transaction.getMeta("composition");
            const typedText = raw?.slice?.content?.every(
              (node) => node.type === "text",
            )
              ? raw.slice.content.map((node) => node.text ?? "").join("")
              : "";
            const isTyping =
              composition !== undefined ||
              (raw?.stepType === "replace" &&
                state.selection.empty &&
                !transaction.getMeta("uiEvent") &&
                ((raw.from === raw.to &&
                  typedText.length > 0 &&
                  typedText.length <= 2) ||
                  (raw.to === state.selection.from &&
                    raw.from === state.selection.from - 1 &&
                    !typedText)));
            if (isTyping) {
              const continued =
                typing &&
                (composition !== undefined
                  ? composition === typing.composition
                  : Date.now() - typing.time < 500 &&
                    state.selection.from === typing.end &&
                    (raw?.from === raw?.to
                      ? raw?.from === typing.end
                      : raw?.to === typing.end)) &&
                current.review.pending.some(
                  (group) => group.id === typing!.groupId,
                );
              options.typingUnit = continued
                ? typing!.unit
                : crypto.randomUUID();
              if (continued) options.continuationId = typing!.groupId;
            } else typing = null;
            const plan = normalizeRevision(
              current,
              transaction.doc.toJSON() as Record<string, unknown>,
              options,
            );
            if (plan.requiresCombine) {
              window.dispatchEvent(
                new CustomEvent("drelwick:revision-combine", {
                  detail: {
                    plan,
                    transaction,
                    options,
                    state: current,
                  } satisfies BlockedRevisionEdit,
                }),
              );
              return false;
            }
            if (isTyping && options.typingUnit) {
              const group = plan.state.review.pending.find(
                (group) => group.id === (options.continuationId ?? options.id),
              );
              typing = group
                ? {
                    unit: options.typingUnit,
                    groupId: group.id,
                    end: transaction.selection.from,
                    time: Date.now(),
                    composition,
                  }
                : null;
            }
            transaction.step(
              new RevisionStateStep(options.id, current, plan.state, {
                kind: "edit",
                options,
              }),
            );
            return true;
          } catch {
            window.dispatchEvent(new CustomEvent("drelwick:revision-error"));
            return false;
          }
        },
        state: {
          init: () => initial,
          apply(transaction, current) {
            const loaded = transaction.getMeta(revisionKey) as
              { state: RevisionState } | undefined;
            if (loaded) return loaded.state;
            for (const step of transaction.steps)
              if (step instanceof RevisionStateStep)
                current =
                  step.direction === "undo"
                    ? step.beforeState
                    : step.afterState;
            return current;
          },
        },
        props: {
          decorations(state) {
            const current = revisionKey.getState(state);
            if (!current) return null;
            let shift = 0;
            const decorations: Decoration[] = [];
            for (const group of current.review.pending) {
              const from = group.from + shift,
                size = decodeEditorialSlice(group.after).size;
              if (size)
                decorations.push(
                  Decoration.inline(from, from + size, {
                    class: `revision-pending revision-${group.kind}`,
                    "aria-label": `Pending ${group.kind}`,
                  }),
                );
              else
                decorations.push(
                  Decoration.widget(
                    from,
                    () => {
                      const span = document.createElement("span");
                      span.className = "revision-deletion";
                      span.textContent = "[Pending deletion]";
                      return span;
                    },
                    { key: group.id, side: -1 },
                  ),
                );
              shift += size - (group.to - group.from);
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
export function loadRevisionState(editor: Editor, state: RevisionState) {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(revisionKey, { state })
      .setMeta("addToHistory", false),
  );
}
