import { Step } from "@tiptap/pm/transform";
import {
  decodeEditorialDocument,
  editorialManuscriptSchema,
  isEditorialDocumentBoundary,
  type EditorialAnchor,
  type EditorialLostSegment,
  type EditorialState,
} from "@drelwick/project-model";
import {
  captureEditorialUndo,
  applyEditorialUndo,
  type EditorialUndoDelta,
} from "./editorial-undo.js";
import { ApplicationError } from "@drelwick/shared";
import { editorialDocumentHash } from "./editorial-bundle.js";
import {
  mapEditorialAnchors,
  type RemovedEditorialRange,
} from "./editorial-anchors.js";

export interface EditorialEditorTransaction {
  before: Record<string, unknown>;
  steps: Record<string, unknown>[];
}

type UndoRecord = EditorialUndoDelta["changes"][number]["before"];
type Collection = EditorialUndoDelta["changes"][number]["collection"];
interface FieldPatch {
  path: (string | number)[];
  before: unknown;
  after: unknown;
}
type CompanionChange = {
  collection: Collection;
  id: string;
  beforeHash: string;
  afterHash: string;
} & (
  | { kind: "record"; before: UndoRecord; after: UndoRecord }
  | { kind: "fields"; patches: FieldPatch[] }
);
interface CompanionDelta {
  projectId: string;
  changes: CompanionChange[];
}
interface CompanionEvent {
  beforeHash: string;
  afterHash: string;
  delta: CompanionDelta;
  size?: number;
}
export interface EditorialReplaySession {
  events: Map<string, CompanionEvent>;
  modified: Map<string, string>;
  result?: EditorialState;
}
const sessions = new Map<string, EditorialReplaySession>();
export function captureEditorialReplaySession(
  key: string,
): EditorialReplaySession {
  return structuredClone(
    sessions.get(key) ?? { events: new Map(), modified: new Map() },
  );
}
export function acknowledgeEditorialReplaySession(
  key: string,
  session: EditorialReplaySession,
): void {
  delete session.result;
  sessions.delete(key);
  sessions.set(key, session);
  while (sessions.size > 1) sessions.delete(sessions.keys().next().value!);
}
function anchorState(anchors: readonly EditorialAnchor[]) {
  return {
    schemaVersion: 1 as const,
    projectId: "session",
    generation: 1,
    anchors: [...anchors],
    annotations: [],
    threads: [],
  };
}
function records(state: EditorialState) {
  return [...state.anchors, ...state.annotations, ...state.threads];
}
function comparable(value: unknown): string {
  const normalize = (item: unknown, key = ""): unknown => {
    if (Array.isArray(item)) return item.map((entry) => normalize(entry, key));
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item)
        .filter(
          ([name]) =>
            name !== "modified" &&
            !(
              key === "segments" &&
              ["chapterRevision", "documentHash"].includes(name)
            ),
        )
        .map(([name, entry]) => [name, normalize(entry, name)]),
    );
  };
  return editorialDocumentHash(normalize(value));
}
function compactDelta(delta: EditorialUndoDelta): CompanionDelta {
  const changes: CompanionChange[] = [];
  for (const change of delta.changes) {
    const beforeHash = comparable(change.before),
      afterHash = comparable(change.after);
    if (beforeHash === afterHash) continue;
    const base = {
      collection: change.collection,
      id: change.id,
      beforeHash,
      afterHash,
    };
    if (!change.before || !change.after) {
      changes.push({
        ...base,
        kind: "record",
        before: change.before,
        after: change.after,
      });
      continue;
    }
    const patches: FieldPatch[] = [];
    const diff = (
      before: unknown,
      after: unknown,
      path: (string | number)[],
    ) => {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      if (Array.isArray(before) && Array.isArray(after)) {
        for (
          let index = 0;
          index < Math.max(before.length, after.length);
          index++
        )
          diff(before[index], after[index], [...path, index]);
        if (before.length !== after.length)
          patches.push({
            path: [...path, "length"],
            before: before.length,
            after: after.length,
          });
      } else if (
        before &&
        after &&
        typeof before === "object" &&
        typeof after === "object" &&
        !Array.isArray(before) &&
        !Array.isArray(after)
      ) {
        const left = before as Record<string, unknown>,
          right = after as Record<string, unknown>;
        for (const key of new Set([
          ...Object.keys(left),
          ...Object.keys(right),
        ])) {
          if (
            key === "modified" ||
            (path[0] === "segments" &&
              ["chapterRevision", "documentHash"].includes(key))
          )
            continue;
          diff(left[key], right[key], [...path, key]);
        }
      } else patches.push({ path, before, after });
    };
    diff(change.before, change.after, []);
    changes.push({ ...base, kind: "fields", patches });
  }
  return { projectId: delta.projectId, changes };
}
function patchedRecord(
  record: UndoRecord,
  patches: FieldPatch[],
  direction: "undo" | "redo",
): UndoRecord {
  if (!record) throw new Error("EDITORIAL_STALE");
  const target = structuredClone(record);
  for (const patch of patches) {
    let parent = target as unknown as Record<string | number, unknown>;
    for (const key of patch.path.slice(0, -1)) {
      if (["__proto__", "prototype", "constructor"].includes(String(key)))
        throw new Error("EDITORIAL_INVALID");
      const next = parent[key];
      if (!next || typeof next !== "object") throw new Error("EDITORIAL_STALE");
      parent = next as Record<string | number, unknown>;
    }
    const key = patch.path.at(-1);
    if (
      key === undefined ||
      ["__proto__", "prototype", "constructor"].includes(String(key))
    )
      throw new Error("EDITORIAL_INVALID");
    const value = direction === "undo" ? patch.before : patch.after;
    if (value === undefined) delete parent[key];
    else parent[key] = structuredClone(value);
  }
  return target;
}

function retainEvent(
  session: EditorialReplaySession,
  id: string,
  event: CompanionEvent,
) {
  event.size = JSON.stringify(event).length * 2;
  session.events.set(id, event);
  let size = [...session.events.values()].reduce(
    (sum, item) => sum + (item.size ?? 0),
    0,
  );
  while (session.events.size > 10_000 || size > 128 * 1024 ** 2) {
    const first = session.events.keys().next().value!;
    size -= session.events.get(first)?.size ?? 0;
    session.events.delete(first);
  }
}
export function registerEditorialMetadataEvent(
  key: string,
  id: string,
  document: Record<string, unknown>,
  before: EditorialState,
  after: EditorialState,
): void {
  const session = captureEditorialReplaySession(key);
  if (session.events.has(id)) return;
  retainEvent(session, id, {
    beforeHash: editorialDocumentHash(
      decodeEditorialDocument(document).toJSON(),
    ),
    afterHash: editorialDocumentHash(
      decodeEditorialDocument(document).toJSON(),
    ),
    delta: compactDelta(captureEditorialUndo(before, after)),
  });
  for (const record of records(after))
    session.modified.set(record.id, record.modified);
  acknowledgeEditorialReplaySession(key, session);
}

/** Replay bounded transport steps against saved bytes; never execute stored plugin payloads. */
export function replayEditorialEdits(input: {
  chapterId: string;
  revision: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  anchors: readonly EditorialAnchor[];
  transactions: readonly EditorialEditorTransaction[];
  session?: EditorialReplaySession;
  state?: EditorialState;
}): EditorialAnchor[] {
  const invalid = () =>
    new ApplicationError(
      "EDITORIAL_STALE",
      "The saved chapter and captured edits do not match. Your edits remain unsaved.",
    );
  if (
    input.transactions.length > 128 ||
    input.transactions.reduce((n, item) => n + item.steps.length, 0) > 4096
  )
    throw invalid();
  let doc = decodeEditorialDocument(input.before);
  let sourceHash = editorialDocumentHash(input.before);
  let documentHash = editorialDocumentHash(doc.toJSON());
  // The existing editor presents legacy empty documents as one empty paragraph.
  // Permit that initialization only when no live editorial target can be moved.
  const firstBefore = input.transactions[0]?.before;
  if (
    doc.content.size === 0 &&
    firstBefore &&
    !input.anchors.some((anchor) =>
      anchor.segments.some((segment) => segment.chapterId === input.chapterId),
    )
  ) {
    const initial = decodeEditorialDocument(firstBefore);
    if (
      initial.childCount === 1 &&
      initial.firstChild?.type.name === "paragraph" &&
      initial.firstChild.content.size === 0
    ) {
      doc = initial;
      documentHash = editorialDocumentHash(doc.toJSON());
    }
  }
  let anchors = structuredClone([...input.anchors]);
  const session = input.session ?? {
    events: new Map<string, CompanionEvent>(),
    modified: new Map<string, string>(),
  };
  let working = structuredClone(input.state ?? anchorState(input.anchors));
  const currentState = (): EditorialState => ({
    ...working,
    anchors: [...anchors],
  });
  // Only history touching externally changed records becomes unavailable.
  for (const record of records(currentState())) {
    const expected = session.modified.get(record.id);
    if (expected && expected !== record.modified)
      for (const [id, event] of session.events)
        if (event.delta.changes.some((change) => change.id === record.id))
          session.events.delete(id);
  }
  const restore = (
    event: CompanionEvent,
    direction: "undo" | "redo",
    source: EditorialState,
  ) => {
    for (const change of event.delta.changes) {
      const expectedHash =
        direction === "undo" ? change.afterHash : change.beforeHash;
      const actual =
        source[change.collection].find((record) => record.id === change.id) ??
        null;
      if (expectedHash !== comparable(actual)) throw invalid();
    }
    const current = currentState();
    const rebased: EditorialUndoDelta = {
      projectId: current.projectId,
      changes: event.delta.changes.map((change) => {
        const actual =
          current[change.collection].find(
            (record) => record.id === change.id,
          ) ?? null;
        const target =
          change.kind === "record"
            ? structuredClone(
                direction === "undo" ? change.before : change.after,
              )
            : patchedRecord(actual, change.patches, direction);
        if (target)
          target.modified = new Date(
            Math.max(Date.now(), Date.parse(target.modified)),
          ).toISOString();
        return {
          ...change,
          before: direction === "undo" ? target : actual,
          after: direction === "undo" ? actual : target,
        };
      }),
    };
    working = applyEditorialUndo(current, rebased, direction);
    anchors = working.anchors;
  };
  let pending: CompanionEvent | null = null;
  let pendingSource = currentState();
  for (const transaction of input.transactions) {
    if (!doc.eq(decodeEditorialDocument(transaction.before))) throw invalid();
    let groupBeforeHash = documentHash;
    let groupState = structuredClone(currentState());
    for (const raw of transaction.steps) {
      if (raw["stepType"] === "drelwickEditorialHistory") {
        if (pending) {
          if (documentHash !== pending.beforeHash) throw invalid();
          restore(pending, "undo", pendingSource);
          pending = null;
          groupBeforeHash = documentHash;
          groupState = structuredClone(currentState());
        }
        const id = raw["eventId"];
        const direction = raw["direction"];
        if (
          typeof id !== "string" ||
          !/^[0-9a-f-]{36}$/.test(id) ||
          pending ||
          Object.keys(raw).some(
            (key) => !["stepType", "eventId", "direction"].includes(key),
          )
        )
          throw invalid();
        if (direction === "forward") {
          if (session.events.has(id)) throw invalid();
          retainEvent(session, id, {
            beforeHash: groupBeforeHash,
            afterHash: documentHash,
            delta: compactDelta(
              captureEditorialUndo(groupState, currentState()),
            ),
          });
        } else {
          const event = session.events.get(id);
          if (!event)
            throw new ApplicationError(
              "EDITORIAL_STALE",
              "The annotation undo event is unavailable or changed outside this history. Your draft and the previous saved version are preserved.",
            );
          if (direction === "undo") {
            if (documentHash !== event.afterHash) throw invalid();
            pending = event;
            pendingSource = structuredClone(currentState());
          } else if (direction === "redo") {
            if (
              documentHash !== event.afterHash ||
              groupBeforeHash !== event.beforeHash
            )
              throw invalid();
            restore(event, "redo", groupState);
          } else throw invalid();
        }
        groupBeforeHash = documentHash;
        groupState = structuredClone(currentState());
        continue;
      }
      if (
        ![
          "replace",
          "replaceAround",
          "addMark",
          "removeMark",
          "addNodeMark",
          "removeNodeMark",
          "attr",
        ].includes(String(raw["stepType"]))
      )
        throw invalid();
      const step = Step.fromJSON(editorialManuscriptSchema, raw);
      const applied = step.apply(doc);
      if (applied.failed || !applied.doc) throw invalid();
      // Full semantic validation after every step prevents unsupported attributes,
      // invalid marks or dropped data from entering the authoritative bundle.
      const next = decodeEditorialDocument(applied.doc.toJSON());
      const map = step.getMap();
      const ranges: Array<{ from: number; to: number }> = [];
      map.forEach((from, to) => {
        if (from < to) ranges.push({ from, to });
      });
      const hash = editorialDocumentHash(next.toJSON());
      if (!pending)
        anchors = anchors.map((anchor) => {
          if (anchor.status === "unverified") return anchor;
          const removed: RemovedEditorialRange[] = [];
          for (const segment of anchor.segments) {
            if (segment.chapterId !== input.chapterId) continue;
            for (const range of ranges) {
              const from = Math.max(segment.from, range.from);
              const to = Math.min(segment.to, range.to);
              if (from >= to) continue;
              const slice = doc.slice(from, to);
              const evidence: EditorialLostSegment["evidence"] = {
                chapterId: input.chapterId,
                documentHash: sourceHash,
                from,
                to,
                slice: {
                  content: (slice.content.toJSON() ?? []) as Record<
                    string,
                    unknown
                  >[],
                  openStart: slice.openStart,
                  openEnd: slice.openEnd,
                },
                prefix: "",
                suffix: "",
              };
              removed.push({ chapterId: input.chapterId, from, to, evidence });
            }
          }
          return mapEditorialAnchors(
            [anchor],
            input.chapterId,
            input.revision,
            hash,
            map,
            removed,
          )[0]!;
        });
      doc = next;
      documentHash = hash;
      sourceHash = hash;
    }
    if (pending) {
      if (documentHash !== pending.beforeHash) throw invalid();
      restore(pending, "undo", pendingSource);
      pending = null;
    }
  }
  if (pending) throw invalid();
  if (!doc.eq(decodeEditorialDocument(input.after))) throw invalid();
  const hash = editorialDocumentHash(input.after);
  const result = anchors.map((anchor): EditorialAnchor => {
    const invalidBoundary = anchor.segments.some(
      (segment) =>
        segment.chapterId === input.chapterId &&
        (!isEditorialDocumentBoundary(doc, segment.from) ||
          !isEditorialDocumentBoundary(doc, segment.to)),
    );
    if (invalidBoundary) return { ...anchor, status: "unverified" };
    return {
      ...anchor,
      segments: anchor.segments.map((segment) =>
        segment.chapterId !== input.chapterId || anchor.status === "unverified"
          ? segment
          : { ...segment, chapterRevision: input.revision, documentHash: hash },
      ),
    };
  });
  session.result = { ...working, anchors: result };
  for (const record of records(session.result))
    session.modified.set(record.id, record.modified);
  return result;
}
