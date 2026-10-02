import { z } from "zod";

export const EpubExportReceiptSchema = z
  .object({
    created: z.boolean(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    warnings: z.array(z.string()),
  })
  .strict();
export type EpubExportReceipt = z.infer<typeof EpubExportReceiptSchema>;
