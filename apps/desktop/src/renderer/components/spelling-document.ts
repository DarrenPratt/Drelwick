import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { SpellingWordSchema } from "@drelwick/shared";

export interface SpellingOccurrence {
  word: string;
  from: number;
  to: number;
}

/** Join marked text within a textblock, but never across inline atoms or blocks. */
export function spellingWords(doc: Node) {
  const words: SpellingOccurrence[] = [];
  let skipped = 0;
  doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, "", "\ufffc");
    for (const match of text.matchAll(
      /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu,
    )) {
      const word = match[0];
      if (!SpellingWordSchema.safeParse(word).success) {
        skipped++;
        continue;
      }
      const from = position + 1 + match.index;
      words.push({ word, from, to: from + word.length });
    }
    return false;
  });
  return { words, skipped };
}

/** Refuse stale reviews; one ordinary, separately undoable editor transaction. */
export function replaceSpelling(
  editor: Editor,
  reviewed: Node,
  occurrence: SpellingOccurrence,
  replacement: string,
): boolean {
  if (
    editor.isDestroyed ||
    !editor.isEditable ||
    editor.state.doc !== reviewed ||
    reviewed.textBetween(occurrence.from, occurrence.to) !== occurrence.word ||
    !replacement
  )
    return false;
  editor.view.dispatch(
    closeHistory(editor.state.tr).replaceWith(
      occurrence.from,
      occurrence.to,
      editor.schema.text(
        replacement,
        reviewed
          .resolve(occurrence.from)
          .marksAcross(reviewed.resolve(occurrence.to)) ?? [],
      ),
    ),
  );
  // Separate subsequent typing from this explicit replacement as well.
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}
