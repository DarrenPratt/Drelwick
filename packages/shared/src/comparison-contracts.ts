import { z } from "zod";

export const ComparisonSourceRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("captured-current"),
    projection: z.enum(["accepted", "proposed"]),
  }),
  z.strictObject({
    kind: z.literal("snapshot"),
    snapshotId: z.string().uuid(),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    projection: z.enum(["accepted", "proposed"]),
  }),
]);
export const ComparisonActionSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("capture"),
    projectId: z.string().uuid(),
    source: ComparisonSourceRequestSchema,
  }),
  z.strictObject({
    operation: z.literal("compare"),
    projectId: z.string().uuid(),
    requestId: z.string().uuid(),
    left: z.string().uuid(),
    right: z.string().uuid(),
  }),
  z.strictObject({
    operation: z.literal("cancel"),
    projectId: z.string().uuid(),
    requestId: z.string().uuid(),
  }),
  z.strictObject({
    operation: z.literal("release"),
    projectId: z.string().uuid(),
    token: z.string().uuid(),
  }),
  z.strictObject({
    operation: z.literal("status"),
    projectId: z.string().uuid(),
    token: z.string().uuid(),
  }),
]);
export type ComparisonAction = z.infer<typeof ComparisonActionSchema>;
export type ComparisonSourceRequest = z.infer<
  typeof ComparisonSourceRequestSchema
>;
export interface ComparisonSourceToken {
  kind: "snapshot" | "captured-current";
  id: string;
  projectId: string;
  generation: number;
  inventoryHash: string;
  manifestHash: string | null;
  label: string;
  created: string;
  projection: "accepted" | "proposed";
}
export interface ComparisonDiagnostic {
  source: "left" | "right";
  chapterId: string | null;
  assetId: string | null;
  code: "MISSING_ASSET" | "UNSUPPORTED_VERSION" | "LIMIT" | "INVALID_SOURCE";
}
export interface ComparisonLocation {
  nodePath: number[];
  from: number;
  to: number;
}
export type ComparisonValue =
  | {
      type: "slice";
      value: {
        content: Record<string, unknown>[];
        openStart: number;
        openEnd: number;
      };
    }
  | { type: "metadata"; value: unknown };
export interface ComparisonChange {
  ordinal: number;
  kind:
    | "chapter-added"
    | "chapter-removed"
    | "chapter-moved"
    | "title"
    | "status"
    | "metadata"
    | "text-insert"
    | "text-delete"
    | "text-replace"
    | "mark-change"
    | "node-change"
    | "attribute-change"
    | "asset-change";
  chapterId: string | null;
  oldLocation: ComparisonLocation | null;
  newLocation: ComparisonLocation | null;
  before: ComparisonValue | null;
  after: ComparisonValue | null;
}
export interface ComparisonV1 {
  schemaVersion: 1;
  algorithm: "semantic-grapheme-v1";
  left: ComparisonSourceToken;
  right: ComparisonSourceToken;
  complete: boolean;
  changes: ComparisonChange[];
  diagnostics: ComparisonDiagnostic[];
  chapters: { id: string; title: string }[];
}
export interface CapturedComparisonSource {
  token: string;
  source: ComparisonSourceToken;
}
