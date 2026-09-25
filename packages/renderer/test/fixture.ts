import { ManuscriptDocumentSchema } from "@drelwick/project-model";
import type { BookRevision } from "../src/index.js";
export const chapterId = "00000000-0000-4000-8000-000000000211";
export const assetId = "00000000-0000-4000-8000-000000000291";
const text = (text: string, marks?: unknown[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const p = (value: string) => ({ type: "paragraph", content: [text(value)] });
export function fixture(): BookRevision {
  return {
    projectId: "00000000-0000-4000-8000-000000000201",
    revision: "fixture-revision",
    title: "Synthetic book",
    language: "en-GB",
    chapters: [
      {
        id: chapterId,
        title: "Chapter & <one>",
        type: "chapter",
        document: ManuscriptDocumentSchema.parse({
          type: "doc",
          content: [
            ...[1, 2, 3, 4, 5, 6].map((level) => ({
              type: "heading",
              attrs: { level },
              content: [text(`Heading ${level}`, [{ type: "italic" }])],
            })),
            {
              type: "paragraph",
              content: [
                text(
                  '<script>alert("x")</script> Tom & Jane; 5 < 10 > 2; "quotes" \'apostrophes\' 日本語 العربية 🌱 é\r\n',
                ),
                ...["bold", "italic", "underline", "strike", "code"].map(
                  (type) => text(` ${type} `, [{ type }]),
                ),
                text("both A", [{ type: "bold" }, { type: "italic" }]),
                text("both B", [{ type: "italic" }, { type: "bold" }]),
                text("partial", [{ type: "italic" }]),
                text(" plain "),
                text("linked emphasis", [
                  { type: "italic" },
                  {
                    type: "link",
                    attrs: {
                      href: "https://example.invalid/?a=1&b=2",
                      title: '"safe" <title>',
                      target: "_top",
                      class: "evil",
                      rel: "opener",
                    },
                  },
                ]),
                { type: "hardBreak", marks: [{ type: "bold" }] },
                text("after break"),
                text("internal", [
                  {
                    type: "link",
                    attrs: { href: `#chapter-${chapterId}-node-0` },
                  },
                ]),
              ],
            },
            {
              type: "blockquote",
              content: [
                p("Quote"),
                { type: "blockquote", content: [p("Nested quote")] },
              ],
            },
            {
              type: "epigraph",
              attrs: { attribution: "Writer & <source>" },
              content: [p("Epigraph one"), p("Epigraph two")],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    p("Outer bullet"),
                    {
                      type: "orderedList",
                      attrs: { start: 3, type: "A" },
                      content: [
                        {
                          type: "listItem",
                          content: [
                            p("Nested ordered"),
                            {
                              type: "bulletList",
                              content: [
                                {
                                  type: "listItem",
                                  content: [p("Deep bullet")],
                                },
                              ],
                            },
                          ],
                        },
                        { type: "listItem", content: [p("Second item")] },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: 'plain"<text>' },
              content: [text("if (a < b) {\n  a & b;\n}")],
            },
            { type: "sceneBreak" },
            { type: "horizontalRule" },
            ...["small", "medium", "large", "full"].map((size) => ({
              type: "image",
              attrs: { assetId, alt: `Image ${size} & "日本語"`, size },
            })),
            { type: "paragraph" },
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
          byteSize: 1,
          sha256: "0".repeat(64),
        },
      },
    ],
  };
}
