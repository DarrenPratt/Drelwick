import { afterEach, expect, it } from "vitest";
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import yauzl from "yauzl";
import sax from "sax";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
import {
  assembleBook,
  generateDocx,
  saveChapter,
  importImageAsset,
  loadPublication,
  savePublication,
  openProjectForEditing,
  inspectDocxDestination,
  writeDocxAtomically,
} from "../src/index.js";
import { DocxManuscriptImporter } from "@drelwick/core";
import { inspectSnapshot } from "../src/project-snapshot.js";
import { validateImportedManuscript } from "@drelwick/project-model";
import { createUuid } from "@drelwick/shared";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((c) => c.cleanup()));
});
async function fixture(
  name: Parameters<typeof copyFixture>[0] = "multi-chapter-book",
) {
  const c = await copyFixture(name);
  copies.push(c);
  return { ...c, temporaryRoot: dirname(c.projectPath) };
}
const paragraph = (s: string) => ({
  type: "paragraph",
  content: [{ type: "text", text: s }],
});
const plain = (value: unknown): string[] => {
  if (!value || typeof value !== "object") return [];
  if ("type" in value && value.type === "text" && "text" in value)
    return [String(value.text)];
  return "content" in value && Array.isArray(value.content)
    ? value.content.flatMap(plain)
    : [];
};
const importer = new DocxManuscriptImporter();
const roundTrip = async (bytes: Uint8Array) =>
  validateImportedManuscript(
    await importer.parse(bytes, new AbortController().signal),
  );

/** Independent ZIP reader, not fflate or the importer ZIP implementation. */
async function parts(bytes: Uint8Array): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (e, z) =>
      e || !z ? reject(e) : resolve(z),
    ),
  );
  const files = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => {
          files.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
  return files;
}
function inspectXml(bytes: Buffer) {
  const parser = sax.parser(true, { xmlns: true });
  const elements: { name: string; attrs: Record<string, string> }[] = [];
  const texts: string[] = [];
  parser.onopentag = (tag) =>
    elements.push({
      name: tag.name,
      attrs: Object.fromEntries(
        Object.entries(tag.attributes).map(([key, value]) => [
          key,
          typeof value === "string" ? value : value.value,
        ]),
      ),
    });
  parser.ontext = (s) => texts.push(s);
  parser.write(bytes.toString("utf8")).close();
  return { elements, texts };
}

it("exports authoritative reading order, independently valid package parts and Unicode without project mutation", async () => {
  const { projectPath } = await fixture();
  const snapshot = await assembleBook(projectPath);
  const ids = snapshot.book.chapters.map((c) => c.id);
  expect(ids).not.toEqual([...ids].sort());
  const unicode = "Café — ‘quotes’ – Ελληνικά 日本語 العربية 👩🏽‍🚀 é & < >";
  for (const [i, id] of ids.entries())
    await saveChapter({
      projectPath,
      chapterId: id,
      document: { type: "doc", content: [paragraph(`${i}: ${unicode}`)] },
    });
  const before = await inspectSnapshot(projectPath);
  const prepared = generateDocx(await assembleBook(projectPath));
  expect(await inspectSnapshot(projectPath)).toEqual(before);
  const files = await parts(prepared.bytes);
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
    "word/_rels/document.xml.rels",
    "docProps/core.xml",
  ])
    expect(files.has(name)).toBe(true);
  for (const [name, bytes] of files)
    if (name.endsWith("xml") || name.endsWith("rels"))
      expect(() => inspectXml(bytes)).not.toThrow();
  expect(inspectXml(files.get("word/document.xml")!).texts).toEqual(
    snapshot.book.chapters.flatMap((c, i) => [c.title, `${i}: ${unicode}`]),
  );
  const imported = await roundTrip(prepared.bytes);
  expect(imported.chapters.map((c) => c.title)).toEqual(
    snapshot.book.chapters.map((c) => c.title),
  );
  expect(imported.chapters.map((c) => plain(c.content))).toEqual(
    snapshot.book.chapters.map((c, i) => [c.title, `${i}: ${unicode}`]),
  );
});

it("round-trips all headings, emphasis, mixed nested lists, starts, links, tabs and hard breaks", async () => {
  const { projectPath } = await fixture("minimal-book");
  const snapshot = await assembleBook(projectPath);
  const nodes = [
    ...[1, 2, 3, 4, 5, 6].map((level) => ({
      type: "heading",
      attrs: { level },
      content: [{ type: "text", text: `Heading ${level}` }],
    })),
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "both",
          marks: [{ type: "bold" }, { type: "italic" }],
        },
        { type: "text", text: "\t tab" },
        { type: "hardBreak" },
        ...[
          "http://example.test/a",
          "https://example.test/?x=1&y=2",
          "mailto:author@example.test",
          "#chapter-target",
        ].map((href) => ({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })),
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 4 },
      content: [
        {
          type: "listItem",
          content: [
            paragraph("Outer"),
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [paragraph("Inner")] }],
            },
          ],
        },
        { type: "listItem", content: [paragraph("Next")] },
      ],
    },
  ];
  await saveChapter({
    projectPath,
    chapterId: snapshot.book.chapters[0]!.id,
    document: { type: "doc", content: nodes },
  });
  const output = generateDocx(await assembleBook(projectPath));
  const imported = await roundTrip(output.bytes);
  const restored = imported.chapters
    .flatMap((c) => c.content.content ?? [])
    .slice(1);
  expect(restored).toEqual(nodes);
  const files = await parts(output.bytes);
  expect(
    inspectXml(files.get("word/numbering.xml")!).elements.filter(
      (n) => n.name === "w:abstractNum",
    ),
  ).toHaveLength(2);
  const rels = inspectXml(
    files.get("word/_rels/document.xml.rels")!,
  ).elements.filter((n) => n.name === "Relationship");
  expect(
    rels
      .filter((n) => n.attrs.TargetMode === "External")
      .map((n) => n.attrs.Target),
  ).toEqual([
    "http://example.test/a",
    "https://example.test/?x=1&y=2",
    "mailto:author@example.test",
  ]);
  for (const rel of rels.filter((r) => !r.attrs.TargetMode))
    expect(files.has(`word/${rel.attrs.Target}`)).toBe(true);
});

it("captures front/body/back order, includes hidden matter, metadata, cover and duplicate managed image references", async () => {
  const { projectPath, temporaryRoot } = await fixture();
  const session = await openProjectForEditing(projectPath);
  const state = await loadPublication(projectPath, session.project.projectId);
  const sourcePath = join(temporaryRoot, "image.png");
  await writeFile(sourcePath, await syntheticImage());
  const asset = await importImageAsset({ projectPath, sourcePath });
  const image = {
    type: "image",
    attrs: { assetId: asset.id, alt: "Image & 日本語", size: "full" },
  };
  const pages = [
    {
      id: createUuid(),
      placement: "back" as const,
      title: "Back",
      type: "author" as const,
      inclusion: { ebook: true, print: true, navigation: true },
      document: { type: "doc", content: [paragraph("Back text"), image] },
    },
    {
      id: createUuid(),
      placement: "front" as const,
      title: "Front",
      type: "dedication" as const,
      inclusion: { ebook: false, print: false, navigation: false },
      document: { type: "doc", content: [paragraph("Front text"), image] },
    },
  ];
  await savePublication(
    {
      projectPath,
      projectId: session.project.projectId,
      expectedRevision: state.revision,
      data: { ...state.data, pages, coverAssetId: asset.id },
    },
    { allowCoverChange: true },
  );
  const captured = await assembleBook(projectPath);
  expect(captured.book.chapters.map((c) => c.title)).toEqual([
    "Ebook cover",
    "Front",
    ...session.chapters.map((c) => c.title),
    "Back",
  ]);
  const output = generateDocx(captured);
  const files = await parts(output.bytes);
  expect(
    [...files.keys()].filter((n) => n.startsWith("word/media/")),
  ).toHaveLength(1);
  expect(files.get("word/media/image1.png")).toEqual(await syntheticImage());
  const doc = inspectXml(files.get("word/document.xml")!);
  expect(
    doc.elements.filter((n) => n.name === "wp:docPr").map((n) => n.attrs.descr),
  ).toContain("Image & 日本語");
  const imported = await roundTrip(output.bytes);
  expect(imported.chapters.map((c) => c.title)).toEqual(
    captured.book.chapters.map((c) => c.title),
  );
  expect(imported.metadata.title).toBe(captured.book.title);
  expect(imported.assets).toHaveLength(1);
  expect(Buffer.from(imported.assets[0]!.base64, "base64")).toEqual(
    await syntheticImage(),
  );
  // Later source changes cannot alter the already-captured revision.
  await writeFile(
    join(projectPath, "assets", "images", asset.id, "original.png"),
    "malformed image",
  );
  const corrupt = await assembleBook(projectPath);
  expect(() => generateDocx(corrupt)).toThrowError(
    expect.objectContaining({ code: "DOCX_EXPORT_IMAGE" }),
  );
  await rm(join(projectPath, "assets", "images", asset.id, "original.png"));
  expect(generateDocx(captured).bytes).toEqual(output.bytes);
  const missing = await assembleBook(projectPath);
  expect(() => generateDocx(missing)).toThrowError(
    expect.objectContaining({ code: "DOCX_EXPORT_IMAGE" }),
  );
});

it("locates safe degradations, preserves their text, and blocks unknown nodes and invalid XML scalars", async () => {
  const { projectPath } = await fixture("formatted-book");
  const snapshot = await assembleBook(projectPath);
  const document = {
    type: "doc" as const,
    content: [
      {
        type: "epigraph",
        attrs: { attribution: "The author" },
        content: [paragraph("Quoted words")],
      },
      { type: "blockquote", content: [paragraph("Other words")] },
      {
        type: "codeBlock",
        attrs: { language: "javascript" },
        content: [{ type: "text", text: "const x = 1;\nnext" }],
      },
      { type: "sceneBreak" },
      { type: "horizontalRule" },
      {
        type: "paragraph",
        content: ["underline", "strike", "code"].map((type) => ({
          type: "text",
          text: type,
          marks: [{ type }],
        })),
      },
    ],
  };
  snapshot.book.chapters[0]!.document = document;
  const output = generateDocx(snapshot);
  expect(output.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        chapterId: snapshot.book.chapters[0]!.id,
        path: [0],
        construct: "epigraph",
      }),
    ]),
  );
  const imported = await roundTrip(output.bytes);
  const prose = imported.chapters.flatMap((c) => plain(c.content)).join(" ");
  for (const s of [
    "Quoted words",
    "The author",
    "Other words",
    "javascript",
    "const x = 1;",
    "next",
    "***",
    "underline",
    "strike",
    "code",
  ])
    expect(prose).toContain(s);
  snapshot.book.chapters[0]!.document = {
    type: "doc",
    content: [{ type: "futureNode", text: "never omit" }],
  };
  expect(() => generateDocx(snapshot)).toThrowError(
    expect.objectContaining({ code: "DOCX_EXPORT_CONTENT" }),
  );
  snapshot.book.chapters[0]!.document = {
    type: "doc",
    content: [paragraph("invalid\u0000text")],
  };
  expect(() => generateDocx(snapshot)).toThrowError(
    expect.objectContaining({ code: "DOCX_EXPORT_CONTENT" }),
  );
});

it("embeds JPEG originals and validates media relationships, dimensions and alt text independently", async () => {
  const { projectPath, temporaryRoot } = await fixture("minimal-book");
  const sourcePath = join(temporaryRoot, "source.jpg");
  const original = await syntheticImage("jpeg");
  await writeFile(sourcePath, original);
  const asset = await importImageAsset({ projectPath, sourcePath });
  const captured = await assembleBook(projectPath);
  await saveChapter({
    projectPath,
    chapterId: captured.book.chapters[0]!.id,
    document: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            assetId: asset.id,
            alt: "JPEG alternative text",
            size: "small",
          },
        },
      ],
    },
  });
  const output = generateDocx(await assembleBook(projectPath));
  const files = await parts(output.bytes);
  expect(files.get("word/media/image1.jpg")).toEqual(original);
  const document = inspectXml(files.get("word/document.xml")!);
  const extent = document.elements.find((e) => e.name === "wp:extent")!;
  expect(Number(extent.attrs.cx)).toBe(asset.width * 9525);
  expect(Number(extent.attrs.cy)).toBe(asset.height * 9525);
  const embed = document.elements.find((e) => e.name === "a:blip")!.attrs[
    "r:embed"
  ];
  const rel = inspectXml(
    files.get("word/_rels/document.xml.rels")!,
  ).elements.find((e) => e.attrs.Id === embed)!;
  expect(rel.attrs.Target).toBe("media/image1.jpg");
  expect(rel.attrs.TargetMode).toBeUndefined();
  const imported = await roundTrip(output.bytes);
  expect(Buffer.from(imported.assets[0]!.base64, "base64")).toEqual(original);
  expect(JSON.stringify(imported.chapters)).toContain("JPEG alternative text");
});

it("warns for unsupported list numbering and preserves full metadata without promising unsupported re-import", async () => {
  const { projectPath } = await fixture("minimal-book");
  const snapshot = await assembleBook(projectPath);
  snapshot.book.chapters[0]!.document = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: -2, type: "a" },
        content: [
          { type: "listItem", content: [paragraph("All item content")] },
        ],
      },
    ],
  };
  snapshot.book.metadata = {
    title: "Metadata",
    author: "Author",
    language: "en-GB",
    description: "Complete description",
    identifiers: [{ scheme: "other", value: "Author identifier" }],
  };
  const output = generateDocx(snapshot);
  expect(output.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "list", path: [0] }),
      expect.objectContaining({ code: "metadata", construct: "identifiers" }),
    ]),
  );
  const imported = await roundTrip(output.bytes);
  expect(
    imported.chapters.flatMap((c) => plain(c.content)).join(" "),
  ).toContain("-2. All item content");
  expect(imported.metadata.description).toBe("Complete description");
  snapshot.book.metadata.description = "x".repeat(4001);
  const longer = generateDocx(snapshot);
  expect(longer.warnings).toContainEqual(
    expect.objectContaining({ construct: "description" }),
  );
  const files = await parts(longer.bytes);
  expect(inspectXml(files.get("docProps/core.xml")!).texts).toContain(
    "x".repeat(4001),
  );
  await expect(roundTrip(longer.bytes)).rejects.toMatchObject({
    code: "DOCX_LIMIT",
  });
});

it("publishes atomically, requires overwrite approval, preserves old output on failures and cleans temporary files", async () => {
  const { projectPath, temporaryRoot } = await fixture("minimal-book");
  const path = join(temporaryRoot, "out.docx");
  const output = generateDocx(await assembleBook(projectPath));
  await writeDocxAtomically(
    await inspectDocxDestination(path, projectPath),
    output.bytes,
    { overwrite: false },
  );
  expect(await readFile(path)).toEqual(Buffer.from(output.bytes));
  const original = Buffer.from("prior valid destination");
  await writeFile(path, original);
  const selected = await inspectDocxDestination(path, projectPath);
  await expect(
    writeDocxAtomically(selected, output.bytes, { overwrite: false }),
  ).rejects.toMatchObject({ code: "DOCX_EXPORT_OVERWRITE" });
  for (const phase of ["written", "commit"]) {
    await expect(
      writeDocxAtomically(selected, output.bytes, {
        overwrite: true,
        checkpoint: async (p) => {
          if (p === phase) throw new Error("simulated disk failure");
        },
      }),
    ).rejects.toMatchObject({ code: "DOCX_EXPORT_WRITE" });
    expect(await readFile(path)).toEqual(original);
    expect(
      (await readdir(temporaryRoot)).filter((n) => n.endsWith(".tmp")),
    ).toEqual([]);
  }
  const abort = new AbortController();
  await expect(
    writeDocxAtomically(selected, output.bytes, {
      overwrite: true,
      signal: abort.signal,
      checkpoint: async () => abort.abort(),
    }),
  ).rejects.toMatchObject({ code: "DOCX_EXPORT_CANCELLED" });
  expect(await readFile(path)).toEqual(original);
  await writeDocxAtomically(selected, output.bytes, { overwrite: true });
  expect(await readFile(path)).toEqual(Buffer.from(output.bytes));
  await expect(
    inspectDocxDestination(join(projectPath, "bad.docx"), projectPath),
  ).rejects.toMatchObject({ code: "DOCX_EXPORT_DESTINATION" });
  await expect(
    inspectDocxDestination(join(temporaryRoot, "bad.pdf"), projectPath),
  ).rejects.toMatchObject({ code: "DOCX_EXPORT_DESTINATION" });
  const race = await inspectDocxDestination(
    join(temporaryRoot, "race.docx"),
    projectPath,
  );
  await writeFile(race.path, original);
  await expect(
    writeDocxAtomically(race, output.bytes, { overwrite: false }),
  ).rejects.toMatchObject({ code: "DOCX_EXPORT_CHANGED" });
  expect(await readFile(race.path)).toEqual(original);
});
