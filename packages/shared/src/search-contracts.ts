import { z } from "zod";

export const ReplacementRequestSchema = z
  .object({
    options: z
      .object({
        query: z.string().min(1).max(10000),
        matchCase: z.boolean(),
        wholeWord: z.boolean(),
      })
      .strict(),
    replacement: z.string().max(100000),
    chapterId: z.string().uuid().optional(),
    expected: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            content: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type ReplacementRequest = z.infer<typeof ReplacementRequestSchema>;
export const ReplacementReceiptSchema = z
  .object({
    matches: z.number().int().nonnegative(),
    chapters: z.number().int().nonnegative(),
  })
  .strict();
