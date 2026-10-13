import {
  printPageGeometry,
  PrintTypographySchema,
  type PrintTypography,
  type PrintSettings,
} from "@drelwick/shared";
import { generateThemeStyles, getBookTheme } from "./themes.js";
import type { BuiltinThemeId } from "@drelwick/shared";

export function printTypography(
  themeId: BuiltinThemeId,
  overrides: PrintTypography = {},
) {
  const theme = getBookTheme(themeId);
  const values = PrintTypographySchema.parse(overrides);
  return {
    baseSizePt: values.baseSizePt ?? theme.targetOverrides.print.baseSizePt,
    lineHeight:
      values.lineHeight ??
      theme.targetOverrides.print.lineHeight ??
      theme.typography.lineHeight,
    paragraphSpacingEm:
      values.paragraphSpacingEm ??
      theme.targetOverrides.print.paragraphSpacingEm ??
      theme.typography.paragraphSpacingEm,
    paragraphIndentEm:
      values.paragraphIndentEm ?? theme.typography.paragraphIndentEm,
    alignment: values.alignment ?? theme.typography.alignment,
  };
}

/** Native Chromium fragmentation policy. No platform hyphenation dictionaries. */
export function printStyles(
  settings: PrintSettings,
  theme: BuiltinThemeId,
  startsRecto: boolean,
  overrides: PrintTypography = {},
): string {
  const definition = getBookTheme(theme);
  const typography = printTypography(theme, overrides);
  definition.typography.alignment = typography.alignment;
  definition.typography.paragraphIndentEm = typography.paragraphIndentEm;
  definition.targetOverrides.print = {
    baseSizePt: typography.baseSizePt,
    lineHeight: typography.lineHeight,
    paragraphSpacingEm: typography.paragraphSpacingEm,
  };
  const recto = printPageGeometry(settings, startsRecto ? "recto" : "verso");
  const verso = printPageGeometry(settings, startsRecto ? "verso" : "recto");
  const margins = (geometry: typeof recto) =>
    `${geometry.top / 1000}mm ${geometry.right / 1000}mm ${geometry.bottom / 1000}mm ${geometry.left / 1000}mm`;
  return (
    generateThemeStyles(definition, "print", {
      fontPolicy: "generic-only",
    }).css +
    `
@page { size: ${settings.trim.width / 1000}mm ${settings.trim.height / 1000}mm; margin: ${margins(recto)}; }
@page :left { margin: ${margins(verso)}; }
@page :right { margin: ${margins(recto)}; }
html, body { margin: 0; padding: 0; }
body { width: ${recto.contentWidth / 1000}mm; }
.chapter, .chapter-title, .chapter-body h1, .chapter-body h2, .chapter-body h3, .chapter-body h4, .chapter-body h5, .chapter-body h6, code, pre { font-family: DrelwickPrint; font-synthesis: none; }
.chapter { hyphens: manual; overflow-wrap: normal; }
p, li, blockquote { widows: 2; orphans: 2; }
h1, h2, h3, h4, h5, h6, hr { break-after: avoid; break-inside: avoid; }
img, .epigraph { break-inside: avoid; }
.chapter-title { margin-top: 0; padding-top: ${getBookTheme(theme).chapterOpening.spaceBeforeEm}em; }
`
  );
}

export function printRoman(value: number): string {
  let result = "";
  for (const [number, text] of [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ] as const) {
    while (value >= number) {
      result += text;
      value -= number;
    }
  }
  return result;
}
