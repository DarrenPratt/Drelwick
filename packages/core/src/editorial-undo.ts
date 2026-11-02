import type { EditorialState } from "@drelwick/project-model";

type Collection = "anchors" | "annotations" | "threads";
type RecordValue = EditorialState[Collection][number];
export interface EditorialUndoChange {
  collection: Collection;
  id: string;
  before: RecordValue | null;
  after: RecordValue | null;
}
export interface EditorialUndoDelta {
  projectId: string;
  changes: EditorialUndoChange[];
}

const collections: Collection[] = ["anchors", "annotations", "threads"];
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Capture touched identities only, never a replacement copy of shared state. */
export function captureEditorialUndo(
  before: EditorialState,
  after: EditorialState,
): EditorialUndoDelta {
  if (before.projectId !== after.projectId)
    throw new Error("EDITORIAL_INVALID");
  const changes: EditorialUndoChange[] = [];
  for (const collection of collections) {
    const left = new Map(before[collection].map((item) => [item.id, item]));
    const right = new Map(after[collection].map((item) => [item.id, item]));
    for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const oldValue = left.get(id) ?? null;
      const newValue = right.get(id) ?? null;
      if (!same(oldValue, newValue))
        changes.push({
          collection,
          id,
          before: structuredClone(oldValue),
          after: structuredClone(newValue),
        });
    }
  }
  return { projectId: before.projectId, changes };
}

/** Pure companion replay. Persistent counters advance separately on commit. */
export function applyEditorialUndo(
  state: EditorialState,
  delta: EditorialUndoDelta,
  direction: "undo" | "redo",
): EditorialState {
  if (state.projectId !== delta.projectId) throw new Error("EDITORIAL_INVALID");
  const identities = new Set<string>();
  for (const change of delta.changes) {
    const identity = `${change.collection}:${change.id}`;
    if (!collections.includes(change.collection) || identities.has(identity))
      throw new Error("EDITORIAL_INVALID");
    identities.add(identity);
    const expected = direction === "undo" ? change.after : change.before;
    const actual =
      state[change.collection].find((item) => item.id === change.id) ?? null;
    if (!same(actual, expected)) throw new Error("EDITORIAL_STALE");
  }
  const result = structuredClone(state);
  for (const change of delta.changes) {
    const target = direction === "undo" ? change.before : change.after;
    const records = result[change.collection] as RecordValue[];
    const index = records.findIndex((item) => item.id === change.id);
    if (target === null) {
      if (index >= 0) records.splice(index, 1);
    } else if (index < 0) records.push(structuredClone(target));
    else records[index] = structuredClone(target);
  }
  return result;
}
