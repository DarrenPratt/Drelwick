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
  type PublicationMetadata,
  EbookSimulationSchema,
  type EbookSimulation,
} from "@drelwick/shared";
import { createHash } from "node:crypto";

/** A passive document; iframe sandbox is the independent second boundary. */
export const BOOK_PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'none'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export interface PreparedBookPreview {
  metadata?: PublicationMetadata;
  projectId: string;
  language: string;
  markup: string;
  navigation?: readonly { anchor: string; title: string }[];
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
    target: "ebook",
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
    ...(snapshot.book.metadata ? { metadata: snapshot.book.metadata } : {}),
    projectId,
    language: snapshot.book.language,
    markup: rendered.chapters.map((chapter) => chapter.xhtml).join(""),
    navigation: rendered.chapters
      .filter((chapter) => chapter.publication?.inclusion.navigation !== false)
      .map(({ anchor, title }) => ({ anchor, title })),
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
  simulation: EbookSimulation = { fontSize: 16, appearance: "light" },
): BookPreview {
  const settings = EbookSimulationSchema.parse(simulation);
  const theme = generateThemeStyles(getBookTheme(selection.themeId), "ebook");
  const dark = settings.appearance === "dark";
  // Trusted target CSS only; no author strings enter styles. Relative theme sizes
  // inherit this simulated root size without changing the theme definition.
  const css =
    theme.css +
    `
html { font-size: ${settings.fontSize}px; color-scheme: ${settings.appearance}; }
body { margin: 0; padding: 1.25rem; overflow-wrap: anywhere; }
body, .chapter { color: ${dark ? "#e8e6e3" : "#111"}; background-color: ${dark ? "#202124" : "#fff"}; }
.chapter { margin-block-end: 3rem; }
.preview-navigation { font: 1rem/1.5 sans-serif; margin-block-end: 2rem; }
.preview-navigation a { color: inherit; }
`;
  const navigation = prepared.navigation?.length
    ? `<nav class="preview-navigation" aria-label="Book contents"><h2>Contents</h2><ol>${prepared.navigation.map(({ anchor, title }) => `<li><a href="about:srcdoc#${escapeXml(anchor)}">${escapeXml(title)}</a></li>`).join("")}</ol></nav>`
    : "";
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
    document: `<!doctype html><html lang="${escapeXml(prepared.language)}"><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="${escapeXml(policy)}" /><title>${escapeXml(prepared.metadata?.title ?? "Book preview")}</title>${prepared.metadata ? `<meta name="author" content="${escapeXml(prepared.metadata.author)}" /><meta name="description" content="${escapeXml(prepared.metadata.description)}" />` : ""}<style>${css}</style></head><body>${navigation}${prepared.markup}</body></html>`,
  };
}
