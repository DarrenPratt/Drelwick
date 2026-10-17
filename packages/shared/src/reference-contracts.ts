import { z } from "zod";
import { isUuid } from "./identifiers.js";

export const ReferenceKindSchema = z.enum([
  "character",
  "location",
  "canon",
  "timeline",
  "note",
]);
export type ReferenceKind = z.infer<typeof ReferenceKindSchema>;
export interface ReferenceTarget {
  kind: ReferenceKind | "chapter";
  id: string;
}
export interface ReferenceLink {
  id: string;
  target: ReferenceTarget;
}
type Fields =
  | {
      kind: "character";
      name: string;
      aliases: string[];
      role?: string | undefined;
      description?: string | undefined;
      appearance?: string | undefined;
      personality?: string | undefined;
      background?: string | undefined;
      notes?: string | undefined;
    }
  | {
      kind: "location";
      name: string;
      type?: string | undefined;
      description?: string | undefined;
      notes?: string | undefined;
    }
  | {
      kind: "canon";
      title: string;
      category:
        | "character"
        | "technology"
        | "location"
        | "history"
        | "relationship"
        | "terminology"
        | "other";
      statement: string;
      notes?: string | undefined;
    }
  | {
      kind: "timeline";
      title: string;
      date?: string | undefined;
      sequence?: number | undefined;
      description?: string | undefined;
      notes?: string | undefined;
    }
  | { kind: "note"; title: string; body: string; source?: string | undefined };
export type ReferenceContent = Fields & {
  tags: string[];
  links: ReferenceLink[];
};
/** New edges omit id; core allocates it. Existing edges retain their id. */
export type ReferenceInput = Fields & {
  tags: string[];
  links: { id?: string | undefined; target: ReferenceTarget }[];
};
export type ReferenceRecord = ReferenceContent & {
  schemaVersion: 1;
  id: string;
  projectId: string;
  created: string;
  modified: string;
  revision: number;
  deletedAt: string | null;
};
export interface ReferenceSaved {
  record: ReferenceRecord;
  fingerprint: string;
}
export interface ReferenceDiagnostic {
  code: string;
  id?: string | undefined;
  kind?: ReferenceKind;
}
export interface ReferenceSummary {
  /** Timeline ordering metadata; not a new persisted field. */
  sequence?: number | undefined;
  id: string;
  kind: ReferenceKind;
  title: string;
  revision: number;
  deletedAt: string | null;
}
export interface ReferenceEdge {
  sourceId: string;
  sourceKind: ReferenceKind;
  link: ReferenceLink;
  status: "resolved" | "deleted" | "missing" | "invalid" | "unsupported";
}
export const ReferenceIdSchema = z
  .string()
  .regex(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
const projectId = z.string().refine(isUuid);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const base = { projectId };
const target = { ...base, kind: ReferenceKindSchema, id: ReferenceIdSchema };
const expected = {
  ...target,
  expectedRevision: revision,
  expectedFingerprint: fingerprint,
};
// Transport shape only. The authoritative strict content schema belongs to project-model.
const content = z.custom<ReferenceInput>(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
);
export const ReferenceCandidateKeySchema = z.strictObject({
  source: z.enum(["draft", "history", "temporary"]),
  kind: ReferenceKindSchema,
  recordId: ReferenceIdSchema,
  candidateId: ReferenceIdSchema,
});
export type ReferenceCandidateKey = z.infer<typeof ReferenceCandidateKeySchema>;
export interface ReferenceCandidate extends ReferenceCandidateKey {
  currentFingerprint: string | null;
  fingerprint: string;
  status: "pending" | "committed" | "historical" | "invalid";
  revision?: number | undefined;
}
export const ReferenceRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...expected,
    operation: z.literal("link-attach"),
    chapterId: projectId,
    generation: revision,
  }),
  z.strictObject({
    ...expected,
    operation: z.literal("link-remove"),
    linkId: ReferenceIdSchema,
    generation: revision,
  }),
  z.strictObject({
    ...expected,
    operation: z.literal("link-retarget"),
    linkId: ReferenceIdSchema,
    chapterId: projectId,
    generation: revision,
  }),
  z.strictObject({
    ...base,
    operation: z.literal("list"),
    includeDeleted: z.boolean().optional(),
  }),
  z.strictObject({ ...target, operation: z.literal("read") }),
  z.strictObject({
    ...base,
    operation: z.literal("create"),
    content,
    generation: revision,
  }),
  z.strictObject({
    ...expected,
    operation: z.literal("update"),
    content,
    generation: revision,
  }),
  z.strictObject({
    ...expected,
    operation: z.enum(["delete", "restore"]),
    generation: revision,
  }),
  z.strictObject({
    ...base,
    operation: z.literal("links"),
    target: z.strictObject({
      kind: z.enum([
        "chapter",
        "character",
        "location",
        "canon",
        "timeline",
        "note",
      ]),
      id: z.string().refine(isUuid),
    }),
    includeDeleted: z.boolean().optional(),
  }),
  z.strictObject({ ...base, operation: z.literal("recovery-list") }),
  z.strictObject({
    ...base,
    operation: z.literal("recovery-read"),
    candidate: ReferenceCandidateKeySchema,
    fingerprint,
  }),
  z.strictObject({
    ...base,
    operation: z.literal("recovery-discard"),
    candidate: ReferenceCandidateKeySchema,
    fingerprint,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    ...base,
    operation: z.literal("recovery-apply"),
    candidate: ReferenceCandidateKeySchema,
    fingerprint,
    expectedFingerprint: fingerprint.nullable(),
    confirmed: z.literal(true),
  }),
]);
export type ReferenceRequest = z.infer<typeof ReferenceRequestSchema>;
export type ReferenceResponse = (
  | {
      type: "list";
      records: ReferenceSummary[];
      diagnostics: ReferenceDiagnostic[];
      readOnly: boolean;
    }
  | { type: "record"; value: ReferenceSaved }
  | {
      type: "links";
      incoming: ReferenceEdge[];
      outgoing: ReferenceEdge[];
      diagnostics: ReferenceDiagnostic[];
    }
  | {
      type: "recovery";
      candidates: ReferenceCandidate[];
      diagnostics: ReferenceDiagnostic[];
    }
  | { type: "discarded" }
) & { warning?: string | undefined };
