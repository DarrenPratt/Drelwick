import { ChapterStatusSchema, isIsoDate, isUuid } from "@drelwick/shared";
import { z } from "zod";
import { ManuscriptDocumentSchema } from "../manuscript-document.js";

export { ChapterStatusSchema };
export type { ChapterStatus } from "@drelwick/shared";

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

export const ProjectConfigSchema = z.object({
  schemaVersion,
  projectId: uuid,
  created: isoDate,
  modified: isoDate,
  bookFile: z.literal("book.json"),
  manuscript: z.object({
    order: z.array(uuid).superRefine((ids, context) => {
      if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
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

export const CountedChapterSummarySchema = ChapterSummarySchema.extend({
  wordCount: z.number().int().nonnegative(),
});
export type CountedChapterSummary = z.infer<typeof CountedChapterSummarySchema>;

export const ChapterSummaryCacheSchema = z.object({
  schemaVersion,
  projectId: uuid,
  entries: z
    .array(
      z.object({
        size: z.number().int().nonnegative(),
        mtimeMs: z.number(),
        ctimeMs: z.number(),
        summary: CountedChapterSummarySchema,
      }),
    )
    .superRefine((entries, context) => {
      if (
        new Set(entries.map((entry) => entry.summary.id.toLowerCase())).size !==
        entries.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Duplicate cached chapter IDs",
        });
      }
    }),
});
export type ChapterSummaryCache = z.infer<typeof ChapterSummaryCacheSchema>;

/** Application-level settings; never embed these machine-specific paths in projects. */
export const RecentProjectsSettingsSchema = z
  .object({
    schemaVersion,
    projects: z.array(
      z
        .object({
          id: uuid,
          path: z.string().min(1),
          title: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const SessionMarkerSchema = z
  .object({
    schemaVersion,
    sessionId: uuid,
    started: isoDate,
    cleanShutdown: z.boolean(),
    shutdown: isoDate.optional(),
  })
  .strict();
export type SessionMarker = z.infer<typeof SessionMarkerSchema>;

export const HistorySnapshotSchema = z.object({
  schemaVersion,
  id: uuid,
  chapterId: uuid,
  created: isoDate,
  reason: z.enum([
    "interval",
    "manual",
    "migration",
    "before-import",
    "before-recovery",
    "status-change",
  ]),
  content: ManuscriptDocumentSchema,
});
export type HistorySnapshot = z.infer<typeof HistorySnapshotSchema>;

/** Versioned inventory for a portable project archive. Paths always use `/`. */
export const ProjectArchiveManifestSchema = z
  .object({
    schemaVersion,
    projectId: uuid,
    created: isoDate,
    includesHistory: z.boolean(),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1024),
            size: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type ProjectArchiveManifest = z.infer<
  typeof ProjectArchiveManifestSchema
>;

export { ManuscriptDocumentSchema };
