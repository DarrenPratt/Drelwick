import { z } from "zod";
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const source = z
  .object({
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    inventoryHash: hash,
  })
  .strict();
const selection = { snapshotId: uuid, manifestHash: hash };
export const SnapshotActionSchema = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("list"), projectId: z.string().uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("capture"),
      projectId: z.string().uuid(),
      operationId: uuid,
      expected: source,
      label: z
        .string()
        .max(1000)
        .refine(
          (value) =>
            value.trim().length > 0 &&
            [...value].length <= 500 &&
            !/[\uD800-\uDFFF]/u.test(value) &&
            !value.includes("\0"),
        ),
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspect"),
      projectId: z.string().uuid(),
      ...selection,
    })
    .strict(),
  z
    .object({
      operation: z.literal("delete"),
      projectId: z.string().uuid(),
      operationId: uuid,
      expected: source,
      ...selection,
      deleted: z.boolean(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("preview"),
      projectId: z.string().uuid(),
      ...selection,
    })
    .strict(),
  z
    .object({
      operation: z.literal("restore"),
      projectId: z.string().uuid(),
      operationId: uuid,
      token: uuid,
    })
    .strict(),
  z
    .object({
      operation: z.literal("cancel-preview"),
      projectId: z.string().uuid(),
      token: uuid,
    })
    .strict(),
  z
    .object({ operation: z.literal("conflicts"), projectId: z.string().uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("resolve-conflict"),
      projectId: z.string().uuid(),
      operationId: uuid,
      expected: source,
      collectionId: uuid,
      annotationId: uuid,
      action: z.enum(["copy", "reattach", "discard"]),
      target: z
        .object({
          chapterId: z.string().uuid(),
          from: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          to: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
export type SnapshotAction = z.infer<typeof SnapshotActionSchema>;
export interface SnapshotSource {
  generation: number;
  inventoryHash: string;
}
export interface SnapshotSelection {
  snapshotId: string;
  manifestHash: string;
}
export interface SnapshotSummary extends SnapshotSelection {
  label: string;
  created: string;
  generation: number;
  chapters: number;
  bytes: number;
  reason: string;
  deleted: boolean;
}
export interface SnapshotListing {
  source: SnapshotSource;
  snapshots: SnapshotSummary[];
  diagnostics: { snapshotId: string; code: "SNAPSHOT_INCOMPLETE" }[];
  conflicts: number;
}
export interface SnapshotInspection {
  snapshot: SnapshotSummary;
  chapters: { id: string; title: string; document: Record<string, unknown> }[];
  editorial: unknown;
  publication: unknown;
  files: { path: string; size: number; sha256: string }[];
  absent: string[];
  exclusions: string[];
}
export interface SnapshotRestorePreview {
  snapshot: SnapshotInspection;
  current: SnapshotSource;
  currentContext: Record<string, unknown>;
  currentChapters: {
    id: string;
    title: string;
    document: Record<string, unknown>;
  }[];
  conflicts: number;
  token?: string;
}
