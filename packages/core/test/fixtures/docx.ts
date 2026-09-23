import { zipSync, strToU8 } from "fflate";

export const namespaces = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`;
export const documentXml = (body: string) =>
  `<w:document ${namespaces}><w:body>${body}</w:body></w:document>`;
export const p = (text: string, properties = "") =>
  `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
export const rel = (
  id: string,
  type: string,
  target: string,
  external = false,
) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
export const relationships = (body: string) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
export function parts(
  body: string,
  extra: Record<string, string | Uint8Array> = {},
) {
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": relationships(
      rel("main", "officeDocument", "word/document.xml"),
    ),
    "word/document.xml": documentXml(body),
    ...extra,
  };
}
/** Stable bytes, no Word, random IDs, timestamps, external services or author content. */
export function zipParts(
  entries: Record<string, string | Uint8Array>,
  level: 0 | 6 = 0,
) {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [
        name,
        [
          typeof value === "string" ? strToU8(value) : value,
          { mtime: new Date(2020, 0, 1), level },
        ],
      ]),
    ),
  );
}
export const docx = (
  body: string,
  extra: Record<string, string | Uint8Array> = {},
) => zipParts(parts(body, extra));
export const unicode =
  "Café e\u0301 “quotes” — – Ελληνικά 中文 العربية हिन्दी 🌱";
export function mixedNovel() {
  return docx(
    p("Preface") +
      p("Chapter One", '<w:pStyle w:val="Heading1"/>') +
      `<w:p><w:r><w:t>${unicode}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t> bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> italic</w:t></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t> both</w:t></w:r></w:p>` +
      p("Section", '<w:pStyle w:val="Heading2"/>') +
      p("Chapter Two", '<w:pStyle w:val="Heading1"/>') +
      p("End."),
  );
}
