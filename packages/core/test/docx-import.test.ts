import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import sharp from "sharp";
import {
  DocxManuscriptImporter,
  StagedManuscriptImport,
  validateProjectFiles,
  loadChapter,
  DOCX_LIMITS,
  IsolatedManuscriptImporter,
} from "@sarel/core";
import { validateImportedManuscript } from "@sarel/project-model";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
import {
  docx,
  documentXml,
  mixedNovel,
  namespaces,
  p,
  parts,
  rel,
  relationships,
  unicode,
  zipParts,
} from "./fixtures/docx.js";

const importer = new DocxManuscriptImporter();
const signal = () => new AbortController().signal;
const parse = async (bytes: Uint8Array) =>
  validateImportedManuscript(await importer.parse(bytes, signal()));
function texts(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if ("type" in value && value.type === "text" && "text" in value)
    return [String(value.text)];
  if ("content" in value && Array.isArray(value.content))
    return value.content.flatMap(texts);
  return [];
}
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("golden mixed novel: exact Unicode, run order, chapter proposals, headings and emphasis", async () => {
  const result = await parse(mixedNovel());
  expect(result.chapters.map((c) => c.title)).toEqual([
    "Opening",
    "Chapter One",
    "Chapter Two",
  ]);
  expect(result.chapters.map((c) => texts(c.content))).toEqual([
    ["Preface"],
    ["Chapter One", unicode, " bold", " italic", " both", "Section"],
    ["Chapter Two", "End."],
  ]);
  expect(result.chapters[1]!.content.content).toEqual([
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Chapter One" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: unicode },
        { type: "text", text: " bold", marks: [{ type: "bold" }] },
        { type: "text", text: " italic", marks: [{ type: "italic" }] },
        {
          type: "text",
          text: " both",
          marks: [{ type: "bold" }, { type: "italic" }],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section" }],
    },
  ]);
  expect(result.warnings.map((w) => w.code)).toEqual([
    "DOCX_METADATA_DEFAULT",
    "DOCX_CHAPTER_PROPOSAL",
    "DOCX_CHAPTER_PROPOSAL",
  ]);
});
it("joins adjacent unformatted Word runs without inserting spaces or reordering", async () => {
  const r = await parse(
    docx(
      "<w:p><w:r><w:t>hel</w:t></w:r><w:r><w:t>lo</w:t></w:r><w:r><w:tab/><w:t>world</w:t><w:br/><w:t>end</w:t></w:r></w:p>",
    ),
  );
  expect(r.chapters[0]!.content.content).toEqual([
    {
      type: "paragraph",
      content: [
        { type: "text", text: "hello\tworld" },
        { type: "hardBreak" },
        { type: "text", text: "end" },
      ],
    },
  ]);
});
it("resolves based-on styles and explicit run emphasis overrides", async () => {
  const r = await parse(
    docx(
      '<w:p><w:pPr><w:pStyle w:val="Custom"/></w:pPr><w:r><w:t>styled</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t> override</w:t></w:r></w:p>',
      {
        "word/_rels/document.xml.rels": relationships(
          rel("styles", "styles", "styles.xml"),
        ),
        "word/styles.xml": `<w:styles ${namespaces}><w:style w:styleId="Base"><w:name w:val="heading 1"/><w:rPr><w:b/></w:rPr></w:style><w:style w:styleId="Custom"><w:basedOn w:val="Base"/></w:style></w:styles>`,
      },
    ),
  );
  expect(r.chapters[0]!.content.content?.[0]).toMatchObject({
    type: "heading",
    attrs: { level: 1 },
    content: [
      { text: "styled", marks: [{ type: "bold" }] },
      { text: " override", marks: [{ type: "italic" }] },
    ],
  });
});
it("golden lists preserve ordered start, mixed nesting and item order", async () => {
  const item = (s: string, id: string, level = 0) =>
    p(
      s,
      `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr>`,
    );
  const r = await parse(
    docx(
      item("one", "1") +
        item("nested", "1", 1) +
        item("two", "1") +
        p("break") +
        item("bullet", "2"),
      {
        "word/_rels/document.xml.rels": relationships(
          rel("n", "numbering", "numbering.xml"),
        ),
        "word/numbering.xml": `<w:numbering ${namespaces}><w:abstractNum w:abstractNumId="a"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="b"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="a"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="b"/></w:num></w:numbering>`,
      },
    ),
  );
  const nodes = r.chapters[0]!.content.content!;
  expect(texts(r.chapters[0]!.content)).toEqual([
    "one",
    "nested",
    "two",
    "break",
    "bullet",
  ]);
  expect(nodes[0]).toMatchObject({
    type: "orderedList",
    attrs: { start: 3 },
    content: [
      {
        type: "listItem",
        content: [
          { type: "paragraph" },
          { type: "bulletList", content: [{ type: "listItem" }] },
        ],
      },
      { type: "listItem" },
    ],
  });
  expect(nodes[2]).toMatchObject({ type: "bulletList" });
});
it("hyperlinks are data only; unsafe links retain visible text with a warning", async () => {
  const r = await parse(
    docx(
      '<w:p><w:hyperlink r:id="safe"><w:r><w:t>safe</w:t></w:r></w:hyperlink><w:hyperlink r:id="bad"><w:r><w:t>bad</w:t></w:r></w:hyperlink></w:p>',
      {
        "word/_rels/document.xml.rels": relationships(
          rel("safe", "hyperlink", "https://offline.invalid/book", true) +
            rel("bad", "hyperlink", "javascript:alert(1)", true),
        ),
      },
    ),
  );
  expect(r.chapters[0]!.content.content?.[0]).toMatchObject({
    content: [
      {
        text: "safe",
        marks: [
          { type: "link", attrs: { href: "https://offline.invalid/book" } },
        ],
      },
      { text: "bad" },
    ],
  });
  expect(r.warnings.some((w) => w.code === "DOCX_LINK")).toBe(true);
});
const drawing = (external = false) =>
  `<w:r><w:drawing><wp:inline><wp:docPr id="1" descr="海 illustration"/><a:graphic><a:blip r:${external ? "link" : "embed"}="image"/></a:graphic></wp:inline></w:drawing></w:r>`;
it.each(["png", "jpeg"] as const)(
  "golden embedded %s preserves bytes, alt text and inline reading position through staging/commit",
  async (format) => {
    const image = await syntheticImage(format);
    const bytes = docx(
      `<w:p><w:r><w:t>before</w:t></w:r>${drawing()}<w:r><w:t>after</w:t></w:r></w:p>`,
      {
        "word/_rels/document.xml.rels": relationships(
          rel("image", "image", "media/not-an-extension.bin"),
        ),
        "word/media/not-an-extension.bin": image,
      },
    );
    const root = await mkdtemp(join(tmpdir(), "sarel-docx-"));
    roots.push(root);
    const source = join(root, "novel.docx"),
      dest = join(root, "destination");
    await writeFile(source, bytes);
    await mkdir(dest);
    const stage = await StagedManuscriptImport.inspect(source, importer, {
      signal: signal(),
      temporaryRoot: root,
    });
    expect(
      stage.preview.chapters[0]!.content.content?.map((n) => n.type),
    ).toEqual(["paragraph", "image", "paragraph"]);
    expect(stage.preview.assets[0]!.base64).toBe(image.toString("base64"));
    expect(stage.preview.chapters[0]!.content.content?.[1]).toMatchObject({
      attrs: { alt: "海 illustration", size: "medium" },
    });
    expect(await readFile(source)).toEqual(Buffer.from(bytes));
    await stage.commit(dest, { signal: signal() });
    const project = await validateProjectFiles(dest);
    const chapter = await loadChapter({
      projectPath: dest,
      chapterId: project.project.manuscript.order[0]!,
    });
    expect(texts(chapter.content)).toEqual(["before", "after"]);
    expect(await readFile(source)).toEqual(Buffer.from(bytes));
  },
);

it("rejects oversized decoded DOCX images before staging", async () => {
  const image = await sharp({
    create: { width: 12001, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const bytes = docx(`<w:p>${drawing()}</w:p>`, {
    "word/_rels/document.xml.rels": relationships(
      rel("image", "image", "media/image.png"),
    ),
    "word/media/image.png": image,
  });
  const root = await mkdtemp(join(tmpdir(), "sarel-docx-"));
  roots.push(root);
  const source = join(root, "source.docx");
  await writeFile(source, bytes);
  await expect(
    StagedManuscriptImport.inspect(source, importer, {
      signal: signal(),
      temporaryRoot: root,
    }),
  ).rejects.toBeDefined();
  expect(await readdir(root)).toEqual(["source.docx"]);
  expect(await readFile(source)).toEqual(Buffer.from(bytes));
});
it("bounds aggregate asset bytes even when individual archive entries fit", async () => {
  const entries: Record<string, string | Uint8Array> = {};
  let body = "",
    rels = "";
  for (let i = 0; i < 3; i++) {
    const image = new Uint8Array(17 * 1024 * 1024);
    image.set([137, 80, 78, 71, 13, 10, 26, 10]);
    entries[`word/media/${i}.png`] = image;
    rels += rel(`i${i}`, "image", `media/${i}.png`);
    body += `<w:p>${drawing().replace('="image"', `="i${i}"`)}</w:p>`;
  }
  entries["word/_rels/document.xml.rels"] = relationships(rels);
  await expect(parse(docx(body, entries))).rejects.toMatchObject({
    code: "DOCX_LIMIT",
  });
}, 15000);
it("never fetches an external image and retains alternative text", async () => {
  const r = await parse(
    docx(`<w:p>${drawing(true)}</w:p>`, {
      "word/_rels/document.xml.rels": relationships(
        rel("image", "image", "https://offline.invalid/image.png", true),
      ),
    }),
  );
  expect(r.assets).toEqual([]);
  expect(texts(r.chapters[0]!.content)).toEqual([
    "[External image: 海 illustration]",
  ]);
  expect(r.warnings.some((w) => w.code === "DOCX_EXTERNAL_IMAGE")).toBe(true);
});
it("golden recovery: table cells, notes, comments, fields and text box exact order", async () => {
  const body =
    p("before") +
    `<w:tbl><w:tr><w:tc>${p("cell A")}</w:tc><w:tc>${p("cell B")}</w:tc></w:tr></w:tbl>` +
    `<w:p><w:r><w:t>reference</w:t><w:footnoteReference w:id="1"/><w:endnoteReference w:id="2"/><w:commentReference w:id="3"/></w:r></w:p>` +
    `<w:p><w:fldSimple w:instr="INCLUDETEXT https://offline.invalid/private"><w:r><w:t>visible result</w:t></w:r></w:fldSimple></w:p>` +
    `<w:p><w:r><w:drawing><w:txbxContent>${p("box text")}</w:txbxContent></w:drawing></w:r></w:p>` +
    p("after");
  const r = await parse(
    docx(body, {
      "word/_rels/document.xml.rels": relationships(
        rel("f", "footnotes", "footnotes.xml") +
          rel("e", "endnotes", "endnotes.xml") +
          rel("c", "comments", "comments.xml"),
      ),
      "word/footnotes.xml": `<w:footnotes ${namespaces}><w:footnote w:id="1">${p("foot text")}</w:footnote></w:footnotes>`,
      "word/endnotes.xml": `<w:endnotes ${namespaces}><w:endnote w:id="2">${p("end text")}</w:endnote></w:endnotes>`,
      "word/comments.xml": `<w:comments ${namespaces}><w:comment w:id="3">${p("comment text")}</w:comment></w:comments>`,
    }),
  );
  expect(texts(r.chapters[0]!.content)).toEqual([
    "before",
    "cell A",
    "cell B",
    "reference",
    "[footnote]",
    "foot text",
    "[endnote]",
    "end text",
    "[comment]",
    "comment text",
    "visible result",
    "box text",
    "after",
  ]);
  expect(r.warnings.map((w) => w.code)).toEqual([
    "DOCX_METADATA_DEFAULT",
    "DOCX_TABLE",
    "DOCX_NOTE",
    "DOCX_NOTE",
    "DOCX_NOTE",
    "DOCX_FIELD",
    "DOCX_TEXT_BOX",
  ]);
  for (const w of r.warnings)
    expect(w.location.label).toMatch(/document.*paragraph/i);
});
it.each(["ins", "del", "moveFrom", "moveTo", "rPrChange"])(
  "blocks unresolved tracked %s instead of concatenating revision versions",
  async (kind) => {
    await expect(
      parse(
        docx(
          `<w:p><w:${kind}><w:r><w:t>revision</w:t></w:r></w:${kind}></w:p>`,
        ),
      ),
    ).rejects.toMatchObject({ code: "DOCX_REVISIONS" });
  },
);
it("imports core metadata without forcing subject into description", async () => {
  const r = await parse(
    docx(p("novel"), {
      "_rels/.rels": relationships(
        rel("main", "officeDocument", "word/document.xml") +
          `<Relationship Id="meta" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
      ),
      "docProps/core.xml":
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title><dc:creator>Author</dc:creator><dc:description>Description</dc:description><dc:language>fr</dc:language><dc:subject>Subject</dc:subject></cp:coreProperties>',
    }),
  );
  expect(r.metadata).toEqual({
    title: "Book",
    author: "Author",
    description: "Description",
    language: "fr",
  });
  expect(r.warnings.map((w) => w.code)).toEqual(["DOCX_METADATA"]);
});
it.each([
  "../escape",
  "/absolute",
  "word/../../escape",
  "word\\escape",
  "word/%2e%2e/escape",
])("rejects ZIP path %s", async (name) => {
  await expect(
    parse(docx(p("text"), { [name]: "data" })),
  ).rejects.toMatchObject({ code: "DOCX_ZIP" });
});
it.each([
  "../../escape",
  "file:///private",
  "/absolute",
  "media/%2e%2e/private",
  "media\\private",
  "missing.xml",
])("rejects internal relationship %s", async (target) => {
  await expect(
    parse(
      docx(p("text"), {
        "word/_rels/document.xml.rels": relationships(
          rel("bad", "image", target),
        ),
      }),
    ),
  ).rejects.toMatchObject({ code: "DOCX_PACKAGE" });
});
it.each([
  '<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "https://offline.invalid/entity">]>' +
    documentXml(p("&xxe;")),
  '<!DOCTYPE w:document [<!ENTITY a "expansion">]>' + documentXml(p("&a;")),
  documentXml(p("&undefined;")),
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:document>',
  documentXml(p("&#0;")),
])(
  "rejects malformed XML/XXE without resolving resources (%#)",
  async (source) => {
    await expect(
      parse(docx("", { "word/document.xml": source })),
    ).rejects.toMatchObject({ code: "DOCX_XML" });
  },
);
it("rejects excessive depth, entries, compression ratio and XML size", async () => {
  await expect(
    parse(docx("<w:sdt>".repeat(70) + "</w:sdt>".repeat(70))),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
  await expect(
    parse(
      docx(
        "",
        Object.fromEntries(
          Array.from({ length: DOCX_LIMITS.entries }, (_, i) => [
            `extra${i}`,
            "",
          ]),
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
  await expect(
    parse(zipParts(parts(p("a".repeat(100_000))), 6)),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
  await expect(
    parse(
      docx("", { "word/document.xml": " ".repeat(DOCX_LIMITS.xmlBytes + 1) }),
    ),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
});
it.each([
  new Uint8Array([1, 2, 3]),
  new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
])(
  "rejects fake DOCX and encrypted/legacy OLE documents (%#)",
  async (bytes) => {
    await expect(parse(bytes)).rejects.toMatchObject({ code: "DOCX_ZIP" });
  },
);
it("rejects encrypted ZIP flags and malformed CRC", async () => {
  const bytes = docx(p("text"));
  const flags = bytes.slice();
  flags[6] = 1;
  await expect(parse(flags)).rejects.toMatchObject({ code: "DOCX_ZIP" });
  const crc = bytes.slice();
  crc[14] = crc[14]! ^ 1;
  await expect(parse(crc)).rejects.toMatchObject({ code: "DOCX_ZIP" });
});
it.each(["w:object", "w:altChunk", "w:unknown"])(
  "blocks unsupported content %s without silent dropping",
  async (tag) => {
    await expect(
      parse(docx(`<${tag}>${p("meaningful")}</${tag}>`)),
    ).rejects.toMatchObject({ code: "DOCX_UNSUPPORTED" });
  },
);
it("blocks macro packages and unsupported image bytes", async () => {
  await expect(
    parse(docx(p("text"), { "word/vbaProject.bin": "macro" })),
  ).rejects.toMatchObject({ code: "DOCX_UNSUPPORTED" });
  await expect(
    parse(
      docx(`<w:p>${drawing()}</w:p>`, {
        "word/_rels/document.xml.rels": relationships(
          rel("image", "image", "media/image.png"),
        ),
        "word/media/image.png": "not PNG",
      }),
    ),
  ).rejects.toMatchObject({ code: "DOCX_IMAGE" });
});
it.each(["staging", "before-commit", "failure"] as const)(
  "preserves source and cleans DOCX staging on %s",
  async (phase) => {
    const root = await mkdtemp(join(tmpdir(), "sarel-docx-"));
    roots.push(root);
    const source = join(root, "source.docx"),
      destination = join(root, "dest");
    const bytes = mixedNovel();
    await writeFile(source, bytes);
    await mkdir(destination);
    const abort = new AbortController();
    if (phase === "staging")
      await expect(
        StagedManuscriptImport.inspect(source, importer, {
          signal: abort.signal,
          temporaryRoot: root,
          checkpoint: async (point) => {
            if (point === "staging") abort.abort();
          },
        }),
      ).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
    else {
      const stage = await StagedManuscriptImport.inspect(source, importer, {
        signal: abort.signal,
        temporaryRoot: root,
      });
      await expect(
        stage.commit(destination, {
          signal: abort.signal,
          ...(phase === "failure"
            ? {
                writeJson: async () => {
                  throw new Error("synthetic");
                },
              }
            : {
                checkpoint: async (point: string) => {
                  if (point === "before-commit") abort.abort();
                },
              }),
        }),
      ).rejects.toBeDefined();
    }
    expect(await readFile(source)).toEqual(Buffer.from(bytes));
    expect(await readdir(destination)).toEqual([]);
    expect((await readdir(root)).sort()).toEqual(["dest", "source.docx"]);
  },
);

it("runs the actual bundled DOCX parser with networking, filesystem and process APIs absent", async () => {
  const bundle = await readFile(
    new URL("../dist/docx-parser.bundle.js", import.meta.url),
    "utf8",
  );
  const isolated = new IsolatedManuscriptImporter(
    `source=>{if([typeof fetch,typeof XMLHttpRequest,typeof WebSocket,typeof require,typeof process].some(x=>x!=="undefined")) throw new Error(); ${bundle}; return DOCX.parse(source);}`,
  );
  const bytes = docx(
    `<w:p>${drawing(true)}<w:fldSimple w:instr="INCLUDETEXT https://offline.invalid/file"><w:r><w:t>cached</w:t></w:r></w:fldSimple></w:p>`,
    {
      "word/_rels/document.xml.rels": relationships(
        rel("image", "image", "https://offline.invalid/image.png", true) +
          rel(
            "template",
            "attachedTemplate",
            "https://offline.invalid/template",
            true,
          ),
      ),
    },
  );
  const result = validateImportedManuscript(
    await isolated.parse(bytes, signal()),
  );
  expect(texts(result.chapters[0]!.content)).toEqual([
    "[External image: 海 illustration]",
    "cached",
  ]);
  expect(result.warnings.map((w) => w.code)).toContain(
    "DOCX_EXTERNAL_RELATIONSHIP",
  );
});
it.each([
  documentXml('<w:p a="1" a="2"/>'),
  documentXml('<w:p xmlns:x="urn:test" xmlns:y="urn:test" x:a="1" y:a="2"/>'),
  documentXml('<w:p w:rsidR="&#0;"/>'),
  documentXml(p("ok")) + documentXml(p("second root")),
])(
  "rejects ambiguous/invalid XML attributes and multiple roots (%#)",
  async (source) => {
    await expect(
      parse(docx("", { "word/document.xml": source })),
    ).rejects.toMatchObject({ code: "DOCX_XML" });
  },
);
it("preserves UTF-16 BOM XML and Unicode crossing decoder chunk boundaries", async () => {
  const text = "a".repeat(4055) + unicode;
  const xml = documentXml(p(text));
  const bytes = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from(xml, "utf16le"),
  ]);
  expect(
    texts(
      (await parse(docx("", { "word/document.xml": bytes }))).chapters[0]!
        .content,
    ),
  ).toEqual([text]);
  expect(texts((await parse(docx(p(text)))).chapters[0]!.content)).toEqual([
    text,
  ]);
});
it("complex fields preserve only stored result and block unbalanced controls", async () => {
  const r = await parse(
    docx(
      '<w:p><w:r><w:t>before</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>INCLUDETEXT https://offline.invalid</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>result</w:t><w:fldChar w:fldCharType="end"/><w:t>after</w:t></w:r></w:p>',
    ),
  );
  expect(texts(r.chapters[0]!.content)).toEqual(["beforeresultafter"]);
  expect(r.warnings.some((w) => w.code === "DOCX_FIELD")).toBe(true);
  await expect(
    parse(docx('<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')),
  ).rejects.toMatchObject({ code: "DOCX_PACKAGE" });
});
it("recovers content controls and headers, and warns about unsupported list numbering", async () => {
  const r = await parse(
    docx(
      `<w:sdt><w:sdtPr/><w:sdtContent>${p("control")}</w:sdtContent></w:sdt>` +
        p("list text", '<w:numPr><w:numId w:val="missing"/></w:numPr>'),
      {
        "word/_rels/document.xml.rels": relationships(
          rel("h", "header", "header.xml"),
        ),
        "word/header.xml": `<w:hdr ${namespaces}>${p("header text")}</w:hdr>`,
      },
    ),
  );
  expect(texts(r.chapters[0]!.content)).toEqual([
    "control",
    "list text",
    "header text",
  ]);
  expect(r.warnings.map((w) => w.code)).toEqual([
    "DOCX_METADATA_DEFAULT",
    "DOCX_CONTENT_CONTROL",
    "DOCX_LIST",
    "DOCX_HEADER_FOOTER",
  ]);
});
it.each([
  "<w:tbl><w:unknown><w:p><w:r><w:t>hidden table text</w:t></w:r></w:p></w:unknown></w:tbl>",
  "<w:p><w:r><w:rPr><w:t>hidden property text</w:t></w:rPr></w:r></w:p>",
  "<w:p>malformed bare text</w:p>",
  "<w:p><w:r><w:drawing><a:t>shape text</a:t></w:drawing></w:r></w:p>",
])(
  "blocks unaccounted content rather than silently dropping it (%#)",
  async (body) => {
    await expect(parse(docx(body))).rejects.toMatchObject({
      code: "DOCX_UNSUPPORTED",
    });
  },
);
it("rejects relationship, paragraph and warning count exhaustion", async () => {
  await expect(
    parse(
      docx("", {
        "word/_rels/document.xml.rels": relationships(
          Array.from({ length: DOCX_LIMITS.relationships }, (_, i) =>
            rel(`r${i}`, "hyperlink", "https://offline.invalid", true),
          ).join(""),
        ),
      }),
    ),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
  await expect(
    parse(docx("<w:p/>".repeat(DOCX_LIMITS.paragraphs + 1))),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
  await expect(
    parse(docx("<w:p><w:fldSimple/></w:p>".repeat(DOCX_LIMITS.warnings + 1))),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
});
/** Mutate declared sizes while retaining real small entries; no large allocation required. */
function declaredSizes(bytes: Uint8Array, size: number) {
  const result = bytes.slice(),
    view = new DataView(result.buffer);
  let p = view.getUint32(result.length - 6, true);
  while (view.getUint32(p, true) === 0x02014b50) {
    const offset = view.getUint32(p + 42, true);
    view.setUint32(p + 24, size, true);
    view.setUint32(offset + 22, size, true);
    p +=
      46 +
      view.getUint16(p + 28, true) +
      view.getUint16(p + 30, true) +
      view.getUint16(p + 32, true);
  }
  return result;
}
it("preflights individual/aggregate expanded sizes and detects understated DEFLATE output", async () => {
  await expect(
    parse(declaredSizes(docx(p("small")), DOCX_LIMITS.entryBytes + 1)),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
  const many = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [`entry${i}`, new Uint8Array(100_000)]),
  );
  await expect(
    parse(declaredSizes(zipParts(many), 17 * 1024 * 1024)),
  ).rejects.toMatchObject({ code: "DOCX_LIMIT" });
  const understated = declaredSizes(
    zipParts(parts(p("text".repeat(30))), 6),
    1,
  );
  await expect(parse(understated)).rejects.toMatchObject({
    code: "DOCX_LIMIT",
  });
});
it("rejects excess embedded image count before staging", async () => {
  const entries: Record<string, string | Uint8Array> = {};
  let body = "",
    rels = "";
  const png = await syntheticImage();
  for (let i = 0; i <= DOCX_LIMITS.assets; i++) {
    body += `<w:p>${drawing().replace('="image"', `="i${i}"`)}</w:p>`;
    rels += rel(`i${i}`, "image", `media/${i}.png`);
    entries[`word/media/${i}.png`] = png;
  }
  entries["word/_rels/document.xml.rels"] = relationships(rels);
  await expect(parse(docx(body, entries))).rejects.toMatchObject({
    code: "DOCX_LIMIT",
  });
});
it("image decoder rejects a fake PNG signature before any stage is written", async () => {
  const bytes = docx(`<w:p>${drawing()}</w:p>`, {
    "word/_rels/document.xml.rels": relationships(
      rel("image", "image", "media/image.png"),
    ),
    "word/media/image.png": new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0,
    ]),
  });
  const root = await mkdtemp(join(tmpdir(), "sarel-docx-"));
  roots.push(root);
  const source = join(root, "bad.docx");
  await writeFile(source, bytes);
  await expect(
    StagedManuscriptImport.inspect(source, importer, {
      signal: signal(),
      temporaryRoot: root,
    }),
  ).rejects.toBeDefined();
  expect(await readdir(root)).toEqual(["bad.docx"]);
  expect(await readFile(source)).toEqual(Buffer.from(bytes));
});
it("failed inspection and staging writes preserve the source; cancelling a running parser terminates it", async () => {
  const root = await mkdtemp(join(tmpdir(), "sarel-docx-"));
  roots.push(root);
  const source = join(root, "source.docx");
  const invalid = docx("<w:p><w:ins/></w:p>");
  await writeFile(source, invalid);
  await expect(
    StagedManuscriptImport.inspect(source, importer, {
      signal: signal(),
      temporaryRoot: root,
    }),
  ).rejects.toMatchObject({
    code: "DOCX_REVISIONS",
    message: expect.stringContaining("Main document"),
  });
  expect(await readFile(source)).toEqual(Buffer.from(invalid));
  const bytes = mixedNovel();
  await writeFile(source, bytes);
  await expect(
    StagedManuscriptImport.inspect(source, importer, {
      signal: signal(),
      temporaryRoot: root,
      writeBytes: async (path) => {
        await writeFile(path, "partial");
        throw new Error("synthetic");
      },
    }),
  ).rejects.toMatchObject({ code: "IMPORT_FAILED" });
  expect(await readdir(root)).toEqual(["source.docx"]);
  expect(await readFile(source)).toEqual(Buffer.from(bytes));
  const abort = new AbortController();
  const pending = importer.parse(bytes, abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
  expect(await readFile(source)).toEqual(Buffer.from(bytes));
});

it("only main-story headings propose chapters; nested headings retain their text in reading order", async () => {
  const heading = (text: string) => p(text, '<w:pStyle w:val="Heading1"/>');
  const bytes = docx(
    heading("Chapter") +
      `<w:tbl><w:tr><w:tc>${heading("Table heading")}</w:tc></w:tr></w:tbl><w:p><w:r><w:footnoteReference w:id="1"/><w:drawing><w:txbxContent>${heading("Box heading")}</w:txbxContent></w:drawing></w:r></w:p>` +
      heading("Next"),
    {
      "word/_rels/document.xml.rels": relationships(
        rel("f", "footnotes", "footnotes.xml") +
          rel("h", "header", "header.xml"),
      ),
      "word/footnotes.xml": `<w:footnotes ${namespaces}><w:footnote w:id="1">${heading("Note heading")}</w:footnote></w:footnotes>`,
      "word/header.xml": `<w:hdr ${namespaces}>${heading("Header heading")}</w:hdr>`,
    },
  );
  const r = await parse(bytes);
  expect(r.chapters.map((c) => c.title)).toEqual(["Chapter", "Next"]);
  expect(r.chapters.map((c) => texts(c.content))).toEqual([
    ["Chapter", "Table heading", "[footnote]", "Note heading", "Box heading"],
    ["Next", "Header heading"],
  ]);
  expect(
    r.warnings
      .filter((w) => w.code === "DOCX_CHAPTER_PROPOSAL")
      .map((w) => w.location.chapter),
  ).toEqual([0, 1]);
});
it.each([
  '<?xml version="1.0"?><?xml version="1.0"?>' + documentXml(p("text")),
  documentXml('<w:p invalid="a<b"/>'),
  documentXml(p("literal ]]> text")),
  documentXml("<!-- invalid -- comment -->" + p("text")),
])("rejects malformed XML lexical forms (%#)", async (source) => {
  await expect(
    parse(docx("", { "word/document.xml": source })),
  ).rejects.toMatchObject({ code: "DOCX_XML" });
});

it("preserves text and warns when unsupported run semantics are flattened", async () => {
  const r = await parse(
    docx(
      '<w:p><w:r><w:rPr><w:vanish/><w:vertAlign w:val="superscript"/><w:u/></w:rPr><w:t>Visible recovery</w:t></w:r></w:p>',
    ),
  );
  expect(texts(r.chapters[0]!.content)).toEqual(["Visible recovery"]);
  expect(r.warnings.map((w) => w.code)).toContain("DOCX_RUN_FORMAT");
});
it("blocks foreign text hidden in ignored properties and orphaned deleted text", async () => {
  await expect(
    parse(
      docx(
        '<w:p><w:r><w:rPr><m:t xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">meaningful equation</m:t></w:rPr></w:r></w:p>',
      ),
    ),
  ).rejects.toMatchObject({ code: "DOCX_UNSUPPORTED" });
  await expect(
    parse(
      docx(
        "<w:p><w:r><w:rPr><w:delText>old revision</w:delText></w:rPr></w:r></w:p>",
      ),
    ),
  ).rejects.toMatchObject({ code: "DOCX_REVISIONS" });
});
it("preserves numbering across paragraph interruptions", async () => {
  const item = (text: string) =>
    p(text, '<w:numPr><w:numId w:val="1"/></w:numPr>');
  const r = await parse(
    docx(item("first") + p("interruption") + item("second"), {
      "word/_rels/document.xml.rels": relationships(
        rel("n", "numbering", "numbering.xml"),
      ),
      "word/numbering.xml": `<w:numbering ${namespaces}><w:abstractNum w:abstractNumId="a"><w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="a"/></w:num></w:numbering>`,
    }),
  );
  expect(r.chapters[0]!.content.content).toMatchObject([
    { type: "orderedList", attrs: { start: 4 } },
    { type: "paragraph" },
    { type: "orderedList", attrs: { start: 5 } },
  ]);
  expect(texts(r.chapters[0]!.content)).toEqual([
    "first",
    "interruption",
    "second",
  ]);
});
