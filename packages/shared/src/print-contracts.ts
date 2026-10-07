import { z } from "zod";

export const PRINT_TRIM_PRESETS = {
  "5x8": { label: "5 × 8 in", width: 127000, height: 203200 },
  "5.25x8": { label: "5.25 × 8 in", width: 133350, height: 203200 },
  "5.5x8.5": { label: "5.5 × 8.5 in", width: 139700, height: 215900 },
  "6x9": { label: "6 × 9 in", width: 152400, height: 228600 },
  a5: { label: "A5 (148 × 210 mm)", width: 148000, height: 210000 },
} as const;
export const PrintUnitSchema = z.enum(["mm", "in"]);
export type PrintUnit = z.infer<typeof PrintUnitSchema>;
export type PrintTrimPreset = keyof typeof PRINT_TRIM_PRESETS;
const micrometres = (min: number, max: number) =>
  z.number().finite().int().min(min).max(max);
const headerContent = z.enum(["none", "book-title", "author", "chapter-title"]);

/** Renderer-safe semantic contract. All physical lengths are integer micrometres. */
export const PrintSettingsSchema = z
  .object({
    unit: PrintUnitSchema,
    trim: z
      .object({
        preset: z.enum(["5x8", "5.25x8", "5.5x8.5", "6x9", "a5", "custom"]),
        width: micrometres(76200, 330200),
        height: micrometres(101600, 482600),
      })
      .strict(),
    margins: z
      .object({
        mode: z.literal("mirrored"),
        inside: micrometres(5000, 100000),
        outside: micrometres(5000, 100000),
        top: micrometres(5000, 100000),
        bottom: micrometres(5000, 100000),
        gutter: micrometres(0, 50000),
      })
      .strict(),
    chapterStart: z.enum(["next-page", "recto"]),
    headers: z
      .object({
        verso: headerContent,
        recto: headerContent,
        showOnChapterOpening: z.boolean(),
      })
      .strict(),
    pageNumbers: z
      .object({
        enabled: z.boolean(),
        position: z.enum(["footer-center", "footer-outside"]),
        bodyStart: z.number().int().min(1).max(9999),
        frontMatter: z.enum(["none", "roman"]),
        showOnChapterOpening: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((settings, context) => {
    const issue = (path: string[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    const { trim, margins } = settings;
    if (trim.preset !== "custom") {
      const preset = PRINT_TRIM_PRESETS[trim.preset];
      if (trim.width !== preset.width || trim.height !== preset.height)
        issue(
          ["trim"],
          "Preset dimensions must match the selected trim size; choose Custom to edit dimensions.",
        );
    }
    if (trim.width - margins.inside - margins.outside - margins.gutter < 50000)
      issue(
        ["margins"],
        "Inside + outside + gutter must leave at least 50 mm of content width.",
      );
    if (trim.height - margins.top - margins.bottom < 75000)
      issue(
        ["margins"],
        "Top + bottom must leave at least 75 mm of content height.",
      );
    if (
      (settings.headers.verso !== "none" ||
        settings.headers.recto !== "none") &&
      margins.top < 10000
    )
      issue(
        ["margins", "top"],
        "Headers require a top margin of at least 10 mm.",
      );
    if (settings.pageNumbers.enabled && margins.bottom < 10000)
      issue(
        ["margins", "bottom"],
        "Page numbers require a bottom margin of at least 10 mm.",
      );
  });
export type PrintSettings = z.infer<typeof PrintSettingsSchema>;
export function defaultPrintSettings(): PrintSettings {
  return PrintSettingsSchema.parse({
    unit: "in",
    trim: { preset: "6x9", width: 152400, height: 228600 },
    margins: {
      mode: "mirrored",
      inside: 19050,
      outside: 19050,
      top: 19050,
      bottom: 19050,
      gutter: 3175,
    },
    chapterStart: "next-page",
    headers: {
      verso: "author",
      recto: "book-title",
      showOnChapterOpening: false,
    },
    pageNumbers: {
      enabled: true,
      position: "footer-center",
      bodyStart: 1,
      frontMatter: "roman",
      showOnChapterOpening: true,
    },
  });
}
/** Quantize once, at entry, to the nearest micrometre; never clamp invalid input. */
export function toPrintMicrometres(value: number, unit: PrintUnit): number {
  PrintUnitSchema.parse(unit);
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Enter a finite, non-negative measurement.");
  const result = Math.round(value * (unit === "in" ? 25400 : 1000));
  if (!Number.isSafeInteger(result))
    throw new Error("Measurement is too large.");
  return result;
}
export function fromPrintMicrometres(value: number, unit: PrintUnit): number {
  PrintUnitSchema.parse(unit);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid micrometre measurement.");
  return value / (unit === "in" ? 25400 : 1000);
}
/** Recto is a right-hand physical page, independent of the displayed folio. */
export function printPageGeometry(
  input: PrintSettings,
  side: "recto" | "verso",
) {
  const { trim, margins } = PrintSettingsSchema.parse(input);
  const inside = margins.inside + margins.gutter;
  return {
    left: side === "recto" ? inside : margins.outside,
    right: side === "recto" ? margins.outside : inside,
    top: margins.top,
    bottom: margins.bottom,
    contentWidth: trim.width - inside - margins.outside,
    contentHeight: trim.height - margins.top - margins.bottom,
  };
}
export interface PrintConfigurationState {
  settings: PrintSettings;
  revision: string;
}
export const PrintSaveRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    settings: PrintSettingsSchema,
  })
  .strict();

export type PrintSaveRequest = z.infer<typeof PrintSaveRequestSchema>;
