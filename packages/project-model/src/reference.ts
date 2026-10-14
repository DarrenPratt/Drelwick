import { z } from "zod";
import {
  isIsoDate,
  isUuid,
  ReferenceIdSchema,
  ReferenceKindSchema,
} from "@drelwick/shared";

export const REFERENCE_LIMITS = {
  recordBytes: 8 * 1024 ** 2,
  draftBytes: 9 * 1024 ** 2,
  files: 10000,
  scanBytes: 256 * 1024 ** 2,
} as const;
const text = (limit: number) =>
  z
    .string()
    .refine(
      (v) =>
        [...v].length <= limit &&
        !v.includes("\0") &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          v,
        ),
    );
const label = text(500).refine((v) => v.trim().length > 0);
const prose = text(100000);
const unique = <T extends z.ZodType<string>>(schema: T, max: number) =>
  z
    .array(schema)
    .max(max)
    .refine((a) => new Set(a).size === a.length);
const timestamp = z.string().refine(isIsoDate);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const uuid = z.string().refine(isUuid);
export const ReferenceTargetSchema = z
  .strictObject({
    kind: z.enum([
      "chapter",
      "character",
      "location",
      "canon",
      "timeline",
      "note",
    ]),
    id: uuid,
  })
  .refine(
    (t) => t.kind === "chapter" || ReferenceIdSchema.safeParse(t.id).success,
  );
export const ReferenceLinkSchema = z.strictObject({
  id: ReferenceIdSchema,
  target: ReferenceTargetSchema,
});
const fields = {
  character: {
    kind: z.literal("character"),
    name: label,
    aliases: unique(label, 100),
    role: label.optional(),
    description: prose.optional(),
    appearance: prose.optional(),
    personality: prose.optional(),
    background: prose.optional(),
    notes: prose.optional(),
  },
  location: {
    kind: z.literal("location"),
    name: label,
    type: label.optional(),
    description: prose.optional(),
    notes: prose.optional(),
  },
  canon: {
    kind: z.literal("canon"),
    title: label,
    category: z.enum([
      "character",
      "technology",
      "location",
      "history",
      "relationship",
      "terminology",
      "other",
    ]),
    statement: prose,
    notes: prose.optional(),
  },
  timeline: {
    kind: z.literal("timeline"),
    title: label,
    date: label.optional(),
    sequence: z
      .number()
      .int()
      .min(Number.MIN_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    description: prose.optional(),
    notes: prose.optional(),
  },
  note: {
    kind: z.literal("note"),
    title: label,
    body: prose,
    source: text(2000).optional(),
  },
};
const tags = unique(
  text(100).refine((v) => v.trim().length > 0),
  100,
);
const contentBase = { tags, links: z.array(ReferenceLinkSchema).max(1000) };
const inputBase = {
  tags,
  links: z
    .array(
      z.strictObject({
        id: ReferenceIdSchema.optional(),
        target: ReferenceTargetSchema,
      }),
    )
    .max(1000),
};
export const ReferenceInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...fields.character, ...inputBase }),
  z.strictObject({ ...fields.location, ...inputBase }),
  z.strictObject({ ...fields.canon, ...inputBase }),
  z.strictObject({ ...fields.timeline, ...inputBase }),
  z.strictObject({ ...fields.note, ...inputBase }),
]);
const envelope = {
  schemaVersion: z.literal(1),
  id: ReferenceIdSchema,
  projectId: uuid,
  created: timestamp,
  modified: timestamp,
  revision,
  deletedAt: timestamp.nullable(),
  ...contentBase,
};
export const ReferenceRecordSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ ...fields.character, ...envelope }),
    z.strictObject({ ...fields.location, ...envelope }),
    z.strictObject({ ...fields.canon, ...envelope }),
    z.strictObject({ ...fields.timeline, ...envelope }),
    z.strictObject({ ...fields.note, ...envelope }),
  ])
  .superRefine((r, ctx) => {
    if (
      r.created > r.modified ||
      (r.deletedAt !== null &&
        (r.deletedAt < r.created || r.deletedAt > r.modified))
    )
      ctx.addIssue({ code: "custom", message: "Invalid timestamps" });
    const ids = new Set<string>(),
      targets = new Set<string>();
    for (const link of r.links) {
      const key = `${link.target.kind}:${link.target.id.toLowerCase()}`;
      if (
        ids.has(link.id) ||
        targets.has(key) ||
        (link.target.kind !== "chapter" && link.target.id === r.id)
      )
        ctx.addIssue({ code: "custom", message: "Invalid links" });
      ids.add(link.id);
      targets.add(key);
    }
  });
export const ReferenceDraftSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectId: uuid,
    recordId: ReferenceIdSchema,
    draftId: ReferenceIdSchema,
    captured: timestamp,
    generation: revision,
    baseRevision: revision.nullable(),
    baseSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    record: ReferenceRecordSchema,
  })
  .refine(
    (d) =>
      d.projectId === d.record.projectId &&
      d.recordId === d.record.id &&
      ((d.baseRevision === null &&
        d.baseSha256 === null &&
        d.record.revision === 1) ||
        (d.baseRevision !== null &&
          d.baseSha256 !== null &&
          d.record.revision === d.baseRevision + 1)),
  );
export type ReferenceDraft = z.infer<typeof ReferenceDraftSchema>;
export { ReferenceKindSchema };

/** Strict JSON reader: detect duplicate keys at every depth before JSON.parse. */
export function parseReferenceJson(source: string): unknown {
  let p = 0;
  const fail = () => {
    throw new Error("REFERENCE_JSON_INVALID");
  };
  const white = () => {
    while (/[\x20\t\r\n]/.test(source[p] ?? "x")) p++;
  };
  function string(): string {
    const start = p++;
    while (p < source.length) {
      const c = source[p++];
      if (c === "\\") p++;
      else if (c === '"') return JSON.parse(source.slice(start, p)) as string;
    }
    return fail();
  }
  function value(depth: number): void {
    if (depth > 64) fail();
    white();
    const c = source[p];
    if (c === '"') {
      string();
      return;
    }
    if (c === "{" || c === "[") {
      p++;
      white();
      const end = c === "{" ? "}" : "]";
      const keys = new Set<string>();
      if (source[p] === end) {
        p++;
        return;
      }
      for (;;) {
        if (c === "{") {
          if (source[p] !== '"') fail();
          const key = string();
          if (keys.has(key)) fail();
          keys.add(key);
          white();
          if (source[p++] !== ":") fail();
        }
        value(depth + 1);
        white();
        if (source[p] === end) {
          p++;
          return;
        }
        if (source[p++] !== ",") fail();
        white();
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
        source.slice(p),
      );
    if (!token) fail();
    else p += token[0].length;
  }
  value(0);
  white();
  if (p !== source.length) fail();
  return JSON.parse(source) as unknown;
}
