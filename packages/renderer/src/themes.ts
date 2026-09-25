import {
  BookThemeSchema,
  type BookTheme,
  type ThemeFont,
} from "@drelwick/project-model";
import {
  BuiltinThemeIdSchema,
  DEFAULT_BOOK_THEME,
  type BuiltinThemeId,
  type BookThemeSelection,
} from "@drelwick/shared";

export const BOOK_THEME_OPTIONS = [
  {
    id: "classic",
    name: "Classic",
    description:
      "Traditional serif prose, indented paragraphs and centered chapter openings.",
  },
  {
    id: "modern",
    name: "Modern",
    description:
      "Clean sans-serif prose, spaced paragraphs and left-aligned openings.",
  },
  {
    id: "literary",
    name: "Literary",
    description:
      "Bookish serif prose, generous openings and restrained diamond scene breaks.",
  },
] as const;
const classic: BookTheme = {
  schemaVersion: 1,
  id: "classic",
  name: "Classic",
  typography: {
    bodyFont: "traditional-serif",
    headingFont: "traditional-serif",
    baseSizeRem: 1,
    lineHeight: 1.55,
    paragraphIndentEm: 1.25,
    paragraphSpacingEm: 0,
    alignment: "justify",
  },
  chapterOpening: {
    spaceBeforeEm: 3,
    spaceAfterEm: 2,
    titleSizeEm: 2,
    alignment: "center",
    divider: true,
  },
  headings: { weight: 700, spaceBeforeEm: 1.5, spaceAfterEm: 0.75 },
  quote: { indentEm: 1.5, spacingEm: 1, fontStyle: "normal" },
  epigraph: {
    alignment: "center",
    widthPercent: 75,
    spacingEm: 1.5,
    fontStyle: "italic",
  },
  sceneBreak: { variant: "rule", spacingEm: 1.5, widthPercent: 25 },
  targetOverrides: {
    ebook: {},
    print: { baseSizePt: 11, lineHeight: 1.4, paragraphSpacingEm: 0 },
  },
};
const presets: Record<BuiltinThemeId, BookTheme> = {
  classic,
  modern: {
    ...classic,
    id: "modern",
    name: "Modern",
    typography: {
      bodyFont: "humanist-sans",
      headingFont: "humanist-sans",
      baseSizeRem: 1,
      lineHeight: 1.65,
      paragraphIndentEm: 0,
      paragraphSpacingEm: 0.75,
      alignment: "left",
    },
    chapterOpening: {
      spaceBeforeEm: 1.5,
      spaceAfterEm: 1.5,
      titleSizeEm: 2.25,
      alignment: "left",
      divider: false,
    },
    headings: { weight: 600, spaceBeforeEm: 1.75, spaceAfterEm: 0.5 },
    quote: { indentEm: 1, spacingEm: 1.25, fontStyle: "normal" },
    epigraph: {
      alignment: "left",
      widthPercent: 90,
      spacingEm: 1.25,
      fontStyle: "normal",
    },
    sceneBreak: { variant: "space", spacingEm: 2.5, widthPercent: 30 },
    targetOverrides: {
      ebook: {},
      print: { baseSizePt: 10.5, lineHeight: 1.5, paragraphSpacingEm: 0.5 },
    },
  },
  literary: {
    ...classic,
    id: "literary",
    name: "Literary",
    typography: {
      bodyFont: "literary-serif",
      headingFont: "traditional-serif",
      baseSizeRem: 1.0625,
      lineHeight: 1.6,
      paragraphIndentEm: 1.5,
      paragraphSpacingEm: 0.125,
      alignment: "left",
    },
    chapterOpening: {
      spaceBeforeEm: 4.5,
      spaceAfterEm: 2.5,
      titleSizeEm: 1.75,
      alignment: "center",
      divider: false,
    },
    headings: { weight: 400, spaceBeforeEm: 2, spaceAfterEm: 0.75 },
    quote: { indentEm: 2, spacingEm: 1.5, fontStyle: "italic" },
    epigraph: {
      alignment: "right",
      widthPercent: 65,
      spacingEm: 2,
      fontStyle: "italic",
    },
    sceneBreak: { variant: "diamond", spacingEm: 2, widthPercent: 15 },
    targetOverrides: {
      ebook: { baseSizeRem: 1 },
      print: { baseSizePt: 11.5, lineHeight: 1.45, paragraphSpacingEm: 0 },
    },
  },
};
/** Returns a validated copy, so consumers cannot mutate the built-in catalogue. */
export function getBookTheme(id: BuiltinThemeId): BookTheme {
  const parsed = BuiltinThemeIdSchema.safeParse(id);
  if (!parsed.success) throw new Error("Invalid built-in theme identity.");
  return BookThemeSchema.parse(presets[parsed.data]);
}
export function resolveBookTheme(
  savedThemeId: string = DEFAULT_BOOK_THEME,
): BookThemeSelection {
  const parsed = BuiltinThemeIdSchema.safeParse(savedThemeId);
  return parsed.success
    ? { savedThemeId, themeId: parsed.data }
    : {
        savedThemeId,
        themeId: DEFAULT_BOOK_THEME,
        warning: "unavailable-theme",
      };
}
const fontStacks: Record<ThemeFont, string> = {
  "traditional-serif": 'Georgia, "Times New Roman", "Liberation Serif", serif',
  "humanist-sans":
    '"Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", sans-serif',
  "literary-serif":
    'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, "Liberation Serif", serif',
};
export type ThemeTarget = "ebook" | "print";
export interface ThemeStyles {
  themeId: BuiltinThemeId;
  target: ThemeTarget;
  css: string;
  requiredAssets: readonly [];
}
/** Pure presentation only: this API deliberately accepts no manuscript or markup. */
export function generateThemeStyles(
  input: BookTheme,
  target: ThemeTarget,
  options: { fontPolicy?: "system-fallbacks" | "generic-only" } = {},
): ThemeStyles {
  const parsed = BookThemeSchema.safeParse(input);
  if (
    !parsed.success ||
    !["ebook", "print"].includes(target) ||
    (options.fontPolicy !== undefined &&
      !["system-fallbacks", "generic-only"].includes(options.fontPolicy))
  )
    throw new Error("Invalid book theme configuration.");
  const theme = parsed.data;
  const font = (token: ThemeFont) =>
    options.fontPolicy === "generic-only"
      ? token === "humanist-sans"
        ? "sans-serif"
        : "serif"
      : fontStacks[token];
  const typography = theme.typography;
  const override = theme.targetOverrides[target];
  const size =
    target === "ebook"
      ? `${theme.targetOverrides.ebook.baseSizeRem ?? typography.baseSizeRem}rem`
      : `${theme.targetOverrides.print.baseSizePt}pt`;
  const chapter = theme.chapterOpening;
  const scene = theme.sceneBreak;
  const rule = (selector: string, declarations: string) =>
    `${selector} { ${declarations} }`;
  const css =
    [
      rule(
        ".chapter",
        `color: #111; background-color: #fff; font-family: ${font(typography.bodyFont)}; font-size: ${size}; line-height: ${override.lineHeight ?? typography.lineHeight}; text-align: ${typography.alignment};`,
      ),
      rule(
        ".chapter p",
        `margin: 0 0 ${override.paragraphSpacingEm ?? typography.paragraphSpacingEm}em; text-indent: ${typography.paragraphIndentEm}em;`,
      ),
      rule(
        ".chapter-title",
        `font-family: ${font(typography.headingFont)}; font-size: ${chapter.titleSizeEm}em; font-weight: ${theme.headings.weight}; line-height: 1.2; text-align: ${chapter.alignment}; margin: ${chapter.spaceBeforeEm}em 0 ${chapter.spaceAfterEm}em;`,
      ),
      rule(
        ".chapter-title::after",
        chapter.divider
          ? 'content: ""; display: block; width: 3em; margin: 0.75em auto 0; border-top: 1px solid currentColor;'
          : "content: none;",
      ),
      rule(
        ".chapter-body h1, .chapter-body h2, .chapter-body h3, .chapter-body h4, .chapter-body h5, .chapter-body h6",
        `font-family: ${font(typography.headingFont)}; font-weight: ${theme.headings.weight}; line-height: 1.25; margin: ${theme.headings.spaceBeforeEm}em 0 ${theme.headings.spaceAfterEm}em; text-align: left;`,
      ),
      rule(
        ".chapter-body > p:first-child, .chapter-body > h1 + p, .chapter-body > h2 + p, .chapter-body > h3 + p, .chapter-body > h4 + p, .chapter-body > h5 + p, .chapter-body > h6 + p, .scene-break + p",
        "text-indent: 0;",
      ),
      rule(
        ".chapter blockquote",
        `margin: ${theme.quote.spacingEm}em ${theme.quote.indentEm}em; font-style: ${theme.quote.fontStyle};`,
      ),
      rule(".chapter blockquote p, .chapter li p", "text-indent: 0;"),
      rule(
        ".chapter .epigraph",
        `width: ${theme.epigraph.widthPercent}%; margin: ${theme.epigraph.spacingEm}em auto; text-align: ${theme.epigraph.alignment}; font-style: ${theme.epigraph.fontStyle};`,
      ),
      rule(".chapter .epigraph blockquote", "margin: 0; font-style: inherit;"),
      rule(
        ".chapter .epigraph figcaption",
        "margin-top: 0.75em; font-style: normal;",
      ),
      rule(
        ".chapter .scene-break",
        `display: block; height: ${scene.variant === "diamond" ? "0.6em" : "0"}; width: ${scene.widthPercent}%; margin: ${scene.spacingEm}em auto; padding: 0; border: 0; overflow: visible;`,
      ),
      rule(
        ".chapter .scene-break::after",
        scene.variant === "space"
          ? "content: none;"
          : scene.variant === "rule"
            ? 'content: ""; display: block; border-top: 1px solid currentColor;'
            : 'content: ""; display: block; width: 0.4em; height: 0.4em; margin: auto; border: 1px solid currentColor; transform: rotate(45deg);',
      ),
      rule(
        ".chapter .manuscript-image",
        "display: block; height: auto; max-width: 100%; margin: 1em auto;",
      ),
      ...(
        [
          ["small", 25],
          ["medium", 50],
          ["large", 75],
          ["full", 100],
        ] as const
      ).map(([name, width]) =>
        rule(`.chapter .image-${name}`, `width: ${width}%;`),
      ),
      rule(
        ".chapter a, .chapter .manuscript-link",
        "color: inherit; text-decoration: underline;",
      ),
      rule(".chapter pre", "white-space: pre-wrap; text-align: left;"),
      rule(".chapter ul, .chapter ol", "text-align: left;"),
    ].join("\n") + "\n";
  return { themeId: theme.id, target, css, requiredAssets: [] };
}
