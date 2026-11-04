import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ReplaceStep, Transform } from "@tiptap/pm/transform";
import type { Node, Slice, Fragment } from "@tiptap/pm/model";
import {
  decodeEditorialDocument,
  decodeEditorialSlice,
  isEditorialDocumentBoundary,
} from "./editorial-codec.js";

export interface RevisionSlice {
  content: Record<string, unknown>[];
  openStart: number;
  openEnd: number;
}
export interface RevisionGroup {
  schemaVersion: 1;
  id: string;
  kind: "insert" | "delete" | "replace" | "format";
  created: string;
  modified: string;
  authorLabel: string | null;
  baseHash: string;
  from: number;
  to: number;
  before: RevisionSlice;
  after: RevisionSlice;
  supersedes: string[];
}
export interface RevisionReview {
  schemaVersion: 1;
  mode: "off" | "track";
  proposed: Record<string, unknown>;
  pending: RevisionGroup[];
}
export function canonicalRevisionJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalRevisionJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalRevisionJson(item)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export const revisionDocumentHash = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(canonicalRevisionJson(value))));
export const revisionSlice = (slice: Slice): RevisionSlice => ({
  content: slice.content.toJSON() ?? [],
  openStart: slice.openStart,
  openEnd: slice.openEnd,
});
/** Text and atom identity, excluding structural styling and marks. */
export function revisionTextAtoms(node: Node | Fragment): string {
  const items: unknown[] = [];
  node.descendants((child) => {
    if (child.isText) items.push(child.text);
    else if (child.isLeaf)
      items.push({ type: child.type.name, attrs: child.attrs });
  });
  // Adjacent marked text runs must have the same signature as unmarked text.
  return canonicalRevisionJson(
    items.reduce<unknown[]>((out, item) => {
      if (typeof item === "string" && typeof out.at(-1) === "string")
        out[out.length - 1] = String(out.at(-1)) + item;
      else out.push(item);
      return out;
    }, []),
  );
}
export function projectRevisionDocument(
  content: Record<string, unknown>,
  groups: readonly RevisionGroup[],
): Node {
  const transform = new Transform(decodeEditorialDocument(content));
  for (const group of [...groups].reverse())
    transform.step(
      new ReplaceStep(group.from, group.to, decodeEditorialSlice(group.after)),
    );
  return transform.doc;
}
export function validateRevisionReview(
  content: Record<string, unknown>,
  review: RevisionReview,
): void {
  const base = decodeEditorialDocument(content),
    hash = revisionDocumentHash(content);
  const ids = new Set(review.pending.map((group) => group.id));
  if (ids.size !== review.pending.length) throw new Error("REVISION_INVALID");
  let previous: RevisionGroup | undefined;
  for (const group of review.pending) {
    if (
      group.baseHash !== hash ||
      group.from > group.to ||
      group.to > base.content.size ||
      !isEditorialDocumentBoundary(base, group.from) ||
      !isEditorialDocumentBoundary(base, group.to) ||
      (previous && previous.to >= group.from) ||
      group.supersedes.some((id) => ids.has(id))
    )
      throw new Error("REVISION_INVALID");
    const before = base.slice(group.from, group.to),
      after = decodeEditorialSlice(group.after);
    if (
      canonicalRevisionJson(revisionSlice(before)) !==
        canonicalRevisionJson(group.before) ||
      before.eq(after)
    )
      throw new Error("REVISION_INVALID");
    if (
      (group.kind === "insert" &&
        (group.from !== group.to || before.size !== 0 || after.size === 0)) ||
      (group.kind === "delete" && (before.size === 0 || after.size !== 0)) ||
      (group.kind === "replace" && (before.size === 0 || after.size === 0)) ||
      (group.kind === "format" &&
        (before.size === 0 ||
          after.size === 0 ||
          revisionTextAtoms(before.content) !==
            revisionTextAtoms(after.content)))
    )
      throw new Error("REVISION_INVALID");
    previous = group;
  }
  const proposed = decodeEditorialDocument(review.proposed);
  if (!projectRevisionDocument(content, review.pending).eq(proposed))
    throw new Error("REVISION_INVALID");
  let shift = 0;
  for (const group of review.pending) {
    const from = group.from + shift,
      size = decodeEditorialSlice(group.after).size;
    if (
      !isEditorialDocumentBoundary(proposed, from) ||
      !isEditorialDocumentBoundary(proposed, from + size)
    )
      throw new Error("REVISION_INVALID");
    shift += size - (group.to - group.from);
  }
}
