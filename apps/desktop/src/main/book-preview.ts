import { assembleBook } from "@drelwick/core";
import { escapeXml, renderBook } from "@drelwick/renderer";
import { ApplicationError, type BookPreview } from "@drelwick/shared";

/** A passive document; iframe sandbox is the independent second boundary. */
export const BOOK_PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'none'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export async function createBookPreview(
  projectPath: string,
  projectId: string,
): Promise<BookPreview> {
  const snapshot = await assembleBook(projectPath);
  if (snapshot.book.projectId !== projectId)
    throw new ApplicationError(
      "PROJECT_NOT_OPEN",
      "The project changed. Reopen it before previewing.",
    );
  const rendered = renderBook(snapshot.book, {
    links: "inert",
    resolveAsset: (asset) => {
      const bytes = snapshot.assets.get(asset.id);
      return bytes
        ? {
            kind: "embedded",
            value: `data:${asset.mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
          }
        : undefined;
    },
  });
  return {
    revision: rendered.revision,
    complete: rendered.ok,
    diagnostics: rendered.diagnostics,
    document: `<!doctype html><html lang="${escapeXml(snapshot.book.language)}"><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="${escapeXml(BOOK_PREVIEW_CSP)}" /><title>Book preview</title></head><body>${rendered.chapters.map((chapter) => chapter.xhtml).join("")}</body></html>`,
  };
}
