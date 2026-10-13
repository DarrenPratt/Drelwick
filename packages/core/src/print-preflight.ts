import { createHash } from "node:crypto";
import {
  PrintSettingsSchema,
  type PrintFinding,
  type PrintPreview,
} from "@drelwick/shared";
import type { AssembledBook } from "./book-assembly.js";

/** Source currency without rerendering or substituting another PDF. */
export function printSourceRevision(snapshot: AssembledBook): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        book: snapshot.book.revision,
        settings: snapshot.print?.settings,
        edition: snapshot.print?.edition,
        profile: snapshot.print?.editions[snapshot.print.edition],
      }),
    )
    .digest("hex");
}

export function printPreflight(preview: PrintPreview): PrintFinding[] {
  const findings: PrintFinding[] = [];
  if (!preview.pages.length || preview.pages.length > 2000)
    findings.push({
      code: "page-count",
      severity: "error",
      message:
        "The PDF must contain 1–2,000 pages. Review the book's included chapters.",
    });
  const settings = PrintSettingsSchema.safeParse(preview.export?.settings);
  if (
    settings.success &&
    preview.pages.length > 300 &&
    settings.data.margins.inside + settings.data.margins.gutter < 25400
  )
    findings.push({
      code: "binding-space-review",
      severity: "warning",
      setting: "margins",
      message: `This edition has ${preview.pages.length} pages and less than 25.4 mm combined inside margin and gutter. Review binding space with your printer and increase it if needed, then repaginate. This is a conservative review reminder, not a publisher requirement or compliance check.`,
    });
  if (!settings.success)
    findings.push({
      code: "invalid-settings",
      severity: "error",
      setting: "margins",
      message:
        "Correct the trim and margins in Book design → Print settings, then refresh.",
    });
  for (const diagnostic of preview.diagnostics) {
    const messages = {
      overflow:
        "Content or running matter exceeds its available space. Shorten long headings/headers or adjust typography and margins, then refresh.",
      clipping:
        "Measured content extends outside its printable area. Review this chapter's images, headings and margins, then refresh.",
      "unexpected-blank":
        "This page has no measured text or image content. Review the page; intentional empty content may be exported.",
      "unresolved-asset":
        "Restore the missing image in this chapter, then refresh.",
      "unresolved-font":
        "Use characters supported by the bundled print fonts, then refresh.",
    };
    findings.push({
      ...diagnostic,
      severity: diagnostic.code === "unexpected-blank" ? "warning" : "error",
      message: messages[diagnostic.code],
    });
  }
  return findings;
}
