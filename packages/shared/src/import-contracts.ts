import { z } from "zod";
const token = z.string().uuid();
export const ImportInspectRequestSchema = z
  .object({
    operationId: token,
    importer: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  })
  .strict();
export const ImportTokenRequestSchema = z
  .object({ operationId: token })
  .strict();
/** Only decisions and block boundaries cross back; manuscript content stays staged. */
export const ImportReviewSchema = z
  .object({
    boundaries: z
      .array(
        z
          .object({
            block: z.number().int().nonnegative().max(1_000_000),
            title: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    acceptedWarnings: z
      .array(z.number().int().nonnegative().max(999))
      .max(1000),
  })
  .strict();
export type ImportReview = z.infer<typeof ImportReviewSchema>;
export const ImportCommitRequestSchema = ImportTokenRequestSchema.extend({
  review: ImportReviewSchema,
});
/** Preview data only; neither source nor stage nor destination paths are returned. */
export interface ImportInspection {
  operationId: string;
  metadata: {
    title: string;
    author: string;
    language: string;
    subtitle?: string | undefined;
    publisher?: string | undefined;
    isbn?: string | undefined;
    description?: string | undefined;
    series?: { name: string; number?: number | undefined } | undefined;
  };
  chapters: { title: string; type: string; content: Record<string, unknown> }[];
  assets: {
    id: string;
    mediaType: "image/png" | "image/jpeg";
    byteSize: number;
  }[];
  warnings: {
    code: string;
    message: string;
    location: {
      chapter?: number | undefined;
      block?: number | undefined;
      label: string;
    };
  }[];
}
