import { afterEach, expect, it, vi } from "vitest";
import {
  BookThemeSchema,
  BookPresentationSchema,
} from "@drelwick/project-model";
import {
  BOOK_THEME_OPTIONS,
  generateThemeStyles,
  getBookTheme,
  resolveBookTheme,
  renderBook,
} from "../src/index.js";
import { fixture } from "./fixture.js";

afterEach(() => vi.unstubAllGlobals());
for (const { id } of BOOK_THEME_OPTIONS) {
  for (const target of ["ebook", "print"] as const) {
    it(`${id}/${target} matches golden CSS, preserves exact semantic markup and works without network`, async () => {
      const fetch = vi.fn(() => {
        throw new Error("Network unavailable");
      });
      vi.stubGlobal("fetch", fetch);
      const book = fixture();
      const before = JSON.stringify(book);
      const rendered = renderBook(book, {
        links: "inert",
        resolveAsset: () => ({ kind: "relative", value: "images/local.png" }),
      });
      const markup = rendered.chapters.map((chapter) => chapter.xhtml).join("");
      const styles = generateThemeStyles(getBookTheme(id), target);
      await expect(styles.css).toMatchFileSnapshot(
        `golden/${id}-${target}.css`,
      );
      expect(generateThemeStyles(getBookTheme(id), target)).toEqual(styles);
      const page = new DOMParser().parseFromString(
        `<style>${styles.css}</style>${markup}`,
        "text/html",
      );
      const baseline = new DOMParser().parseFromString(markup, "text/html");
      expect(page.body.innerHTML).toBe(baseline.body.innerHTML);
      expect(page.body.textContent).toBe(baseline.body.textContent);
      expect(JSON.stringify(book)).toBe(before);
      expect(styles.requiredAssets).toEqual([]);
      expect(styles.css).not.toMatch(
        /url\(|@import|@font-face|https?:|file:|<script|@page|ProseMirror/i,
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(page.querySelector("hr.scene-break")).not.toBeNull();
      expect(styles.css).not.toMatch(/content: "[^"\n]+"/);
    });
  }
  it(`${id} falls back to local generic fonts when preferred fonts are unavailable`, () => {
    const styles = generateThemeStyles(getBookTheme(id), "ebook", {
      fontPolicy: "generic-only",
    });
    const families = Array.from(
      styles.css.matchAll(/font-family: ([^;]+);/g),
      (match) => match[1],
    );
    expect(families.length).toBeGreaterThan(0);
    expect(
      families.every((family) => family === "serif" || family === "sans-serif"),
    ).toBe(true);
    expect(styles).toEqual(
      generateThemeStyles(getBookTheme(id), "ebook", {
        fontPolicy: "generic-only",
      }),
    );
    expect(styles.requiredAssets).toEqual([]);
  });
}

it("presets differ across presentation roles, target overrides remain small, and the catalogue is immutable to callers", () => {
  const themes = BOOK_THEME_OPTIONS.map(({ id }) => getBookTheme(id));
  for (const role of [
    "typography",
    "chapterOpening",
    "quote",
    "epigraph",
    "sceneBreak",
  ] as const)
    expect(
      new Set(themes.map((theme) => JSON.stringify(theme[role]))).size,
    ).toBe(3);
  const theme = getBookTheme("classic");
  expect(generateThemeStyles(theme, "ebook").css).toContain("font-size: 1rem");
  expect(generateThemeStyles(theme, "print").css).toContain("font-size: 11pt");
  theme.typography.baseSizeRem = 1.2;
  expect(getBookTheme("classic").typography.baseSizeRem).toBe(1);
  expect(resolveBookTheme("future-theme")).toEqual({
    savedThemeId: "future-theme",
    themeId: "classic",
    warning: "unavailable-theme",
  });
});

it("rejects invalid versions, fields, ranges, enums, target overrides and unsafe resource/CSS values", () => {
  const base = getBookTheme("classic");
  const invalid: unknown[] = [
    {},
    { ...base, schemaVersion: 2 },
    { ...base, id: "other" },
    { ...base, quote: undefined },
    { ...base, sceneBreak: { ...base.sceneBreak, variant: "script" } },
    { ...base, typography: { ...base.typography, baseSizeRem: 100 } },
    { ...base, typography: { ...base.typography, lineHeight: 0 } },
    { ...base, typography: { ...base.typography, lineHeight: Infinity } },
    {
      ...base,
      targetOverrides: {
        ebook: { baseSizeRem: -1 },
        print: base.targetOverrides.print,
      },
    },
    { ...base, targetOverrides: { ...base.targetOverrides, screen: {} } },
  ];
  for (const value of [
    "javascript:alert(1)",
    "<script>alert(1)</script>",
    "url(https://remote.invalid/font)",
    '@import "remote.css"',
    "serif; color: red",
    "file:///secret",
    "../fonts/font.ttf",
    "C:\\Fonts\\font.ttf",
  ]) {
    invalid.push(
      { ...base, typography: { ...base.typography, bodyFont: value } },
      { ...base, customCss: value },
      { ...base, fontPath: value },
      { ...base, id: value },
    );
    expect(
      BookPresentationSchema.safeParse({
        schemaVersion: 1,
        projectId: fixture().projectId,
        themeId: value,
      }).success,
    ).toBe(false);
  }
  for (const input of invalid) {
    expect(BookThemeSchema.safeParse(input).success).toBe(false);
    expect(() => generateThemeStyles(input as typeof base, "ebook")).toThrow(
      "Invalid book theme configuration.",
    );
  }
});
