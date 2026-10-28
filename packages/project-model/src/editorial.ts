import { z } from "zod";
import { ChapterFileSchema } from "./versions/v1.js";
import { ProjectConfigV2Schema } from "./versions/v2.js";
import { ManuscriptDocumentSchema } from "./manuscript-document.js";
import { isSafeRelativePath } from "@drelwick/shared";

const uuid = z.string().uuid();
const time = z.string().datetime({ offset: false });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const position = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const strictDoc = z.custom<z.infer<typeof ManuscriptDocumentSchema>>(
  (value) => ManuscriptDocumentSchema.safeParse(value).success,
);
const slice = z
  .object({
    content: z.array(z.record(z.string(), z.unknown())),
    openStart: position,
    openEnd: position,
  })
  .strict();

export const EditorialEvidenceSchema = z
  .object({
    chapterId: uuid,
    documentHash: hash,
    from: position,
    to: position,
    slice,
    prefix: z.string().max(256),
    suffix: z.string().max(256),
  })
  .strict()
  .refine((v) => v.from <= v.to);
export const EditorialLiveSegmentSchema = z
  .object({
    chapterId: uuid,
    chapterRevision: counter,
    documentHash: hash,
    from: position,
    to: position,
    pointAffinity: z.literal("right"),
  })
  .strict()
  .refine((v) => v.from <= v.to);
export const EditorialLostSegmentSchema = z
  .object({
    evidence: EditorialEvidenceSchema,
    reason: z.enum([
      "deleted-text",
      "deleted-chapter",
      "history-restore",
      "snapshot-restore",
      "superseded-revision",
      "external-change",
    ]),
    revisionGroupId: uuid.nullable(),
  })
  .strict();
export const EditorialAnchorSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    created: time,
    modified: time,
    deletedAt: time.nullable(),
    status: z.enum(["attached", "partial", "orphaned", "unverified"]),
    original: EditorialEvidenceSchema,
    segments: z.array(EditorialLiveSegmentSchema).max(10_000),
    lost: z.array(EditorialLostSegmentSchema).max(10_000),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.created > v.modified ||
      (v.deletedAt !== null && v.deletedAt > v.modified)
    )
      c.addIssue({ code: "custom", message: "Invalid timestamps" });
    if (v.status === "attached" && (!v.segments.length || v.lost.length))
      c.addIssue({ code: "custom", message: "Invalid attached anchor" });
    if (v.status === "partial" && (!v.segments.length || !v.lost.length))
      c.addIssue({ code: "custom", message: "Invalid partial anchor" });
    if (v.status === "orphaned" && (v.segments.length || !v.lost.length))
      c.addIssue({ code: "custom", message: "Invalid orphaned anchor" });
    const ids = v.segments.map((s) => s.chapterId + ":" + s.from + ":" + s.to);
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Duplicate segment" });
  });
export const EditorialCommentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    body: z.string().max(100_000),
    authorLabel: z.string().max(256).nullable(),
    created: time,
    modified: time,
    deletedAt: time.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.created > v.modified ||
      (v.deletedAt !== null && v.deletedAt > v.modified)
    )
      c.addIssue({ code: "custom", message: "Invalid comment timestamps" });
    if (hasInvalidUnicode(v.body))
      c.addIssue({ code: "custom", message: "Comment has invalid Unicode" });
  });
export const EditorialAnnotationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    anchorId: uuid,
    threadId: uuid,
    kind: z.enum(["comment", "note", "highlight"]),
    colour: z.enum(["yellow", "blue", "green", "pink"]).nullable(),
    created: time,
    modified: time,
    deletedAt: time.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.kind === "highlight") !== (v.colour !== null))
      c.addIssue({ code: "custom", message: "Only highlights have colours" });
    if (
      v.created > v.modified ||
      (v.deletedAt !== null && v.deletedAt > v.modified)
    )
      c.addIssue({ code: "custom", message: "Invalid annotation timestamps" });
  });
export const EditorialThreadSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    state: z.enum(["open", "resolved"]),
    resolvedAt: time.nullable(),
    created: time,
    modified: time,
    deletedAt: time.nullable(),
    comments: z.array(EditorialCommentSchema).max(10_000),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.state === "resolved") !== (v.resolvedAt !== null))
      c.addIssue({ code: "custom", message: "Invalid resolution state" });
    if (
      v.created > v.modified ||
      (v.deletedAt !== null && v.deletedAt > v.modified) ||
      (v.resolvedAt !== null &&
        (v.resolvedAt < v.created || v.resolvedAt > v.modified))
    )
      c.addIssue({ code: "custom", message: "Invalid thread timestamps" });
    const ids = v.comments.map((comment) => comment.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Duplicate comment ID" });
  });
export const EditorialStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuid,
    generation: counter,
    anchors: z.array(EditorialAnchorSchema).max(100_000),
    annotations: z.array(EditorialAnnotationSchema).max(100_000),
    threads: z.array(EditorialThreadSchema).max(10_000),
  })
  .strict()
  .superRefine((v, c) => {
    const all = [
      ...v.anchors,
      ...v.annotations,
      ...v.threads,
      ...v.threads.flatMap((thread) => thread.comments),
    ];
    if (new Set(all.map((x) => x.id)).size !== all.length)
      c.addIssue({ code: "custom", message: "Duplicate editorial ID" });
    const a = new Set(v.anchors.map((x) => x.id)),
      t = new Set(v.threads.map((x) => x.id));
    for (const x of v.annotations)
      if (!a.has(x.anchorId) || !t.has(x.threadId))
        c.addIssue({
          code: "custom",
          message: "Dangling annotation ownership",
        });
  });

function hasInvalidUnicode(value: string): boolean {
  if (value.includes(String.fromCharCode(0))) return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
export const ReviewV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["off", "track"]),
    proposed: strictDoc,
    // #170 persists only the empty envelope. #173 owns revision payloads.
    pending: z.array(z.never()).max(1000),
  })
  .strict();
export const ChapterFileV2Schema = ChapterFileSchema.extend({
  schemaVersion: z.literal(2),
  revision: counter,
  review: ReviewV1Schema,
})
  .strict()
  .superRefine((value, context) => {
    if (value.review.mode !== "off")
      context.addIssue({
        code: "custom",
        path: ["review", "mode"],
        message: "Revision tracking is not supported by this version",
      });
    if (JSON.stringify(value.content) !== JSON.stringify(value.review.proposed))
      context.addIssue({
        code: "custom",
        path: ["review", "proposed"],
        message: "Nonempty revision state is not supported by this version",
      });
  });
export const ProjectConfigV3Schema = ProjectConfigV2Schema.extend({
  schemaVersion: z.literal(3),
  generation: counter,
  editorialFile: z.literal("editorial/state.json"),
}).strict();
export const ProjectFormatV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    projectId: uuid,
    bookSchemaVersion: z.literal(1),
    chapterSchemaVersion: z.literal(2),
    editorialSchemaVersion: z.literal(1),
    sliceCodec: z.literal("semantic-slice-v1"),
    hashCodec: z.literal("canonical-json-v1"),
  })
  .strict();

const managedPath = z
  .string()
  .max(1024)
  .refine(
    (value) =>
      isSafeRelativePath(value) &&
      !value.includes("\\") &&
      !value.split("/").some((part) => part === "." || part === ".."),
  );
const imageRef = z
  .object({ size: z.number().int().nonnegative(), sha256: hash })
  .strict();
export const EditorialTransactionSchema = z
  .object({
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
    owner: z
      .object({
        host: z.string().min(1).max(256),
        processId: z.number().int().positive(),
        processStarted: time,
      })
      .strict(),
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
    files: z
      .array(
        z
          .object({
            path: managedPath,
            before: imageRef.nullable(),
            after: imageRef.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
    decisions: z
      .array(
        z
          .object({
            chapterId: uuid,
            groupId: uuid,
            action: z.enum(["accept", "reject", "supersede"]),
            replacementGroupId: uuid.nullable(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.nextGeneration !== value.expectedGeneration + 1)
      context.addIssue({
        code: "custom",
        message: "Invalid generation transition",
      });
    if (value.files.some((file) => file.before === null && file.after === null))
      context.addIssue({
        code: "custom",
        message: "Transaction image is empty",
      });
    const paths = value.files.map((file) => file.path);
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path, index) => index > 0 && paths[index - 1]! >= path)
    )
      context.addIssue({
        code: "custom",
        message: "Transaction paths must be unique and sorted",
      });
    if (
      value.decisions.some(
        (decision) =>
          (decision.action === "supersede") !==
          (decision.replacementGroupId !== null),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Invalid transaction decision",
      });
  });
export type EditorialTransaction = z.infer<typeof EditorialTransactionSchema>;

export const EditorialDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    projectId: uuid,
    created: time,
    baseGeneration: counter,
    editorGeneration: counter,
    baseInventoryHash: hash,
    files: z
      .array(
        z
          .object({
            path: managedPath,
            size: z.number().int().nonnegative(),
            sha256: hash,
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = value.files.map((file) => file.path);
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path, index) => index > 0 && paths[index - 1]! >= path)
    )
      context.addIssue({
        code: "custom",
        message: "Draft paths must be unique and sorted",
      });
  });
export type EditorialState = z.infer<typeof EditorialStateSchema>;
export type ChapterFileV2 = z.infer<typeof ChapterFileV2Schema>;
export type EditorialAnchor = z.infer<typeof EditorialAnchorSchema>;
export type EditorialLostSegment = z.infer<typeof EditorialLostSegmentSchema>;

/** Pure, lossless semantic envelope transform; filesystem commit belongs to core. */
export function migrateChapterV1ToEditorialV2(source: unknown): ChapterFileV2 {
  const chapter = ChapterFileSchema.parse(source);
  const result = {
    ...chapter,
    schemaVersion: 2 as const,
    revision: 1,
    review: {
      schemaVersion: 1 as const,
      mode: "off" as const,
      proposed: chapter.content,
      pending: [],
    },
  };
  return ChapterFileV2Schema.parse(result);
}

export function migrateProjectV2ToEditorialV3(source: unknown) {
  const project = ProjectConfigV2Schema.parse(source);
  const allowed = new Set([
    "schemaVersion",
    "projectId",
    "created",
    "modified",
    "bookFile",
    "formatFile",
    "manuscript",
  ]);
  if (
    Object.keys(source as Record<string, unknown>).some(
      (key) => !allowed.has(key),
    )
  )
    throw new Error("Unsupported project envelope fields");
  return ProjectConfigV3Schema.parse({
    ...project,
    schemaVersion: 3,
    generation: 1,
    editorialFile: "editorial/state.json",
  });
}

export function createEmptyEditorialState(projectId: string): EditorialState {
  return EditorialStateSchema.parse({
    schemaVersion: 1,
    projectId,
    generation: 1,
    anchors: [],
    annotations: [],
    threads: [],
  });
}
