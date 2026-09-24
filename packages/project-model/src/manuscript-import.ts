import { z } from "zod";
import { ApplicationError } from "@drelwick/shared";
import { ManuscriptDocumentSchema } from "./manuscript-document.js";
import { ChapterTypeSchema } from "./versions/v1.js";
import {
  IMAGE_LIMITS,
  ImageAssetIdSchema,
  manuscriptImageReferences,
} from "./image-assets.js";

/** Import transport limits; image decoding retains the existing IMAGE_LIMITS. */
export const IMPORT_LIMITS = {
  sourceBytes: 64 * 1024 * 1024,
  parserBytes: 128 * 1024 * 1024,
  stagedBytes: 128 * 1024 * 1024,
  chapters: 1000,
  assets: 256,
  warnings: 1000,
  depth: 64,
  nodes: 1_000_000,
  string: 1_000_000,
} as const;
const text = z.string().max(4000);
export const ImportMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    author: z.string().trim().min(1).max(500),
    language: z.string().trim().min(1).max(100),
    subtitle: text.optional(),
    publisher: text.optional(),
    isbn: text.optional(),
    description: text.optional(),
    series: z
      .object({
        name: text.min(1),
        number: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const ImportWarningSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    message: text.min(1),
    location: z
      .object({
        chapter: z
          .number()
          .int()
          .nonnegative()
          .max(IMPORT_LIMITS.chapters - 1)
          .optional(),
        block: z
          .number()
          .int()
          .nonnegative()
          .max(IMPORT_LIMITS.nodes)
          .optional(),
        label: z.string().min(1).max(200),
      })
      .strict(),
  })
  .strict();
export const ImporterResultSchema = z
  .object({
    metadata: ImportMetadataSchema,
    chapters: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            type: ChapterTypeSchema,
            content: ManuscriptDocumentSchema,
          })
          .strict(),
      )
      .min(1)
      .max(IMPORT_LIMITS.chapters),
    assets: z
      .array(
        z
          .object({
            id: ImageAssetIdSchema,
            mediaType: z.enum(["image/png", "image/jpeg"]),
            // Bytes only: source filenames, URLs and archive paths are never destinations.
            base64: z
              .string()
              .max(Math.ceil(IMAGE_LIMITS.bytes / 3) * 4)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/)
              .refine((value) => value.length % 4 === 0),
          })
          .strict(),
      )
      .max(IMPORT_LIMITS.assets),
    warnings: z.array(ImportWarningSchema).max(IMPORT_LIMITS.warnings),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set(value.assets.map((asset) => asset.id));
    if (
      ids.size !== value.assets.length ||
      value.chapters.some((chapter) =>
        manuscriptImageReferences(chapter.content).some((id) => !ids.has(id)),
      ) ||
      value.warnings.some(
        (warning) =>
          warning.location.chapter !== undefined &&
          warning.location.chapter >= value.chapters.length,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Invalid import references.",
      });
  });
export type ImporterResult = z.infer<typeof ImporterResultSchema>;
export const ImportInspectionSchema = z
  .object({
    operationId: z.string().uuid(),
    metadata: ImportMetadataSchema,
    chapters: ImporterResultSchema.shape.chapters,
    assets: z
      .array(
        z
          .object({
            id: ImageAssetIdSchema,
            mediaType: z.enum(["image/png", "image/jpeg"]),
            byteSize: z.number().int().positive().max(IMAGE_LIMITS.bytes),
          })
          .strict(),
      )
      .max(IMPORT_LIMITS.assets),
    warnings: ImporterResultSchema.shape.warnings,
  })
  .strict();
declare const validated: unique symbol;
export type ValidatedManuscript = ImporterResult & {
  readonly [validated]: true;
};

/** Accept serialized output, never arbitrary parser objects/getters or error payloads. */
export function validateImportedManuscript(
  serialized: string,
): ValidatedManuscript {
  const invalid = () =>
    new ApplicationError(
      "IMPORT_INVALID",
      "The imported manuscript is invalid or exceeds import limits.",
    );
  // UTF-16 length provides a cheap preflight before UTF-8 allocation.
  if (
    typeof serialized !== "string" ||
    serialized.length > IMPORT_LIMITS.parserBytes ||
    new TextEncoder().encode(serialized).length > IMPORT_LIMITS.parserBytes
  )
    throw invalid();
  try {
    const raw: unknown = JSON.parse(serialized);
    const pending: { value: unknown; depth: number }[] = [
      { value: raw, depth: 0 },
    ];
    let nodes = 0;
    while (pending.length) {
      const entry = pending.pop()!;
      if (++nodes > IMPORT_LIMITS.nodes || entry.depth > IMPORT_LIMITS.depth)
        throw invalid();
      if (
        typeof entry.value === "string" &&
        entry.value.length > IMPORT_LIMITS.string &&
        entry.depth !== 3
      )
        throw invalid();
      if (entry.value && typeof entry.value === "object") {
        const children = Object.values(entry.value);
        if (children.length + pending.length + nodes > IMPORT_LIMITS.nodes)
          throw invalid();
        for (const value of children)
          pending.push({ value, depth: entry.depth + 1 });
      }
    }
    const result = ImporterResultSchema.safeParse(raw);
    if (!result.success) throw invalid();
    return result.data as ValidatedManuscript;
  } catch {
    throw invalid();
  }
}
