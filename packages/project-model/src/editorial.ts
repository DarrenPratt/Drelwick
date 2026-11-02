import { z } from "zod";
import { ChapterFileSchema } from "./versions/v1.js";
import { ProjectConfigV2Schema } from "./versions/v2.js";
import { ManuscriptDocumentSchema } from "./manuscript-document.js";
import {
  decodeEditorialDocument,
  decodeEditorialSlice,
} from "./editorial-codec.js";
import { isSafeRelativePath, isIsoDate, isUuid } from "@drelwick/shared";

export const EDITORIAL_LIMITS = {
  componentBytes: 8 * 1024 ** 2,
  captureBytes: 256 * 1024 ** 2,
  chapters: 10_000,
} as const;
function withinComponentLimit(value: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      EDITORIAL_LIMITS.componentBytes
    );
  } catch {
    return false;
  }
}
const historicalUuid = z
  .string()
  .refine(isUuid, "Expected a historical UUID v4");
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const time = z
  .string()
  .refine(isIsoDate, "Expected a real UTC timestamp with milliseconds");
const unicode = z
  .string()
  .refine((value) => !hasInvalidUnicode(value), "Invalid Unicode");
const scalarString = (limit: number) =>
  unicode.refine(
    (value) => [...value].length <= limit,
    "Text exceeds scalar limit",
  );
const contextString = unicode.refine(
  (value) =>
    [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(value)]
      .length <= 32,
  "Context exceeds 32 graphemes",
);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const position = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const strictDoc = z.custom<z.infer<typeof ManuscriptDocumentSchema>>(
  (value) => {
    try {
      if (!withinComponentLimit(value)) return false;
      decodeEditorialDocument(value);
      return true;
    } catch {
      return false;
    }
  },
);
const slice = z
  .object({
    content: z.array(z.record(z.string(), z.unknown())),
    openStart: position,
    openEnd: position,
  })
  .strict()
  .refine((value) => {
    try {
      decodeEditorialSlice(value);
      return true;
    } catch {
      return false;
    }
  }, "Invalid semantic slice");

export const EditorialEvidenceSchema = z
  .object({
    chapterId: historicalUuid,
    documentHash: hash,
    from: position,
    to: position,
    slice,
    prefix: contextString,
    suffix: contextString,
  })
  .strict()
  .refine((v) => v.from <= v.to);
export const EditorialLiveSegmentSchema = z
  .object({
    chapterId: historicalUuid,
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
      (v.deletedAt !== null &&
        (v.deletedAt < v.created || v.deletedAt > v.modified))
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
    body: scalarString(100_000),
    authorLabel: scalarString(256).nullable(),
    created: time,
    modified: time,
    deletedAt: time.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.created > v.modified ||
      (v.deletedAt !== null &&
        (v.deletedAt < v.created || v.deletedAt > v.modified))
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
      (v.deletedAt !== null &&
        (v.deletedAt < v.created || v.deletedAt > v.modified))
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
      (v.deletedAt !== null &&
        (v.deletedAt < v.created || v.deletedAt > v.modified)) ||
      (v.resolvedAt !== null &&
        (v.resolvedAt < v.created || v.resolvedAt > v.modified))
    )
      c.addIssue({ code: "custom", message: "Invalid thread timestamps" });
    if (
      v.comments.some(
        (comment, index) =>
          index > 0 &&
          (v.comments[index - 1]!.created > comment.created ||
            (v.comments[index - 1]!.created === comment.created &&
              v.comments[index - 1]!.id >= comment.id)),
      )
    )
      c.addIssue({
        code: "custom",
        message: "Comments must be in creation and ID order",
      });
    const ids = v.comments.map((comment) => comment.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Duplicate comment ID" });
  });
export const EditorialStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: historicalUuid,
    generation: counter,
    anchors: z.array(EditorialAnchorSchema).max(100_000),
    annotations: z.array(EditorialAnnotationSchema).max(100_000),
    threads: z.array(EditorialThreadSchema).max(100_000),
  })
  .strict()
  .superRefine((v, c) => {
    if (!withinComponentLimit(v))
      c.addIssue({
        code: "custom",
        message: "Editorial component exceeds byte limit",
      });
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
    if (
      new Set(v.annotations.map((x) => x.anchorId)).size !==
        v.annotations.length ||
      new Set(v.annotations.map((x) => x.threadId)).size !==
        v.annotations.length ||
      a.size !== v.annotations.length ||
      t.size !== v.annotations.length
    )
      c.addIssue({
        code: "custom",
        message: "Editorial ownership must be one-to-one",
      });
    for (const x of v.annotations) {
      const anchor = v.anchors.find((item) => item.id === x.anchorId);
      const thread = v.threads.find((item) => item.id === x.threadId);
      if (
        anchor &&
        thread &&
        (anchor.deletedAt !== x.deletedAt || thread.deletedAt !== x.deletedAt)
      )
        c.addIssue({ code: "custom", message: "Owned tombstones must agree" });
      if (!a.has(x.anchorId) || !t.has(x.threadId))
        c.addIssue({
          code: "custom",
          message: "Dangling annotation ownership",
        });
    }
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
  title: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  created: time,
  modified: time,
  content: strictDoc,
  review: ReviewV1Schema,
})
  .strict()
  .superRefine((value, context) => {
    if (!withinComponentLimit(value))
      context.addIssue({
        code: "custom",
        message: "Chapter component exceeds byte limit",
      });
    if (value.created > value.modified)
      context.addIssue({
        code: "custom",
        message: "Invalid chapter timestamps",
      });
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
  created: time,
  modified: time,
  manuscript: ProjectConfigV2Schema.shape.manuscript
    .extend({
      order: ProjectConfigV2Schema.shape.manuscript.shape.order.max(
        EDITORIAL_LIMITS.chapters,
      ),
    })
    .strict(),
  editorialFile: z.literal("editorial/state.json"),
})
  .strict()
  .refine(
    (value) => value.created <= value.modified,
    "Invalid project timestamps",
  );
export const ProjectFormatV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    projectId: historicalUuid,
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
    projectId: historicalUuid,
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
            chapterId: historicalUuid,
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
    projectId: historicalUuid,
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
  const chapter = ChapterFileSchema.strict().parse(source);
  const result = {
    ...chapter,
    title: (source as { title: string }).title,
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
  const manuscript = (source as { manuscript: Record<string, unknown> })
    .manuscript;
  if (Object.keys(manuscript).some((key) => key !== "order"))
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

/** A command fingerprint binds retries without storing manuscript or discussion text. */
export const EditorialRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: uuid,
    projectId: historicalUuid,
    expectedGeneration: counter,
    requestHash: hash,
  })
  .strict();
