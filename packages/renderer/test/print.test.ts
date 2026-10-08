import { expect, it } from "vitest";
import { defaultPrintSettings } from "@drelwick/shared";
import { printRoman, printStyles } from "../src/print.js";

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
