import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ManuscriptDocumentSchema } from "@drelwick/project-model";
import { generateEpub, validateEpubArchive } from "../src/epub-export.js";

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
  it("creates an EPUB 3.0 container with required publication metadata", () => {
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
    expect(opf).toContain('version="3.0"');
    expect(opf).toMatch(
      /<meta property="dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/meta>/,
    );
    expect(opf).toContain("spine");
    expect(opf).toContain("fr-CA");
  });

  it("packages referenced managed images, accessible alternatives and internal links", () => {
    const image = Uint8Array.from([137, 80, 78, 71]);
    const targetId = "00000000-0000-4000-8000-000000000003";
    const assetId = "00000000-0000-4000-8000-000000000004";
    const output = generateEpub({
      book: {
        ...book,
        coverAssetId: assetId,
        chapters: [
          {
            id,
            title: "One / Unsafe title",
            type: "chapter",
            document: ManuscriptDocumentSchema.parse({
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: {
                    assetId,
                    alt: "A descriptive cover",
                    size: "medium",
                  },
                },
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Read the next chapter",
                      marks: [
                        {
                          type: "link",
                          attrs: { href: `#chapter-${targetId}` },
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          },
          {
            id: targetId,
            title: "Target",
            type: "chapter",
            document: ManuscriptDocumentSchema.parse({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Target text" }],
                },
              ],
            }),
          },
        ],
        assets: [
          {
            status: "available",
            descriptor: {
              id: assetId,
              mediaType: "image/png",
              width: 1,
              height: 1,
              byteSize: image.length,
              sha256: createHash("sha256").update(image).digest("hex"),
            },
          },
        ],
      },
      assets: new Map([[assetId, image]]),
      presentation: {
        schemaVersion: 1,
        projectId: book.projectId,
        themeId: "classic",
      },
    });
    const files = unzipSync(output.bytes);
    const first = new TextDecoder().decode(
      files[`OEBPS/${id.replace(/-/g, "")}.xhtml`],
    );
    const opf = new TextDecoder().decode(files["OEBPS/package.opf"]);
    expect(files[`OEBPS/images/${assetId.replace(/-/g, "")}.png`]).toEqual(
      image,
    );
    expect(first).toContain('alt="A descriptive cover"');
    expect(first).toContain(
      `href="${targetId.replace(/-/g, "")}.xhtml#chapter-${targetId}"`,
    );
    expect(opf).toContain('properties="cover-image"');
    expect(output.warnings).toEqual([]);
  });

  it("rejects broken internal references before producing a package", () => {
    expect(() =>
      generateEpub({
        book: {
          ...book,
          chapters: [
            {
              id,
              title: "One / Unsafe title",
              type: "chapter",
              document: ManuscriptDocumentSchema.parse({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Broken",
                        marks: [
                          {
                            type: "link",
                            attrs: {
                              href: "#chapter-00000000-0000-4000-8000-000000000099",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              }),
            },
          ],
        },
        assets: new Map(),
        presentation: {
          schemaVersion: 1,
          projectId: book.projectId,
          themeId: "classic",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "EPUB_CONTENT_INVALID" }));
  });

  it("rejects malformed archives during structural validation", () => {
    expect(() => validateEpubArchive(Uint8Array.from([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: "EPUB_VALIDATION_FAILED" }),
    );
  });

  it("exports a synthetic 100,000-word book without truncating or reordering chapters", () => {
    const chapters = Array.from({ length: 100 }, (_, chapter) => ({
      id: `00000000-0000-4000-8000-${String(chapter + 1).padStart(12, "0")}`,
      title: `Chapter ${chapter + 1}`,
      type: "chapter" as const,
      document: ManuscriptDocumentSchema.parse({
        type: "doc",
        content: Array.from({ length: 100 }, (_, paragraph) => ({
          type: "paragraph",
          content: [
            {
              type: "text",
              text: `${chapter}:${paragraph} Café 日本語 one two three four five six seven`,
            },
          ],
        })),
      }),
    }));
    const output = generateEpub({
      book: { ...book, chapters },
      assets: new Map(),
      presentation: {
        schemaVersion: 1,
        projectId: book.projectId,
        themeId: "literary",
      },
    });
    const files = unzipSync(output.bytes);
    const opf = new TextDecoder().decode(files["OEBPS/package.opf"]);
    expect(
      [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(
      chapters.map((chapter) => `id-${chapter.id.replace(/-/g, "")}-xhtml`),
    );
    for (const [index, chapter] of chapters.entries()) {
      const content = new TextDecoder().decode(
        files[`OEBPS/${chapter.id.replace(/-/g, "")}.xhtml`],
      );
      expect([...content.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1])).toEqual(
        Array.from(
          { length: 100 },
          (_, paragraph) =>
            `${index}:${paragraph} Café 日本語 one two three four five six seven`,
        ),
      );
    }
  });

  it("refuses a missing selected cover before producing an EPUB", () => {
    expect(() =>
      generateEpub({
        book: { ...book, coverAssetId: "00000000-0000-4000-8000-000000000099" },
        assets: new Map(),
        presentation: {
          schemaVersion: 1,
          projectId: book.projectId,
          themeId: "classic",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "EPUB_COVER_INVALID" }));
  });
});
