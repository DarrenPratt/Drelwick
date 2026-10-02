import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ManuscriptDocumentSchema } from "@drelwick/project-model";
import { generateEpub } from "../src/epub-export.js";

const id = "00000000-0000-4000-8000-000000000001";
const book = {
  projectId: "00000000-0000-4000-8000-000000000002",
  revision: "a".repeat(64),
  title: "A Unicode & Safe Book",
  language: "fr-CA",
  metadata: {
    title: "A Unicode & Safe Book",
    author: "A. Author",
    language: "fr-CA",
    description: "Description",
    identifiers: [{ scheme: "uuid" as const, value: "urn:uuid:book-1" }],
  },
  chapters: [
    {
      id,
      title: "One / Unsafe title",
      type: "chapter" as const,
      document: ManuscriptDocumentSchema.parse({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Bonjour 日本語" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Safe & <escaped>" }],
          },
        ],
      }),
    },
  ],
  assets: [],
};

describe("EPUB export", () => {
  it("creates an EPUB 3.3 container with safe semantic resources", () => {
    const output = generateEpub({
      book,
      assets: new Map(),
      presentation: {
        schemaVersion: 1,
        projectId: book.projectId,
        themeId: "classic",
      },
    });
    const files = unzipSync(output.bytes);
    expect(new TextDecoder().decode(files.mimetype)).toBe(
      "application/epub+zip",
    );
    expect(files["META-INF/container.xml"]).toBeDefined();
    expect(files["OEBPS/package.opf"]).toBeDefined();
    expect(files["OEBPS/nav.xhtml"]).toBeDefined();
    expect(files["OEBPS/styles/book.css"]).toBeDefined();
    const content = new TextDecoder().decode(
      files[`OEBPS/${id.replace(/-/g, "")}.xhtml`],
    );
    expect(content).toContain("Bonjour 日本語");
    expect(content).toContain("Safe &amp; &lt;escaped&gt;");
    expect(content).toContain('lang="fr-CA"');
    expect(content).not.toContain("data-");
    const opf = new TextDecoder().decode(files["OEBPS/package.opf"]);
    expect(opf).toContain('version="3.3"');
    expect(opf).toContain("spine");
    expect(opf).toContain("fr-CA");
  });
});
