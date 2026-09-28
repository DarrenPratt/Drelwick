import { z } from "zod";

export const SPELLING_LANGUAGES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
] as const;
export const SpellingLanguageSchema = z
  .string()
  .max(63)
  .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/);
// Preserve code points and case: no trimming, case folding or normalization.
export const SpellingWordSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u);
export const SpellingUpdateSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("language"),
      language: SpellingLanguageSchema,
    })
    .strict(),
  z
    .object({ operation: z.enum(["add", "remove"]), word: SpellingWordSchema })
    .strict(),
]);
export const SpellingCheckSchema = z
  .object({
    language: SpellingLanguageSchema,
    words: z.array(SpellingWordSchema).max(256),
  })
  .strict();
export const SpellingSuggestSchema = z
  .object({
    language: SpellingLanguageSchema,
    word: SpellingWordSchema.max(64),
  })
  .strict();
export type SpellingUpdate = z.infer<typeof SpellingUpdateSchema>;
export interface SpellingState {
  language: string;
  words: string[];
  languages: { id: string; label: string; available: boolean }[];
}
export interface SpellingCheck {
  available: boolean;
  incorrect: string[];
}
