import { PDFDocument, PDFDict, PDFName, PDFArray, PDFStream } from "pdf-lib";
import type { PrintFinding, PrintPreview } from "@drelwick/shared";

/** Inspect the final artifact, including embedded descendant fonts, without logging PDF data. */
export async function inspectPrintPdf(
  preview: PrintPreview,
  bytes = preview.pdf,
): Promise<PrintFinding[]> {
  const findings: PrintFinding[] = [];
  const add = (code: string, message: string) =>
    findings.push({ code, severity: "error", message });
  const expected = preview.export;
  if (!expected) {
    add("missing-revision", "Refresh print preview before exporting.");
    return findings;
  }
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() !== preview.pages.length || !pdf.getPageCount())
      add(
        "page-count",
        "PDF page count does not match the preview. Refresh before exporting.",
      );
    const width = (expected.settings.trim.width * 72) / 25400;
    const height = (expected.settings.trim.height * 72) / 25400;
    for (const [index, page] of pdf.getPages().entries()) {
      if (
        [page.getMediaBox(), page.getCropBox(), page.getTrimBox()].some(
          (box) =>
            Math.abs(box.width - width) > 1 ||
            Math.abs(box.height - height) > 1 ||
            box.x !== 0 ||
            box.y !== 0,
        )
      )
        findings.push({
          code: "page-box",
          severity: "error",
          setting: "trim",
          page: index + 1,
          message:
            "PDF page dimensions differ from print settings. Refresh the preview.",
        });
    }
    if (
      pdf.getTitle() !== expected.title ||
      (pdf.getAuthor() ?? "") !== expected.author
    )
      add(
        "metadata",
        "PDF title or author does not match the captured publication metadata. Refresh the preview.",
      );
    const language = pdf.catalog.lookup(PDFName.of("Lang"));
    if (
      !language ||
      !("decodeText" in language) ||
      typeof language.decodeText !== "function" ||
      language.decodeText() !== expected.language
    )
      add(
        "metadata-language",
        "PDF language does not match publication metadata. Refresh the preview.",
      );
    let fonts = 0;
    const checked = new Set<PDFDict>();
    const inspectFont = (object: PDFDict): void => {
      if (checked.has(object)) return;
      checked.add(object);
      if (object.get(PDFName.of("Subtype"))?.toString() === "/Type0") {
        const children = object.lookup(PDFName.of("DescendantFonts"));
        if (!(children instanceof PDFArray) || !children.size()) {
          add(
            "font-embedding",
            "PDF has an unresolved descendant font. Refresh the preview.",
          );
          return;
        }
        for (let index = 0; index < children.size(); index++) {
          const child = children.lookup(index);
          if (child instanceof PDFDict) inspectFont(child);
          else
            add(
              "font-embedding",
              "PDF has an unresolved descendant font. Refresh the preview.",
            );
        }
        return;
      }
      const descriptor = object.lookup(PDFName.of("FontDescriptor"));
      if (
        !(descriptor instanceof PDFDict) ||
        !["FontFile", "FontFile2", "FontFile3"].some(
          (key) => descriptor.lookup(PDFName.of(key)) instanceof PDFStream,
        )
      )
        add(
          "font-embedding",
          "PDF contains a font without an embedded font program. Restore bundled fonts and refresh.",
        );
    };
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (
        !(object instanceof PDFDict) ||
        object.get(PDFName.of("Type"))?.toString() !== "/Font"
      )
        continue;
      fonts++;
      inspectFont(object);
    }
    if (!fonts)
      add(
        "font-embedding",
        "PDF contains no embedded fonts. Refresh the preview.",
      );
  } catch {
    add(
      "invalid-pdf",
      "The generated PDF could not be inspected. Refresh the preview before exporting.",
    );
  }
  return [...new Map(findings.map((f) => [JSON.stringify(f), f])).values()];
}
