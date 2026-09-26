// @vitest-environment jsdom
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ebookProject } from "../../../tests/helpers/ebook-project.js";
import {
  prepareBookPreview,
  presentBookPreview,
} from "../src/main/book-preview.js";
import { generateThemeStyles, getBookTheme } from "@drelwick/renderer";

it("renders the complete ebook in assembled order, selected theme, independent navigation and captured cover without mutation", async () => {
  const f = await ebookProject();
  try {
    const prepared = await prepareBookPreview(f.projectPath, f.projectId);
    const preview = presentBookPreview(prepared);
    const page = new DOMParser().parseFromString(preview.document, "text/html");
    expect(preview.complete).toBe(true);
    expect(preview.theme.themeId).toBe("literary");
    expect(page.querySelector("style")?.textContent).toContain(
      generateThemeStyles(getBookTheme("literary"), "ebook").css,
    );
    const expected = [
      f.assetId,
      ...f.data.pages
        .filter((p) => p.placement === "front" && p.inclusion.ebook)
        .map((p) => p.id),
      ...f.data.body.filter((p) => p.inclusion.ebook).map((p) => p.id),
      ...f.data.pages
        .filter((p) => p.placement === "back" && p.inclusion.ebook)
        .map((p) => p.id),
    ];
    expect(
      Array.from(page.querySelectorAll(".chapter")).map((c) => c.id),
    ).toEqual(expected.map((id) => `chapter-${id}`));
    expect(
      Array.from(page.querySelectorAll("nav a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(
      [
        ...f.data.body.filter(
          (p) => p.inclusion.ebook && p.inclusion.navigation,
        ),
        ...f.data.pages.filter(
          (p) =>
            p.placement === "back" &&
            p.inclusion.ebook &&
            p.inclusion.navigation,
        ),
      ].map((p) => `about:srcdoc#chapter-${p.id}`),
    );
    expect(page.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(page.querySelector("script,[onerror],iframe,object")).toBeNull();
    expect(page.title).toBe(f.data.metadata.title);
    expect(
      page.querySelector('meta[name="description"]')?.getAttribute("content"),
    ).toBe(f.data.metadata.description);
    for (const fontSize of [12, 20, 32])
      for (const appearance of ["light", "dark"] as const) {
        const simulated = presentBookPreview(prepared, prepared.selection, {
          fontSize,
          appearance,
        });
        expect(simulated.document.split("<body>")[1]).toBe(
          preview.document.split("<body>")[1],
        );
        expect(simulated.revision).toBe(preview.revision);
        expect(simulated.theme).toEqual(preview.theme);
      }
    expect(await Promise.all(f.paths.map((path) => readFile(path)))).toEqual(
      f.bytes,
    );
  } finally {
    await f.cleanup();
  }
});

it("reports invalid and missing managed cover assets without losing matter or rewriting sources", async () => {
  const f = await ebookProject();
  try {
    const path = join(
      f.projectPath,
      "assets",
      "images",
      f.assetId,
      "original.png",
    );
    await writeFile(path, "corrupt image");
    const invalid = presentBookPreview(
      await prepareBookPreview(f.projectPath, f.projectId),
    );
    expect(invalid.complete).toBe(false);
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-asset", assetId: f.assetId }),
    );
    await unlink(
      join(f.projectPath, "assets", "images", f.assetId, "asset.json"),
    );
    const missing = presentBookPreview(
      await prepareBookPreview(f.projectPath, f.projectId),
    );
    expect(missing.complete).toBe(false);
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-asset", assetId: f.assetId }),
    );
    expect(missing.document).toContain("Acknowledgements");
    expect(missing.document).not.toContain("file:");
    expect(await Promise.all(f.paths.map((p) => readFile(p)))).toEqual(f.bytes);
  } finally {
    await f.cleanup();
  }
});
