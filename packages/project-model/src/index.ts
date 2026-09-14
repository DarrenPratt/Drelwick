import { isIsoDate, isUuid } from "@bookeditor/shared";
import { z } from "zod";

const schemaVersion = z.literal(1);
const uuid = z.string().refine(isUuid, "Expected a UUID v4");
const isoDate = z.string().refine(isIsoDate, "Expected an ISO date");
const nonEmptyString = z.string().trim().min(1);

export const ChapterTypeSchema = z.enum([
  "chapter",
  "prologue",
  "epilogue",
  "frontmatter",
  "backmatter",
]);
export type ChapterType = z.infer<typeof ChapterTypeSchema>;

export const ChapterStatusSchema = z.enum([
  "draft",
  "revising",
  "review",
  "final",
]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ProjectConfigSchema = z.object({
  schemaVersion,
  projectId: uuid,
  created: isoDate,
  modified: isoDate,
  bookFile: z.literal("book.json"),
  manuscript: z.object({
    order: z.array(uuid).superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          message: "Manuscript order must not contain duplicate chapter IDs",
        });
      }
    }),
  }),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const BookMetadataSchema = z.object({
  schemaVersion,
  title: nonEmptyString,
  subtitle: z.string().optional(),
  author: nonEmptyString,
  language: nonEmptyString,
  publisher: z.string().optional(),
  isbn: z.string().optional(),
  description: z.string().optional(),
  series: z
    .object({
      name: nonEmptyString,
      number: z.number().int().positive().optional(),
    })
    .optional(),
  created: isoDate,
  modified: isoDate,
});
export type BookMetadata = z.infer<typeof BookMetadataSchema>;

const chapterFields = {
  schemaVersion,
  id: uuid,
  type: ChapterTypeSchema,
  title: nonEmptyString,
  status: ChapterStatusSchema,
  created: isoDate,
  modified: isoDate,
} as const;

export const ProseMirrorDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict();
export type ProseMirrorDocument = z.infer<typeof ProseMirrorDocumentSchema>;

export const ChapterFileSchema = z.object({
  ...chapterFields,
  content: ProseMirrorDocumentSchema,
});
export type ChapterFile = z.infer<typeof ChapterFileSchema>;

export const ChapterSummarySchema = z.object(chapterFields);
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
