import { EditorialHistoryStep } from "@drelwick/core/editorial-history";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface EditorialDecorationRange {
  from: number;
  to: number;
  annotationId: string;
  kind: "comment" | "note" | "highlight";
  colour: "yellow" | "blue" | "green" | "pink" | null;
}

const key = new PluginKey<readonly EditorialDecorationRange[]>(
  "drelwickEditorial",
);

export const EditorialDecorations = Extension.create({
  name: "drelwickEditorialDecorations",
  onTransaction({ editor, transaction, appendedTransactions }) {
    if (
      transaction.getMeta("preventUpdate") ||
      !transaction.before.eq(editor.state.doc)
    )
      return;
    if (
      [transaction, ...appendedTransactions].some((item) =>
        item.steps.some(
          (step) =>
            step instanceof EditorialHistoryStep &&
            step.direction !== "recorded",
        ),
      )
    )
      editor.emit("update", { editor, transaction, appendedTransactions });
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<readonly EditorialDecorationRange[]>({
        key,
        appendTransaction(transactions, oldState, state) {
          if (
            !transactions.some((transaction) => transaction.docChanged) ||
            transactions.some((transaction) =>
              transaction.steps.some(
                (step) => step instanceof EditorialHistoryStep,
              ),
            ) ||
            transactions.every(
              (transaction) => transaction.getMeta("addToHistory") === false,
            )
          )
            return null;
          let mapped = false;
          for (const transaction of transactions)
            for (const step of transaction.steps)
              step.getMap().forEach((from, to, nextFrom, nextTo) => {
                if (from !== to || nextFrom !== nextTo) mapped = true;
              });
          if (oldState.doc.eq(state.doc) && !mapped) return null;
          return state.tr.step(new EditorialHistoryStep(crypto.randomUUID()));
        },
        state: {
          init: () => [],
          apply(transaction, ranges) {
            const next = transaction.getMeta(key) as
              readonly EditorialDecorationRange[] | undefined;
            if (next) return next;
            // A stale decoration must disappear as soon as manuscript text changes.
            return transaction.docChanged ? [] : ranges;
          },
        },
        props: {
          decorations(state) {
            const ranges = key.getState(state) ?? [];
            return DecorationSet.create(
              state.doc,
              ranges
                .filter(
                  (range) =>
                    range.from < range.to &&
                    range.from >= 0 &&
                    range.to <= state.doc.content.size,
                )
                .map((range) =>
                  Decoration.inline(range.from, range.to, {
                    class: `editorial-annotation editorial-annotation-${range.kind}${range.kind === "highlight" ? ` editorial-highlight-${range.colour ?? "yellow"}` : ""}`,
                    "data-annotation-id": range.annotationId,
                  }),
                ),
            );
          },
        },
      }),
    ];
  },
});

export function setEditorialDecorations(
  editor: Pick<Editor, "state" | "view">,
  ranges: readonly EditorialDecorationRange[],
): void {
  editor.view.dispatch(editor.state.tr.setMeta(key, ranges));
}
