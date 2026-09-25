import { assembleBook } from "@drelwick/core";
import {
  escapeXml,
  renderBook,
  generateThemeStyles,
  getBookTheme,
  resolveBookTheme,
} from "@drelwick/renderer";
import {
  ApplicationError,
  type BookPreview,
  type BookThemeSelection,
} from "@drelwick/shared";
import { createHash } from "node:crypto";

/** A passive document; iframe sandbox is the independent second boundary. */
export const BOOK_PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'none'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export interface PreparedBookPreview {
  projectId: string;
  language: string;
  markup: string;
  revision: string;
  complete: boolean;
  diagnostics: BookPreview["diagnostics"];
  selection: BookThemeSelection;
}

export async function prepareBookPreview(
  projectPath: string,
  projectId: string,
): Promise<PreparedBookPreview> {
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
    projectId,
    language: snapshot.book.language,
    markup: rendered.chapters.map((chapter) => chapter.xhtml).join(""),
    selection: resolveBookTheme(snapshot.presentation.themeId),
    revision: rendered.revision,
    complete: rendered.ok,
    diagnostics: rendered.diagnostics,
  };
}

/** Reuses semantic markup; only trusted, validated preset CSS is authorized. */
export function presentBookPreview(
  prepared: PreparedBookPreview,
  selection = prepared.selection,
): BookPreview {
  const { css } = generateThemeStyles(getBookTheme(selection.themeId), "ebook");
  const digest = createHash("sha256").update(css).digest("base64");
  const policy = BOOK_PREVIEW_CSP.replace(
    "style-src 'none'",
    `style-src 'sha256-${digest}'; style-src-attr 'none'; font-src 'none'`,
  );
  return {
    revision: prepared.revision,
    complete: prepared.complete,
    diagnostics: prepared.diagnostics,
    theme: selection,
    document: `<!doctype html><html lang="${escapeXml(prepared.language)}"><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="${escapeXml(policy)}" /><title>Book preview</title><style>${css}</style></head><body>${prepared.markup}</body></html>`,
  };
}
