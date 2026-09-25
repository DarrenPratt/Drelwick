// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { renderBook } from "@drelwick/renderer";
import { fixture } from "../../../packages/renderer/test/fixture.js";
import {
  presentBookPreview,
  type PreparedBookPreview,
} from "../src/main/book-preview.js";

it("authorizes exactly the validated preset stylesheet while retaining passive semantic content and isolation policy", () => {
  const book = fixture();
  const rendered = renderBook(book, {
    links: "inert",
    resolveAsset: () => undefined,
  });
  const prepared: PreparedBookPreview = {
    projectId: book.projectId,
    language: book.language,
    markup: rendered.chapters.map((chapter) => chapter.xhtml).join(""),
    revision: rendered.revision,
    complete: rendered.ok,
    diagnostics: rendered.diagnostics,
    selection: { savedThemeId: "classic", themeId: "classic" },
  };
  for (const themeId of ["classic", "modern", "literary"] as const) {
    const result = presentBookPreview(prepared, {
      savedThemeId: themeId,
      themeId,
    });
    const page = new DOMParser().parseFromString(result.document, "text/html");
    const css = page.querySelector("style")!.textContent!;
    const policy = page
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute("content")!;
    expect(policy).toContain(
      `style-src 'sha256-${createHash("sha256").update(css).digest("base64")}'`,
    );
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "font-src 'none'",
      "style-src-attr 'none'",
      "connect-src 'none'",
    ])
      expect(policy).toContain(directive);
    expect(policy).not.toContain("unsafe-inline");
    expect(
      page.querySelector("script,iframe,object,[style],[onclick],a"),
    ).toBeNull();
    expect(page.body.innerHTML).toBe(
      new DOMParser().parseFromString(prepared.markup, "text/html").body
        .innerHTML,
    );
    expect(page.body.textContent).toContain('<script>alert("x")</script>');
  }
});
