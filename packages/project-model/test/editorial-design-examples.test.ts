// #169 design conformance only. These schemas are deliberately NOT runtime exports.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  ProjectConfigV2Schema,
  ProjectConfigSchema,
  ChapterFileV1Schema,
  BookMetadataSchema,
  ManuscriptDocumentSchema,
} from "../src/index.js";

const root = new URL("../../../docs/examples/editorial-v1/", import.meta.url);
const read = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const time = z.iso.datetime({ precision: 3 });
const counter = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const position = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z
  .string()
  .refine(
    (value) =>
      !value.includes(String.fromCharCode(0)) &&
      !/[\uD800-\uDFFF]/u.test(value),
  );
const stamps = { created: time, modified: time };
const slice = z.strictObject({
  content: z.array(z.record(z.string(), z.unknown())),
  openStart: position,
  openEnd: position,
});
const group = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  kind: z.enum(["insert", "delete", "replace", "format"]),
  ...stamps,
  authorLabel: text.nullable(),
  baseHash: hash,
  from: position,
  to: position,
  before: slice,
  after: slice,
  supersedes: z.array(uuid),
});
const review = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["off", "track"]),
  proposed: ManuscriptDocumentSchema,
  pending: z.array(group).max(1000),
});
const chapter = ChapterFileV1Schema.extend({
  schemaVersion: z.literal(2),
  revision: counter,
  content: ManuscriptDocumentSchema,
  review,
}).strict();
const project = ProjectConfigV2Schema.extend({
  schemaVersion: z.literal(3),
  generation: counter,
  editorialFile: z.literal("editorial/state.json"),
}).strict();
const format = z.strictObject({
  schemaVersion: z.literal(2),
  projectId: uuid,
  bookSchemaVersion: z.literal(1),
  chapterSchemaVersion: z.literal(2),
  editorialSchemaVersion: z.literal(1),
  sliceCodec: z.literal("semantic-slice-v1"),
  hashCodec: z.literal("canonical-json-v1"),
});
const evidence = z.strictObject({
  chapterId: uuid,
  documentHash: hash,
  from: position,
  to: position,
  slice,
  prefix: text,
  suffix: text,
});
const segment = z.strictObject({
  chapterId: uuid,
  chapterRevision: counter,
  documentHash: hash,
  from: position,
  to: position,
  pointAffinity: z.literal("right"),
});
const lost = z.strictObject({
  evidence,
  reason: z.enum([
    "deleted-text",
    "deleted-chapter",
    "history-restore",
    "snapshot-restore",
    "superseded-revision",
    "external-change",
  ]),
  revisionGroupId: uuid.nullable(),
});
const anchor = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  ...stamps,
  deletedAt: time.nullable(),
  status: z.enum(["attached", "partial", "orphaned", "unverified"]),
  original: evidence,
  segments: z.array(segment).max(10000),
  lost: z.array(lost),
});
const comment = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  body: text.refine((s) => [...s].length <= 100000),
  authorLabel: text.nullable(),
  ...stamps,
  deletedAt: time.nullable(),
});
const thread = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  state: z.enum(["open", "resolved"]),
  resolvedAt: time.nullable(),
  ...stamps,
  deletedAt: time.nullable(),
  comments: z.array(comment).max(10000),
});
const annotation = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  anchorId: uuid,
  threadId: uuid,
  kind: z.enum(["comment", "note", "highlight"]),
  colour: z.enum(["yellow", "blue", "green", "pink"]).nullable(),
  ...stamps,
  deletedAt: time.nullable(),
});
const state = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: uuid,
  generation: counter,
  anchors: z.array(anchor),
  annotations: z.array(annotation).max(100000),
  threads: z.array(thread),
});
const path = z
  .string()
  .refine(
    (value) =>
      value.length > 0 &&
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes(":") &&
      value
        .split("/")
        .every((part) => part !== ".." && part !== "." && part !== ""),
  );
const image = z.strictObject({ size: position, sha256: hash });
const file = image.extend({ path });
const snapshot = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("manuscript-snapshot"),
  id: uuid,
  projectId: uuid,
  created: time,
  label: text.refine((s) => s.trim().length > 0 && [...s].length <= 500),
  reason: z.enum(["named", "before-review", "before-restore"]),
  generation: counter,
  chapterOrder: z.array(uuid),
  files: z.array(file).max(10000),
  absent: z.array(path),
  exclusions: z.array(
    z.enum([
      "reference",
      "application-settings",
      "other-snapshots",
      "periodic-history",
    ]),
  ),
});
const transaction = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  projectId: uuid,
  kind: z.enum([
    "edit",
    "annotation",
    "review",
    "structure",
    "restore",
    "migration",
  ]),
  created: time,
  owner: z.strictObject({
    host: text,
    processId: counter,
    processStarted: time,
  }),
  phase: z.enum([
    "prepared",
    "committed",
    "rolling-back",
    "rolled-back",
    "rolling-forward",
    "complete",
  ]),
  expectedGeneration: counter,
  nextGeneration: counter,
  files: z.array(
    z.strictObject({ path, before: image.nullable(), after: image.nullable() }),
  ),
  decisions: z.array(
    z.strictObject({
      chapterId: uuid,
      groupId: uuid,
      action: z.enum(["accept", "reject", "supersede"]),
      replacementGroupId: uuid.nullable(),
    }),
  ),
});
const draft = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  projectId: uuid,
  created: time,
  baseGeneration: counter,
  editorGeneration: counter,
  baseInventoryHash: hash,
  files: z.array(file),
});
const conflict = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  projectId: uuid,
  sourceGeneration: counter,
  restoredSnapshotId: uuid,
  created: time,
  entries: z.array(
    z.strictObject({
      annotation,
      anchor,
      thread,
      reason: z.enum(["current-only", "different-version"]),
      disposition: z.enum(["unresolved", "copied", "reattached", "discarded"]),
    }),
  ),
});

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => {
                const left = [...a],
                  right = [...b];
                for (let i = 0; i < Math.min(left.length, right.length); i++) {
                  const d =
                    left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
                  if (d) return d;
                }
                return left.length - right.length;
              })
              .map(([key, child]) => [key, sort(child)]),
          )
        : item;
  return JSON.stringify(sort(value));
}
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

it("validates strict runtime v3 and cross-file identity, generation, hashes and ownership", async () => {
  const p = project.parse(await read("project/project.json"));
  const f = format.parse(await read("project/format.json"));
  BookMetadataSchema.parse(await read("project/book.json"));
  const c = chapter.parse(
    await read(`project/manuscript/${p.manuscript.order[0]}.json`),
  );
  const e = state.parse(await read("project/editorial/state.json"));
  expect(ProjectConfigSchema.safeParse(p).success).toBe(true);
  expect(ChapterFileV1Schema.safeParse(c).success).toBe(false);
  expect(f.projectId).toBe(p.projectId);
  expect(e.projectId).toBe(p.projectId);
  expect(e.generation).toBe(p.generation);
  const ids = [
    ...e.anchors,
    ...e.annotations,
    ...e.threads,
    ...e.threads.flatMap((t) => t.comments),
    ...c.review.pending,
  ].map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const a of e.annotations) {
    expect(e.anchors.some((item) => item.id === a.anchorId)).toBe(true);
    expect(e.threads.some((item) => item.id === a.threadId)).toBe(true);
  }
  for (const a of e.anchors)
    for (const s of a.segments) {
      expect(s.chapterId).toBe(c.id);
      expect(s.chapterRevision).toBe(c.revision);
      expect(s.documentHash).toBe(digest(canonical(c.review.proposed)));
      expect(s.from).toBeLessThanOrEqual(s.to);
    }
  for (const g of c.review.pending)
    expect(g.baseHash).toBe(digest(canonical(c.content)));
  for (const [schema, value] of [
    [project, p],
    [chapter, c],
    [state, e],
    [format, f],
  ] as const) {
    expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...value, schemaVersion: 99 }).success).toBe(
      false,
    );
  }
});

it("verifies exact snapshot, journal before/after and draft inventories against the synthetic bytes", async () => {
  const s = snapshot.parse(await read("snapshot.json"));
  expect(s.files.map((item) => item.path)).toEqual(
    s.files.map((item) => item.path).sort(),
  );
  expect(new Set(s.files.map((item) => item.path)).size).toBe(s.files.length);
  const verify = async (folder: string, item: z.infer<typeof file>) => {
    const bytes = await readFile(new URL(`${folder}/${item.path}`, root));
    expect(bytes.length).toBe(item.size);
    expect(digest(bytes)).toBe(item.sha256);
  };
  for (const item of s.files) await verify("project", item);
  const t = transaction.parse(await read("transaction.json"));
  expect(t.nextGeneration).toBe(t.expectedGeneration + 1);
  for (const item of t.files) {
    expect(item.before || item.after).toBeTruthy();
    if (item.before)
      await verify("before", { path: item.path, ...item.before });
    if (item.after) await verify("project", { path: item.path, ...item.after });
  }
  const d = draft.parse(await read("draft.json"));
  expect(d.baseGeneration).toBe(t.expectedGeneration);
  expect(d.baseInventoryHash).toBe(
    digest(
      canonical(t.files.map((item) => ({ path: item.path, ...item.before }))),
    ),
  );
  for (const item of d.files) await verify("project", item);
  const conflicts = conflict.parse(await read("restore-conflict.json"));
  expect(conflicts.restoredSnapshotId).toBe(s.id);
  expect(conflicts.entries[0]?.thread.comments[0]?.body).toContain(
    "PRIVATE_CONFLICT_CANARY",
  );
  expect(path.safeParse("../manuscript.json").success).toBe(false);
  expect(path.safeParse("C:/outside.json").success).toBe(false);
});

it("covers the complete documented scenario register with explicit expected outcomes", async () => {
  const catalogue = z
    .strictObject({
      schemaVersion: z.literal(1),
      cases: z.array(
        z.strictObject({
          id: z.string().regex(/^[ARFSCEM][0-9]{2}$/),
          input: z.string().min(1),
          expected: z.string().min(1),
          owner: z.string().min(1),
        }),
      ),
      mapCases: z.array(
        z.strictObject({
          id: z.string(),
          range: z.tuple([position, position]),
          map: z.tuple([position, position, position]),
          expected: z.tuple([position, position]),
        }),
      ),
    })
    .parse(await read("cases.json"));
  const design = await readFile(
    new URL("../../planning/169-editorial-delivery.md", root),
    "utf8",
  );
  const ids = [...design.matchAll(/^\| ([ARFSCEM][0-9]{2})\s*\|/gm)].map(
    (match) => match[1],
  );
  expect(catalogue.cases.map((item) => item.id)).toEqual(ids);
  expect(new Set(ids).size).toBe(35);
  const variants = z
    .strictObject({
      schemaVersion: z.literal(1),
      base: ManuscriptDocumentSchema,
      groups: z.array(group),
      expectedText: z.array(z.string()),
    })
    .parse(await read("revision-groups.json"));
  expect(variants.groups.map((g) => g.kind)).toEqual([
    "delete",
    "replace",
    "format",
  ]);
});
