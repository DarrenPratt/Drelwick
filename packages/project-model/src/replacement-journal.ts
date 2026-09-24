import { z } from "zod";
import { ChapterFileSchema } from "./versions/v1.js";
import { ManuscriptDocumentSchema } from "./manuscript-document.js";

/** Recovery artifact only; no change to authoritative project/chapter formats. */
export const ReplacementJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    token: z.string().uuid(),
    pid: z.number().int().positive(),
    host: z.string(),
    phase: z.enum(["pending", "complete"]),
    entries: z
      .array(
        z
          .object({
            before: ChapterFileSchema.extend({
              content: ManuscriptDocumentSchema,
            }).passthrough(),
            after: ChapterFileSchema.extend({
              content: ManuscriptDocumentSchema,
            }).passthrough(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.entries.map((entry) => entry.before.id)).size !==
        value.entries.length ||
      value.entries.some((entry) => entry.before.id !== entry.after.id)
    )
      context.addIssue({
        code: "custom",
        message: "Invalid replacement journal.",
      });
  });
export type ReplacementJournal = z.infer<typeof ReplacementJournalSchema>;
