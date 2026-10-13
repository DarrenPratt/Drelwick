import { expect, it } from "vitest";
import { defaultPrintSettings, defaultPrintEditions } from "@drelwick/shared";
import { printRoman, printStyles, printTypography } from "../src/print.js";
import { getBookTheme, generateThemeStyles } from "../src/themes.js";

it("uses shared mirrored geometry and keeps Chromium fragmentation policy explicit", () => {
  const settings = defaultPrintSettings();
  const recto = printStyles(settings, "classic", true);
  const verso = printStyles(settings, "classic", false);
  expect(recto).toContain(
    "@page :right { margin: 19.05mm 19.05mm 19.05mm 22.225mm;",
  );
  expect(verso).toContain(
    "@page :right { margin: 19.05mm 22.225mm 19.05mm 19.05mm;",
  );
  for (const css of [recto, verso]) {
    expect(css).toContain("widows: 2; orphans: 2");
    expect(css).toContain("break-after: avoid; break-inside: avoid");
    expect(css).toContain("hyphens: manual");
    expect(css).toContain("font-synthesis: none");
  }
});
it("formats front-matter folios independently from physical sides", () => {
  expect([1, 4, 9, 12, 49, 99].map(printRoman)).toEqual([
    "i",
    "iv",
    "ix",
    "xii",
    "xlix",
    "xcix",
  ]);
});

it("applies edition overrides without mutating presets or EPUB styles and rejects unsafe values", () => {
  const profile = defaultPrintEditions()["large-print"];
  const before = generateThemeStyles(getBookTheme("modern"), "ebook");
  const css = printStyles(
    profile.settings,
    profile.themeId,
    true,
    profile.typography,
  );
  expect(css).toContain("font-size: 18pt; line-height: 1.5; text-align: left");
  expect(css).toContain("margin: 0 0 0.5em; text-indent: 0em");
  expect(generateThemeStyles(getBookTheme("modern"), "ebook")).toEqual(before);
  expect(printTypography("modern").baseSizePt).toBe(10.5);
  expect(() =>
    printStyles(profile.settings, "modern", true, { baseSizePt: Infinity }),
  ).toThrow();
  expect(() =>
    printStyles(profile.settings, "modern", true, { lineHeight: 3 }),
  ).toThrow();
  expect(() =>
    printStyles(profile.settings, "modern", true, {
      css: "url(file:///private)",
    } as never),
  ).toThrow();
});
