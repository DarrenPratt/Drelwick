import { z } from "zod";
import { BuiltinThemeIdSchema } from "@drelwick/shared";
import { ProjectConfigSchema } from "./versions/v1.js";

export const ThemeFontSchema = z.enum([
  "traditional-serif",
  "humanist-sans",
  "literary-serif",
]);
const alignment = z.enum(["left", "center", "right"]);
const fontStyle = z.enum(["normal", "italic"]);
const number = (minimum: number, maximum: number) =>
  z.number().finite().min(minimum).max(maximum);
/** Presentation vocabulary only; no source text, CSS, HTML, URLs or paths. */
export const BookThemeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: BuiltinThemeIdSchema,
    name: z.string().regex(/^[A-Za-z][A-Za-z -]{0,39}$/),
    typography: z
      .object({
        bodyFont: ThemeFontSchema,
        headingFont: ThemeFontSchema,
        baseSizeRem: number(0.875, 1.25),
        lineHeight: number(1.25, 1.9),
        paragraphIndentEm: number(0, 2),
        paragraphSpacingEm: number(0, 1),
        alignment: z.enum(["left", "justify"]),
      })
      .strict(),
    chapterOpening: z
      .object({
        spaceBeforeEm: number(0, 6),
        spaceAfterEm: number(0.5, 4),
        titleSizeEm: number(1.2, 3),
        alignment,
        divider: z.boolean(),
      })
      .strict(),
    headings: z
      .object({
        weight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
        spaceBeforeEm: number(0.5, 3),
        spaceAfterEm: number(0.25, 2),
      })
      .strict(),
    quote: z
      .object({ indentEm: number(0, 3), spacingEm: number(0.25, 2), fontStyle })
      .strict(),
    epigraph: z
      .object({
        alignment,
        widthPercent: number(50, 100),
        spacingEm: number(0.5, 3),
        fontStyle,
      })
      .strict(),
    sceneBreak: z
      .object({
        variant: z.enum(["space", "rule", "diamond"]),
        spacingEm: number(0.5, 4),
        widthPercent: number(10, 60),
      })
      .strict(),
    targetOverrides: z
      .object({
        ebook: z
          .object({
            baseSizeRem: number(0.875, 1.25).optional(),
            lineHeight: number(1.25, 1.9).optional(),
            paragraphSpacingEm: number(0, 1).optional(),
          })
          .strict(),
        print: z
          .object({
            baseSizePt: number(9, 14),
            lineHeight: number(1.2, 1.8).optional(),
            paragraphSpacingEm: number(0, 1).optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type BookTheme = z.infer<typeof BookThemeSchema>;
export type ThemeFont = z.infer<typeof ThemeFontSchema>;

/** Optional additive component: absent means Classic, without a disk rewrite. */
export const BookPresentationSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: ProjectConfigSchema.shape.projectId,
    // Future/unavailable identities are valid data, but never paths or CSS.
    themeId: z
      .string()
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
      .max(64),
  })
  .strict();
export type BookPresentation = z.infer<typeof BookPresentationSchema>;
