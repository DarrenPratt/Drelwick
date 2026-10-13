import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  assembleBook,
  printSourceRevision,
  printPreflight,
  type AssembledBook,
} from "@drelwick/core";
import {
  escapeXml,
  printRoman,
  printStyles,
  printTypography,
  renderBook,
} from "@drelwick/renderer";
import {
  ApplicationError,
  PrintSettingsSchema,
  printPageGeometry,
  type PrintPreview,
} from "@drelwick/shared";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { getDocument as GetDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { inspectPrintPdf } from "./print-inspection.js";

const require = createRequire(import.meta.url);
const printFontFiles = {
  serif: [
    () =>
      require.resolve("@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff"),
    () =>
      require.resolve("@fontsource/noto-serif/files/noto-serif-latin-700-normal.woff"),
    () =>
      require.resolve("@fontsource/noto-serif/files/noto-serif-latin-400-italic.woff"),
    () =>
      require.resolve("@fontsource/noto-serif/files/noto-serif-latin-700-italic.woff"),
  ],
  sans: [
    () =>
      require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"),
    () =>
      require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff"),
    () =>
      require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff"),
    () =>
      require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-italic.woff"),
  ],
};
export const PRINT_LIMITS = {
  milliseconds: 120_000,
  resourceMilliseconds: 15_000,
  bytes: 64 * 1024 * 1024,
  pages: 2000,
  chapters: 1000,
} as const;
export interface PrintSurface {
  render(
    document: string,
    contentHeight: number,
  ): Promise<{ pdf: Uint8Array; overflow: boolean; clipping: boolean }>;
  close(): void;
}
const printFailureMessages: Record<string, string> = {
  PRINT_UNRESOLVED_FONT:
    "Blocking preflight error: characters are not supported by the bundled print fonts. Review this chapter and use supported characters.",
  PRINT_ASSET_OR_CONTENT_INVALID:
    "Blocking preflight error: missing image or unsupported content. Restore the local image or correct this chapter.",
  PRINT_CONFIGURATION_INVALID:
    "Blocking preflight error: invalid trim or margins. Correct Book design > Print settings and refresh.",
  PRINT_FONT_LOAD_FAILED:
    "Blocking preflight error: bundled print fonts could not be loaded. Repair the local application installation and refresh; no font download is required.",
};
const failed = (code: string, location = "") =>
  new ApplicationError(
    code,
    `${printFailureMessages[code] ?? "Print preview could not be completed. Check print settings, local images and supported fonts, then retry. Your manuscript is unchanged."}${location ? ` Chapter: ${location}.` : ""}`,
  );
const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const points = (um: number) => (um * 72) / 25400;

export async function preparePrintPreview(
  path: string,
  projectId: string,
  factory: () => PrintSurface,
): Promise<PrintPreview> {
  const snapshot = await assembleBook(path, { print: true });
  if (snapshot.book.projectId !== projectId) throw failed("PROJECT_NOT_OPEN");
  return renderPrintRevision(snapshot, factory);
}

/** The sole PDF production pipeline; preview and export consume these exact bytes. */
export async function renderPrintRevision(
  snapshot: AssembledBook,
  factory: () => PrintSurface,
  timeout: number = PRINT_LIMITS.milliseconds,
): Promise<PrintPreview> {
  let surface: PrintSurface | undefined;
  let inspectionTask: ReturnType<typeof GetDocument> | undefined;
  const expiresAt = Date.now() + timeout;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      surface?.close();
      void inspectionTask?.destroy();
      reject(failed("PRINT_TIMEOUT"));
    }, timeout);
  });
  const check = () => {
    if (expired || Date.now() >= expiresAt) throw failed("PRINT_TIMEOUT");
  };
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const settings = snapshot.print?.settings;
        if (!settings || !PrintSettingsSchema.safeParse(settings).success)
          throw failed("PRINT_CONFIGURATION_INVALID");
        const edition = snapshot.print!.edition;
        const profile = snapshot.print!.editions[edition];
        const theme = profile.themeId;
        const typography = printTypography(theme, profile.typography);
        const runningSize =
          edition === "large-print"
            ? Math.max(14, typography.baseSizePt * 0.8)
            : 9;
        const fontFiles = printFontFiles[theme === "modern" ? "sans" : "serif"];
        const fonts = await Promise.all(
          (
            [
              [400, "normal"],
              [700, "normal"],
              [400, "italic"],
              [700, "italic"],
            ] as const
          ).map(async ([weight, style], index) => {
            try {
              const bytes = await readFile(fontFiles[index]!());
              return { bytes, weight, style, face: fontkit.create(bytes) };
            } catch {
              throw failed("PRINT_FONT_LOAD_FAILED");
            }
          }),
        );
        check();
        const fontCss = fonts
          .map(
            ({ bytes, weight, style }) =>
              `@font-face { font-family: DrelwickPrint; font-weight: ${weight}; font-style: ${style}; src: url(data:font/woff;base64,${bytes.toString("base64")}) format('woff'); }`,
          )
          .join("\n");
        const rendered = renderBook(snapshot.book, {
          target: "print",
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
        if (!rendered.ok)
          throw failed(
            "PRINT_ASSET_OR_CONTENT_INVALID",
            snapshot.book.chapters.find(
              (chapter) =>
                chapter.id ===
                rendered.diagnostics.find((d) => d.severity === "error")
                  ?.chapterId,
            )?.title,
          );
        if (
          !rendered.chapters.length ||
          rendered.chapters.length > PRINT_LIMITS.chapters ||
          rendered.chapters.reduce(
            (n, c) => n + Buffer.byteLength(c.xhtml),
            0,
          ) > PRINT_LIMITS.bytes
        )
          throw failed("PRINT_RESOURCE_LIMIT");
        const { getDocument, OPS } =
          await import("pdfjs-dist/legacy/build/pdf.mjs");
        check();
        const pdf = await PDFDocument.create();
        pdf.registerFontkit(fontkit);
        pdf.setTitle(snapshot.book.title);
        pdf.setAuthor(snapshot.book.metadata?.author ?? "");
        pdf.setLanguage(snapshot.book.language);
        pdf.setCreator("Drelwick Community");
        pdf.setProducer("Drelwick local Chromium print");
        const headerFont = await pdf.embedFont(fonts[0]!.bytes, {
          subset: true,
        });
        const result: PrintPreview = {
          revision: hash(
            JSON.stringify({
              pipeline: 3,
              chromium: process.versions.chrome,
              book: snapshot.book.revision,
              settings,
              theme,
              edition,
              typography,
              fonts: fonts.map((f) => hash(f.bytes)),
            }),
          ),
          pdf: new Uint8Array(),
          pages: [],
          diagnostics: [],
          export: {
            edition,
            sourceRevision: printSourceRevision(snapshot),
            settings,
            title: snapshot.book.title,
            author: snapshot.book.metadata?.author ?? "",
            language: snapshot.book.language,
            chapters: snapshot.book.chapters.map(({ id, title }) => ({
              id,
              title,
            })),
            findings: [],
          },
        };
        const checkedGlyphs = new Set<number>();
        const inspectFont = (text: string) => {
          for (const character of text) {
            const code = character.codePointAt(0)!;
            if (checkedGlyphs.has(code) || /\s/u.test(character)) continue;
            if (!fonts.every((font) => font.face.hasGlyphForCodePoint(code)))
              return false;
            checkedGlyphs.add(code);
          }
          return true;
        };
        // Check semantic strings (not markup/entities) before Chromium can silently substitute a platform font.
        const strings = (node: unknown): string[] => {
          if (!node || typeof node !== "object") return [];
          const value = node as {
            text?: string;
            content?: unknown[];
            attrs?: { attribution?: string };
          };
          return [
            value.text ?? "",
            value.attrs?.attribution ?? "",
            ...(value.content ?? []).flatMap(strings),
          ];
        };
        for (const chapter of snapshot.book.chapters.filter((c) =>
          rendered.chapters.some((r) => r.id === c.id),
        )) {
          if (
            ![
              chapter.title,
              ...strings(chapter.document),
              snapshot.book.title,
              snapshot.book.metadata?.author ?? "",
            ].every(inspectFont)
          )
            throw failed("PRINT_UNRESOLVED_FONT", chapter.title);
        }
        check();
        surface = factory();
        let producedBytes = 0;
        let front = 1;
        let body = settings.pageNumbers.bodyStart;
        for (const chapter of rendered.chapters) {
          check();
          const section = chapter.publication?.section ?? "body";
          if (
            section === "body" &&
            settings.chapterStart === "recto" &&
            pdf.getPageCount() % 2 === 1
          ) {
            pdf.addPage([
              points(settings.trim.width),
              points(settings.trim.height),
            ]);
            result.pages.push({
              chapterId: chapter.id,
              side: "verso",
              blank: true,
              folio: "",
            });
            // A separator belongs to the preceding section; hidden folios still count.
            if (
              result.pages.length > 1 &&
              rendered.chapters.find(
                (c) => c.id === result.pages.at(-2)?.chapterId,
              )?.publication?.section === "front"
            )
              front++;
            else body++;
          }
          const css =
            fontCss +
            printStyles(
              settings,
              theme,
              pdf.getPageCount() % 2 === 0,
              profile.typography,
            );
          const policy = `default-src 'none'; script-src 'none'; style-src 'sha256-${createHash("sha256").update(css).digest("base64")}'; style-src-attr 'none'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
          const document = `<!doctype html><html lang="${escapeXml(snapshot.book.language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeXml(policy)}"><style>${css}</style></head><body>${chapter.xhtml}</body></html>`;
          const output = await surface
            .render(
              document,
              (printPageGeometry(settings, "recto").contentHeight * 96) / 25400,
            )
            .catch((error: unknown) => {
              if (
                error instanceof ApplicationError &&
                [
                  "PRINT_FONT_LOAD_FAILED",
                  "PRINT_ASSET_OR_CONTENT_INVALID",
                ].includes(error.code)
              )
                throw failed(error.code, chapter.title);
              throw error;
            });
          check();
          producedBytes += output.pdf.byteLength;
          if (producedBytes > PRINT_LIMITS.bytes)
            throw failed("PRINT_RESOURCE_LIMIT");
          if (output.overflow)
            result.diagnostics.push({
              code: "overflow",
              chapterId: chapter.id,
            });
          if (output.clipping)
            result.diagnostics.push({
              code: "clipping",
              chapterId: chapter.id,
            });
          const part = await PDFDocument.load(output.pdf);
          if (pdf.getPageCount() + part.getPageCount() > PRINT_LIMITS.pages)
            throw failed("PRINT_RESOURCE_LIMIT");
          const pages = await pdf.copyPages(part, part.getPageIndices());
          check();
          const inspection = getDocument({
            data: Uint8Array.from(output.pdf),
            useSystemFonts: false,
            isEvalSupported: false,
            disableFontFace: true,
            verbosity: 0,
          });
          inspectionTask = inspection;
          try {
            const inspected = await inspection.promise;
            for (let index = 1; index <= inspected.numPages; index++) {
              check();
              const page = await inspected.getPage(index);
              const content = await page.getTextContent();
              const operators = await page.getOperatorList();
              if (
                !content.items.some(
                  (item) => "str" in item && item.str.trim(),
                ) &&
                !operators.fnArray.some((op) =>
                  [
                    OPS.paintImageXObject,
                    OPS.paintInlineImageXObject,
                    OPS.paintImageMaskXObject,
                  ].includes(op),
                )
              )
                result.diagnostics.push({
                  code: "unexpected-blank",
                  chapterId: chapter.id,
                  page: pdf.getPageCount() + index,
                });
              for (const item of content.items) {
                if (!("str" in item) || !item.str.trim()) continue;
                const [, , , , x, y] = item.transform as number[];
                const geometry = printPageGeometry(
                  settings,
                  (pdf.getPageCount() + index) % 2 === 1 ? "recto" : "verso",
                );
                if (
                  x! < points(geometry.left) - 2 ||
                  y! < points(geometry.bottom) - 2 ||
                  x! + item.width >
                    page.view[2]! - points(geometry.right) + 2 ||
                  y! > page.view[3]! - points(geometry.top) + 2
                )
                  result.diagnostics.push({
                    code: "clipping",
                    chapterId: chapter.id,
                    page: pdf.getPageCount() + index,
                  });
              }
              page.cleanup();
            }
          } finally {
            await inspection.destroy();
            inspectionTask = undefined;
          }
          for (const [index, page] of pages.entries()) {
            check();
            const side = pdf.getPageCount() % 2 === 0 ? "recto" : "verso";
            const opening = section === "body" && index === 0;
            const number =
              section === "front" ? printRoman(front++) : String(body++);
            const folio =
              settings.pageNumbers.enabled &&
              (!opening || settings.pageNumbers.showOnChapterOpening) &&
              (section !== "front" ||
                settings.pageNumbers.frontMatter === "roman")
                ? number
                : "";
            const header = settings.headers[side];
            const text =
              opening && !settings.headers.showOnChapterOpening
                ? ""
                : header === "author"
                  ? (snapshot.book.metadata?.author ?? "")
                  : header === "book-title"
                    ? snapshot.book.title
                    : header === "chapter-title" && section === "body"
                      ? chapter.title
                      : "";
            const geometry = printPageGeometry(settings, side);
            for (const [value, top, center] of [
              [text, true, false],
              [folio, false, settings.pageNumbers.position === "footer-center"],
            ] as const) {
              if (!value) continue;
              const width = headerFont.widthOfTextAtSize(value, runningSize);
              if (
                /[\t\r\n\u2028\u2029]/u.test(value) ||
                width > points(geometry.contentWidth) ||
                runningSize * 1.5 > points(top ? geometry.top : geometry.bottom)
              ) {
                result.diagnostics.push({
                  code: "overflow",
                  chapterId: chapter.id,
                  page: pdf.getPageCount() + 1,
                });
                continue;
              }
              const x = center
                ? (page.getWidth() - width) / 2
                : side === "recto"
                  ? page.getWidth() - points(geometry.right) - width
                  : points(geometry.left);
              page.drawText(value, {
                font: headerFont,
                size: runningSize,
                x,
                y: top
                  ? page.getHeight() -
                    points(geometry.top) / 2 -
                    (runningSize * 4) / 9
                  : points(geometry.bottom) / 2 - (runningSize * 4) / 9,
              });
            }
            pdf.addPage(page);
            result.pages.push({
              chapterId: chapter.id,
              side,
              blank: false,
              folio,
            });
          }
        }
        check();
        result.diagnostics = [
          ...new Map(
            result.diagnostics.map((diagnostic) => [
              JSON.stringify(diagnostic),
              diagnostic,
            ]),
          ).values(),
        ];
        result.pdf = await pdf.save();
        check();
        if (result.pdf.byteLength > PRINT_LIMITS.bytes)
          throw failed("PRINT_RESOURCE_LIMIT");
        result.export!.findings = [
          ...printPreflight(result),
          ...(await inspectPrintPdf(result)),
        ];
        check();
        return result;
      })(),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    surface?.close();
  }
}
