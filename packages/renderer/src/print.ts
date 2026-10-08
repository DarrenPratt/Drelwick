import { printPageGeometry, type PrintSettings } from "@drelwick/shared";
import { generateThemeStyles, getBookTheme } from "./themes.js";
import type { BuiltinThemeId } from "@drelwick/shared";

/** Native Chromium fragmentation policy. No platform hyphenation dictionaries. */
export function printStyles(
  settings: PrintSettings,
  theme: BuiltinThemeId,
  startsRecto: boolean,
): string {
  const recto = printPageGeometry(settings, startsRecto ? "recto" : "verso");
  const verso = printPageGeometry(settings, startsRecto ? "verso" : "recto");
  const margins = (geometry: typeof recto) =>
    `${geometry.top / 1000}mm ${geometry.right / 1000}mm ${geometry.bottom / 1000}mm ${geometry.left / 1000}mm`;
  return (
    generateThemeStyles(getBookTheme(theme), "print", {
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
