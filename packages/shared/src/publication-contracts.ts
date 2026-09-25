import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.codePointAt(0)!;
        return (
          code === 9 ||
          code === 10 ||
          code === 13 ||
          (code >= 32 &&
            code <= 0x10ffff &&
            !(code >= 0xd800 && code <= 0xdfff) &&
            code !== 0xfffe &&
            code !== 0xffff)
        );
      }),
    );
export const PublicationMetadataSchema = z
  .object({
    title: text(500).min(1),
    author: text(500).min(1),
    language: z
      .string()
      .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/)
      .max(64),
    description: text(20000),
    identifiers: z
      .array(
        z
          .object({
            scheme: z.enum(["isbn", "uuid", "other"]),
            value: text(256).min(1),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const PublicationInclusionSchema = z
  .object({ navigation: z.boolean(), ebook: z.boolean(), print: z.boolean() })
  .strict();
export const MatterTypeSchema = z.enum([
  "title",
  "copyright",
  "dedication",
  "acknowledgements",
  "author",
]);
export const MatterPageRequestSchema = z
  .object({
    id: z.string().uuid(),
    title: text(500).min(1),
    type: MatterTypeSchema,
    placement: z.enum(["front", "back"]),
    inclusion: PublicationInclusionSchema,
    document: z.record(z.string(), z.unknown()),
  })
  .strict();
export const PublicationDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    metadata: PublicationMetadataSchema,
    pages: z.array(MatterPageRequestSchema).max(500),
    body: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            inclusion: PublicationInclusionSchema,
          })
          .strict(),
      )
      .max(10000),
    coverAssetId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = [...value.pages, ...value.body].map(({ id }) =>
      id.toLowerCase(),
    );
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Duplicate publication document identity",
      });
  });
export type PublicationData = z.infer<typeof PublicationDataSchema>;
export type PublicationMetadata = z.infer<typeof PublicationMetadataSchema>;
export type PublicationInclusion = z.infer<typeof PublicationInclusionSchema>;
export type MatterType = z.infer<typeof MatterTypeSchema>;
export interface PublicationState {
  data: PublicationData;
  revision: string;
  warning?: string;
}
export const PUBLICATION_INCLUSION: PublicationInclusion = {
  navigation: true,
  ebook: true,
  print: true,
};

export const PublicationSaveRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    data: PublicationDataSchema,
  })
  .strict();
export const PublicationCoverRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
