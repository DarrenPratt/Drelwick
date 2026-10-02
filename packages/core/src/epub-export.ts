import { createHash } from "node:crypto";
import { zipSync, unzipSync, strToU8 } from "fflate";
import {
  escapeXml,
  generateThemeStyles,
  getBookTheme,
  resolveBookTheme,
  renderBook,
  type RenderedChapter,
} from "@drelwick/renderer";
import type { AssembledBook } from "./book-assembly.js";
import { ApplicationError } from "@drelwick/shared";

export const EPUB_VERSION = "3.3";
export const EPUB_MEDIA_TYPE = "application/epub+zip";

export interface EpubPackage {
  bytes: Uint8Array;
  revision: string;
  warnings: readonly string[];
}

interface EpubFile {
  path: string;
  bytes: Uint8Array;
  mediaType: string;
  properties?: string;
}

const exportError = (code: string, message: string) =>
  new ApplicationError(code, message);
const safeId = (value: string) => value.replace(/-/g, "").toLowerCase();
const imageExtension = (mediaType: string) =>
  mediaType === "image/png" ? "png" : mediaType === "image/jpeg" ? "jpg" : null;
const xml = (value: string) => escapeXml(value);
const resourceId = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

function ensureSafePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^[A-Za-z0-9._/-]+$/.test(path)
  )
    throw exportError(
      "EPUB_PATH_INVALID",
      "The generated EPUB contains an unsafe resource path.",
    );
}

function withoutRuntimeAttributes(value: string): string {
  return value
    .replace(/\sdata-(?:chapter-type|matter-type|asset-id)="[^"]*"/g, "")
    .replace(/\sdata-language="[^"]*"/g, "");
}

function contentDocument(
  language: string,
  title: string,
  body: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="${xml(language)}" xml:lang="${xml(language)}"><head><meta charset="utf-8" /><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="../styles/book.css" /></head><body>${withoutRuntimeAttributes(body)}</body></html>\n`;
}

function navigationDocument(
  language: string,
  chapters: readonly RenderedChapter[],
): string {
  const items = chapters
    .filter((chapter) => chapter.publication?.inclusion.navigation !== false)
    .map(
      (chapter) =>
        `<li><a href="text/${safeId(chapter.id)}.xhtml#${chapter.anchor}">${xml(chapter.title)}</a></li>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(language)}" xml:lang="${xml(language)}"><head><meta charset="utf-8" /><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${items}</ol></nav></body></html>\n`;
}

function packageDocument(
  book: AssembledBook["book"],
  chapters: readonly RenderedChapter[],
  files: readonly EpubFile[],
): string {
  const metadata = book.metadata;
  if (!metadata)
    throw exportError(
      "EPUB_METADATA_INVALID",
      "Publication metadata is unavailable. Add title, author and language before exporting.",
    );
  const identifier =
    metadata.identifiers[0]?.value ?? `urn:uuid:${book.projectId}`;
  const manifest = files
    .map(
      (file) =>
        `<item id="${xml(resourceId(file.path))}" href="${xml(file.path)}" media-type="${xml(file.mediaType)}"${file.properties ? ` properties="${xml(file.properties)}"` : ""}/>`,
    )
    .join("");
  const spine = chapters
    .map(
      (chapter) =>
        `<itemref idref="${xml(resourceId(`text/${safeId(chapter.id)}.xhtml`))}"/>`,
    )
    .join("");
  const identifierScheme = metadata.identifiers[0]?.scheme;
  const identifierMeta = identifierScheme
    ? `<meta refines="#pub-id" property="identifier-type" scheme="onix:codelist5">${xml(identifierScheme)}</meta>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="${EPUB_VERSION}" unique-identifier="pub-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="pub-id">${xml(identifier)}</dc:identifier><dc:title>${xml(metadata.title)}</dc:title><dc:creator>${xml(metadata.author)}</dc:creator><dc:language>${xml(metadata.language)}</dc:language>${metadata.description ? `<dc:description>${xml(metadata.description)}</dc:description>` : ""}${identifierMeta}</metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>\n`;
}

function preflight(assembled: AssembledBook): void {
  const { book, assets } = assembled;
  if (!book.metadata?.title || !book.metadata.author || !book.metadata.language)
    throw exportError(
      "EPUB_METADATA_INVALID",
      "Title, author and language are required before exporting an EPUB.",
    );
  if (book.coverAssetId) {
    const cover = book.assets.find(
      (asset) =>
        asset.status === "available" &&
        asset.descriptor.id === book.coverAssetId,
    );
    if (!cover || !assets.has(book.coverAssetId))
      throw exportError(
        "EPUB_COVER_INVALID",
        "The selected cover asset is missing or invalid.",
      );
  }
}

/** Pure local EPUB 3.3 packaging from one captured project revision. */
export function generateEpub(assembled: AssembledBook): EpubPackage {
  preflight(assembled);
  const { book, assets, presentation } = assembled;
  const rendered = renderBook(book, {
    target: "ebook",
    resolveAsset: (asset) => {
      const extension = imageExtension(asset.mediaType);
      return extension
        ? {
            kind: "relative",
            value: `../images/${safeId(asset.id)}.${extension}`,
          }
        : undefined;
    },
    resolveInternalLink: (target) =>
      `../text/${safeId(target.chapterId)}.xhtml#${target.id}`,
  });
  if (!rendered.ok || rendered.diagnostics.length > 0)
    throw exportError(
      "EPUB_CONTENT_INVALID",
      "The manuscript contains content or references that cannot be packaged as EPUB.",
    );
  const theme = getBookTheme(resolveBookTheme(presentation.themeId).themeId);
  const files: EpubFile[] = [
    {
      path: "nav.xhtml",
      bytes: strToU8(navigationDocument(book.language, rendered.chapters)),
      mediaType: "application/xhtml+xml",
      properties: "nav",
    },
    {
      path: "styles/book.css",
      bytes: strToU8(
        generateThemeStyles(theme, "ebook", {
          fontPolicy: "generic-only",
        }).css,
      ),
      mediaType: "text/css",
    },
  ];
  for (const chapter of rendered.chapters)
    files.push({
      path: `text/${safeId(chapter.id)}.xhtml`,
      bytes: strToU8(
        contentDocument(book.language, chapter.title, chapter.xhtml),
      ),
      mediaType: "application/xhtml+xml",
    });
  const referencedAssets = new Set(
    rendered.chapters.flatMap((chapter) => chapter.assetIds),
  );
  for (const assetId of referencedAssets) {
    const asset = book.assets.find(
      (candidate) =>
        candidate.status === "available" && candidate.descriptor.id === assetId,
    );
    const bytes = assets.get(assetId);
    const extension =
      asset?.status === "available"
        ? imageExtension(asset.descriptor.mediaType)
        : null;
    if (!asset || asset.status !== "available" || !bytes || !extension)
      throw exportError(
        "EPUB_ASSET_INVALID",
        "A referenced project asset is missing or invalid.",
      );
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== asset.descriptor.sha256)
      throw exportError(
        "EPUB_ASSET_CHANGED",
        "A referenced project asset changed during export.",
      );
    const imageFile: EpubFile = {
      path: `images/${safeId(assetId)}.${extension}`,
      bytes,
      mediaType: asset.descriptor.mediaType,
    };
    if (assetId === book.coverAssetId) imageFile.properties = "cover-image";
    files.push(imageFile);
  }
  for (const file of files) ensureSafePath(file.path);
  const packageFile: EpubFile = {
    path: "package.opf",
    bytes: strToU8(packageDocument(book, rendered.chapters, files)),
    mediaType: "application/oebps-package+xml",
  };
  const allFiles = [...files, packageFile];
  const entries: Record<
    string,
    Uint8Array | [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]
  > = {
    mimetype: [strToU8(EPUB_MEDIA_TYPE), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  };
  for (const file of allFiles) entries[`OEBPS/${file.path}`] = file.bytes;
  const bytes = zipSync(entries, { level: 6 });
  validateEpubArchive(bytes);
  return { bytes, revision: book.revision, warnings: [] };
}

/** Deterministic structural validation used offline before publication. */
export function validateEpubArchive(bytes: Uint8Array): void {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw exportError(
      "EPUB_VALIDATION_FAILED",
      "The generated EPUB archive is malformed.",
    );
  }
  const mimetype = files.mimetype;
  if (
    !mimetype ||
    new TextDecoder().decode(mimetype) !== EPUB_MEDIA_TYPE ||
    mimetype.length !== EPUB_MEDIA_TYPE.length ||
    !files["META-INF/container.xml"] ||
    !files["OEBPS/package.opf"] ||
    !files["OEBPS/nav.xhtml"]
  )
    throw exportError(
      "EPUB_VALIDATION_FAILED",
      "The generated EPUB is missing a required EPUB container resource.",
    );
  const text = (path: string) => {
    const bytes = files[path];
    if (!bytes)
      throw exportError(
        "EPUB_VALIDATION_FAILED",
        "The generated EPUB references a missing document.",
      );
    return new TextDecoder().decode(bytes);
  };
  const resolveReference = (source: string, reference: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("#"))
      return null;
    const base = source.split("/");
    base.pop();
    for (const part of (reference.split("#")[0] ?? "").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") base.pop();
      else base.push(part);
    }
    return base.join("/");
  };
  for (const path of Object.keys(files).filter((name) =>
    name.endsWith(".xhtml"),
  )) {
    const document = text(path);
    if (/<script\b/i.test(document))
      throw exportError(
        "EPUB_VALIDATION_FAILED",
        "Generated EPUB content must not contain scripts.",
      );
    for (const match of document.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const reference = match[1];
      if (!reference) continue;
      const target = resolveReference(path, reference);
      if (target && !files[target])
        throw exportError(
          "EPUB_LINK_INVALID",
          "The generated EPUB contains a broken internal resource reference.",
        );
    }
  }
}
