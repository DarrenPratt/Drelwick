const wordPattern = /[\p{L}\p{N}]+(?:['’‑-][\p{L}\p{N}]+)*/gu;

/**
 * Counts words in a TipTap/ProseMirror JSON document.
 * Only text nodes contribute; structural nodes and their presentation do not.
 */
export function countDocumentWords(document: unknown): number {
  const fragments: string[] = [];
  const pending: unknown[] = [document];

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === "\n") {
      fragments.push("\n");
      continue;
    }
    if (typeof node !== "object" || node === null) continue;

    if (
      "type" in node &&
      node.type === "text" &&
      "text" in node &&
      typeof node.text === "string"
    ) {
      fragments.push(node.text);
      continue;
    }

    if ("content" in node && Array.isArray(node.content)) {
      pending.push("\n");
      for (let index = node.content.length - 1; index >= 0; index--)
        pending.push(node.content[index]);
    } else fragments.push("\n");
  }

  return fragments.join("").match(wordPattern)?.length ?? 0;
}
