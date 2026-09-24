import { z } from "zod";
import { ChapterFileSchema } from "./versions/v1.js";
import { ManuscriptDocumentSchema } from "./manuscript-document.js";
import { ProjectConfigSchema } from "./versions/v2.js";

const chapter = ChapterFileSchema.extend({
  content: ManuscriptDocumentSchema,
}).passthrough();
const manifest = z
  .record(z.string(), z.unknown())
  .refine((value) => ProjectConfigSchema.safeParse(value).success);

/** Recovery artifact only; no change to authoritative project/chapter formats. */
export const ReplacementJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    token: z.string().uuid(),
    pid: z.number().int().positive(),
    host: z.string(),
    phase: z.enum(["pending", "complete"]),
    structure: z
      .object({
        beforeManifest: manifest,
        afterManifest: manifest,
        created: z.array(chapter),
        removed: z.array(chapter),
      })
      .strict()
      .optional(),
    entries: z.array(
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
    ),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = [
      ...value.entries.map((entry) => entry.before.id),
      ...(value.structure?.created ?? []).map((entry) => entry.id),
      ...(value.structure?.removed ?? []).map((entry) => entry.id),
    ];
    if (
      (!value.entries.length && !value.structure) ||
      new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid transaction identities.",
      });
    }
    if (value.structure) {
      const before = ProjectConfigSchema.parse(value.structure.beforeManifest);
      const after = ProjectConfigSchema.parse(value.structure.afterManifest);
      const expected = new Set(
        before.manuscript.order.filter(
          (id) => !value.structure!.removed.some((entry) => entry.id === id),
        ),
      );
      for (const entry of value.structure.created) expected.add(entry.id);
      if (
        before.projectId !== after.projectId ||
        before.schemaVersion !== after.schemaVersion ||
        value.structure.created.some((entry) =>
          before.manuscript.order.includes(entry.id),
        ) ||
        value.structure.removed.some(
          (entry) => !before.manuscript.order.includes(entry.id),
        ) ||
        value.entries.some(
          (entry) =>
            !before.manuscript.order.includes(entry.before.id) ||
            !after.manuscript.order.includes(entry.before.id),
        ) ||
        expected.size !== after.manuscript.order.length ||
        after.manuscript.order.some((id) => !expected.has(id))
      )
        context.addIssue({
          code: "custom",
          message: "Invalid transaction order.",
        });
    }
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
