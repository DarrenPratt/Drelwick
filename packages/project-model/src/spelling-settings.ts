import { z } from "zod";
import { SpellingLanguageSchema, SpellingWordSchema } from "@drelwick/shared";

/** User-level configuration; never part of the manuscript/project format. */
export const SpellingSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: SpellingLanguageSchema,
    words: z.array(SpellingWordSchema).max(10000),
  })
  .strict();
export type SpellingSettings = z.infer<typeof SpellingSettingsSchema>;
