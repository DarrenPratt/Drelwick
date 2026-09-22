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
