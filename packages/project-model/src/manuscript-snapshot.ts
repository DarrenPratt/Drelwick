import { z } from "zod";
import { isIsoDate, isUuid } from "@drelwick/shared";
import {
  EditorialAnnotationSchema,
  EditorialAnchorSchema,
  EditorialThreadSchema,
} from "./editorial.js";

export const MANUSCRIPT_SNAPSHOT_LIMITS = {
  files: 10_000,
  semanticBytes: 256 * 1024 ** 2,
  assetBytes: 512 * 1024 ** 2,
  totalBytes: 2 * 1024 ** 3,
  componentBytes: 8 * 1024 ** 2,
} as const;
export const SNAPSHOT_OPTIONAL_FILES = [
  "presentation.json",
  "print.json",
  "publication.json",
] as const;
export const SNAPSHOT_EXCLUSIONS = [
  "reference",
  "application-settings",
  "other-snapshots",
  "periodic-history",
] as const;
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const historicalUuid = z.string().refine(isUuid);
const time = z.string().refine(isIsoDate);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const SnapshotLabelSchema = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 &&
      [...value].length <= 500 &&
      !/[\uD800-\uDFFF]/u.test(value) &&
      !value.includes("\0"),
  );
const idPart =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
export const SnapshotPathSchema = z
  .string()
  .max(1024)
  .refine(
    (path) =>
      /^(project|format|book|presentation|print|publication)\.json$/.test(
        path,
      ) ||
      new RegExp(`^manuscript/${idPart}\\.json$`).test(path) ||
      new RegExp(`^editorial/restore-conflicts/${idPart}\\.json$`).test(path) ||
      path === "editorial/state.json" ||
      new RegExp(
        `^assets/images/${idPart}/(asset\\.json|original\\.(png|jpg))$`,
      ).test(path),
  )
  .refine((path) =>
    path
      .split("/")
      .every(
        (part) =>
          !part.includes(":") &&
          part !== "." &&
          part !== ".." &&
          part.length > 0,
      ),
  );
const file = z
  .object({
    path: SnapshotPathSchema,
    size: z
      .number()
      .int()
      .nonnegative()
      .max(MANUSCRIPT_SNAPSHOT_LIMITS.assetBytes),
    sha256: hash,
  })
  .strict();
export const ManuscriptSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("manuscript-snapshot"),
    id: uuid,
    projectId: historicalUuid,
    created: time,
    label: SnapshotLabelSchema,
    reason: z.enum(["named", "before-review", "before-restore"]),
    generation: counter,
    chapterOrder: z.array(historicalUuid).max(10_000),
    files: z.array(file).min(4).max(10_000),
    absent: z.array(z.enum(SNAPSHOT_OPTIONAL_FILES)).max(3),
    exclusions: z.tuple([
      z.literal("reference"),
      z.literal("application-settings"),
      z.literal("other-snapshots"),
      z.literal("periodic-history"),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = value.files.map((item) => item.path);
    if (
      value.files.some(
        (item) =>
          (item.path.startsWith("manuscript/") ||
            item.path.startsWith("editorial/")) &&
          item.size > MANUSCRIPT_SNAPSHOT_LIMITS.componentBytes,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Snapshot component exceeds its byte limit",
      });
    const folded = paths.map((path) => path.normalize("NFC").toLowerCase());
    const invalid = () =>
      context.addIssue({
        code: "custom",
        message: "Incomplete, duplicate or invalid snapshot inventory",
      });
    if (
      new Set(folded).size !== paths.length ||
      paths.some((path, i) => i > 0 && paths[i - 1]! >= path)
    )
      invalid();
    if (
      new Set(value.chapterOrder.map((id) => id.toLowerCase())).size !==
      value.chapterOrder.length
    )
      invalid();
    const required = [
      "project.json",
      "format.json",
      "book.json",
      "editorial/state.json",
      ...value.chapterOrder.map((id) => `manuscript/${id}.json`),
    ];
    if (
      required.some((path) => !paths.includes(path)) ||
      paths.filter((path) => path.startsWith("manuscript/")).length !==
        value.chapterOrder.length
    )
      invalid();
    if (value.absent.some((path, i) => i > 0 && value.absent[i - 1]! >= path))
      invalid();
    for (const path of SNAPSHOT_OPTIONAL_FILES)
      if (
        Number(paths.includes(path)) + Number(value.absent.includes(path)) !==
        1
      )
        invalid();
    if (
      value.files.reduce((sum, item) => sum + item.size, 0) >
        MANUSCRIPT_SNAPSHOT_LIMITS.totalBytes ||
      value.files
        .filter((item) => !item.path.startsWith("assets/"))
        .reduce((sum, item) => sum + item.size, 0) >
        MANUSCRIPT_SNAPSHOT_LIMITS.semanticBytes
    )
      invalid();
  });
export const SnapshotDeletionSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: uuid,
    deletedAt: time,
    manifestHash: hash,
  })
  .strict();
export const RestoreConflictSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    projectId: historicalUuid,
    sourceGeneration: counter,
    restoredSnapshotId: uuid,
    created: time,
    entries: z
      .array(
        z
          .object({
            annotation: EditorialAnnotationSchema,
            anchor: EditorialAnchorSchema,
            thread: EditorialThreadSchema,
            reason: z.enum(["current-only", "different-version"]),
            disposition: z.enum([
              "unresolved",
              "copied",
              "reattached",
              "discarded",
            ]),
          })
          .strict(),
      )
      .max(100_000),
  })
  .strict()
  .superRefine((value, context) => {
    const identities = value.entries.flatMap((entry) => [
      entry.annotation.id,
      entry.anchor.id,
      entry.thread.id,
      ...entry.thread.comments.map((comment) => comment.id),
    ]);
    if (new Set(identities).size !== identities.length)
      context.addIssue({
        code: "custom",
        message: "Duplicate restore conflict identity",
      });
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MANUSCRIPT_SNAPSHOT_LIMITS.componentBytes
    )
      context.addIssue({
        code: "custom",
        message: "Restore conflict exceeds byte limit",
      });
    if (
      new Set(value.entries.map((entry) => entry.annotation.id)).size !==
        value.entries.length ||
      value.entries.some(
        (entry) =>
          entry.annotation.anchorId !== entry.anchor.id ||
          entry.annotation.threadId !== entry.thread.id,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Invalid restore conflict ownership",
      });
  });
export type ManuscriptSnapshot = z.infer<typeof ManuscriptSnapshotSchema>;
export type RestoreConflict = z.infer<typeof RestoreConflictSchema>;
