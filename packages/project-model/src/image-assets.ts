import { z } from "zod";

/** Shared publishing/import limits, in bytes and source pixels. */
export const IMAGE_LIMITS = {
  bytes: 20 * 1024 * 1024,
  pixels: 24_000_000,
  dimension: 12_000,
} as const;
export const ImageAssetIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
export const IMAGE_SIZES = ["small", "medium", "large", "full"] as const;
export const ImageAttributesSchema = z
  .object({
    assetId: ImageAssetIdSchema,
    alt: z.string().max(4000),
    size: z.enum(IMAGE_SIZES),
  })
  .strict();
export const ImageAssetSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: ImageAssetIdSchema,
    mediaType: z.enum(["image/png", "image/jpeg"]),
    originalFilename: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          !/[\\/]/.test(value) &&
          ![...value].some(
            (character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          ),
      ),
    width: z.number().int().positive().max(IMAGE_LIMITS.dimension),
    height: z.number().int().positive().max(IMAGE_LIMITS.dimension),
    byteSize: z.number().int().positive().max(IMAGE_LIMITS.bytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .refine((value) => value.width * value.height <= IMAGE_LIMITS.pixels);
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

/** Preserve occurrence counts; repeated references are meaningful. */
export function manuscriptImageReferences(document: unknown): string[] {
  if (typeof document !== "object" || document === null) return [];
  const node = document as Record<string, unknown>;
  const references: string[] = [];
  if (node.type === "image") {
    const attributes = ImageAttributesSchema.safeParse(node.attrs);
    if (attributes.success) references.push(attributes.data.assetId);
  }
  if (Array.isArray(node.content))
    for (const child of node.content)
      references.push(...manuscriptImageReferences(child));
  return references;
}
