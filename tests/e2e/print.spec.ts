import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "../../apps/desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs";

test("Chromium PDF pagination, recto, running matter, offline isolation and repeatable final render", async () => {
  test.setTimeout(120_000);
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-print-test-"));
  const desktop = resolve("apps/desktop");
  const bootstrap = join(scratch, "bootstrap.cjs");
  await writeFile(
    bootstrap,
    `globalThis.printImport = url => import(url); const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>new BrowserWindow({show:false}));`,
  );
  const application = await electron.launch({
    args: [bootstrap, `--user-data-dir=${join(scratch, "profile")}`],
    cwd: desktop,
  });
  try {
    const results = await application.evaluate(
      async ({ BrowserWindow }, { renderer, surface, shared }) => {
        const load = (
          globalThis as unknown as {
            printImport(url: string): Promise<unknown>;
          }
        ).printImport;
        const { renderPrintRevision } = (await load(
          renderer,
        )) as typeof import("../../apps/desktop/src/main/print-render.js");
        const { createPrintSurface } = (await load(
          surface,
        )) as typeof import("../../apps/desktop/src/main/print-surface.js");
        const { defaultPrintSettings } = (await load(
          shared,
        )) as typeof import("../../packages/shared/src/index.js");
        const settings = defaultPrintSettings();
        settings.chapterStart = "recto";
        settings.headers.showOnChapterOpening = true;
        settings.headers.verso = "chapter-title";
        const paragraph = (text: string) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        });
        const chapter = (
          id: string,
          title: string,
          section: "front" | "body" | "back",
          content: unknown[],
        ) => ({
          id,
          title,
          type:
            section === "body"
              ? "chapter"
              : section === "front"
                ? "frontmatter"
                : "backmatter",
          publication: {
            section,
            inclusion: { ebook: true, print: true, navigation: true },
          },
          document: { type: "doc", content },
        });
        const snapshot = {
          print: { settings, revision: "a".repeat(64) },
          presentation: { schemaVersion: 1, themeId: "classic" },
          assets: new Map(),
          book: {
            projectId: "11111111-1111-4111-8111-111111111111",
            revision: "b".repeat(64),
            title: "A Printed Book",
            language: "en-GB",
            assets: [],
            chapters: [
              chapter(
                "11111111-1111-4111-8111-111111111112",
                "Dedication",
                "front",
                [paragraph("For every reader.")],
              ),
              chapter(
                "11111111-1111-4111-8111-111111111113",
                "A Long Chapter Heading That Wraps Across Several Lines",
                "body",
                [
                  ...Array.from({ length: 65 }, (_, i) =>
                    paragraph(
                      `Paragraph ${i + 1}. Café, naïve, résumé — “Unicode prose”. ` +
                        "The traveller followed the river through the quiet valley. ".repeat(
                          5,
                        ),
                    ),
                  ),
                  { type: "sceneBreak" },
                  paragraph("After the scene break."),
                  {
                    type: "heading",
                    attrs: { level: 2 },
                    content: [
                      {
                        type: "text",
                        text: "Keep this heading with its paragraph",
                      },
                    ],
                  },
                  paragraph("The final paragraph remains with the heading."),
                ],
              ),
              chapter(
                "11111111-1111-4111-8111-111111111114",
                "Last Chapter",
                "body",
                [
                  paragraph(
                    "An ending with a soft hyphen: extra\u00adordinary.",
                  ),
                ],
              ),
              chapter(
                "11111111-1111-4111-8111-111111111115",
                "Acknowledgements",
                "back",
                [paragraph("Thank you.")],
              ),
            ],
          },
        } as unknown as Parameters<typeof renderPrintRevision>[0];
        const { createHash } = (await load(
          "node:crypto",
        )) as typeof import("node:crypto");
        const bytes = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
          "base64",
        );
        const imageId = "11111111-1111-4111-8111-111111111116";
        snapshot.assets = new Map([[imageId, bytes]]);
        snapshot.book.assets = [
          {
            status: "available",
            descriptor: {
              id: imageId,
              mediaType: "image/png",
              width: 2,
              height: 2,
              byteSize: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          },
        ];
        snapshot.book.chapters[2]!.document.content!.push({
          type: "image",
          attrs: {
            assetId: imageId,
            alt: "Synthetic red square",
            size: "small",
          },
        });
        const before = BrowserWindow.getAllWindows().length;
        const first = await renderPrintRevision(snapshot, createPrintSurface);
        const second = await renderPrintRevision(snapshot, createPrintSurface);
        const { createRequire } = (await load(
          "node:module",
        )) as typeof import("node:module");
        const { PDFDocument, PDFDict, PDFName } = createRequire(renderer)(
          "pdf-lib",
        ) as typeof import("../../apps/desktop/node_modules/pdf-lib/cjs/index.js");
        const parsedPdf = await PDFDocument.load(first.pdf);
        const descriptors = parsedPdf.context
          .enumerateIndirectObjects()
          .map(([, object]) => object)
          .filter(
            (object) =>
              object instanceof PDFDict &&
              object.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"),
          ) as import("../../apps/desktop/node_modules/pdf-lib/cjs/index.js").PDFDict[];
        const embeddedFonts =
          descriptors.length > 0 &&
          descriptors.every(
            (descriptor) =>
              descriptor.has(PDFName.of("FontFile2")) ||
              descriptor.has(PDFName.of("FontFile3")),
          );
        const damaged = {
          ...snapshot,
          assets: new Map([[imageId, Buffer.from("damaged image")]]),
        };
        let imageFailure = false;
        try {
          await renderPrintRevision(damaged, createPrintSurface);
        } catch {
          imageFailure = true;
        }
        const oversized = structuredClone(snapshot);
        oversized.book.chapters = [oversized.book.chapters[1]!];
        oversized.book.chapters[0]!.document.content = [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Oversized heading ".repeat(200) }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Unbreakable".repeat(200) }],
          },
        ];
        const measured = await renderPrintRevision(
          oversized,
          createPrintSurface,
        );
        const pages = first.pages;
        const pdf = Buffer.from(first.pdf).toString("base64");
        const secondPdf = Buffer.from(second.pdf).toString("base64");
        let unsupported = "";
        snapshot.book.chapters[0]!.document.content = [
          { type: "paragraph", content: [{ type: "text", text: "漢字" }] },
        ];
        try {
          await renderPrintRevision(snapshot, createPrintSurface);
        } catch (error) {
          unsupported = (error as { code: string }).code;
        }
        let timeout = "";
        snapshot.book.chapters[0]!.document.content = [
          { type: "paragraph", content: [{ type: "text", text: "Supported" }] },
        ];
        try {
          await renderPrintRevision(snapshot, createPrintSurface, 1);
        } catch (error) {
          timeout = (error as { code: string }).code;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        const { createServer } = (await load(
          "node:http",
        )) as typeof import("node:http");
        let hits = 0;
        const server = createServer((_request, response) => {
          hits++;
          response.end("blocked");
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address() as { port: number };
        const isolated = createPrintSurface();
        let blocked = false;
        try {
          await isolated.render(
            `<img src="http://127.0.0.1:${address.port}/asset">`,
            700,
          );
        } catch {
          blocked = true;
        } finally {
          isolated.close();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        const broken = createPrintSurface();
        let fontFailure = false;
        try {
          await broken.render(
            `<style>@font-face{font-family:DrelwickPrint;src:url(data:font/woff;base64,AAAA)}</style><p>Font</p>`,
            700,
          );
        } catch {
          fontFailure = true;
        } finally {
          broken.close();
        }
        const windowIds = new Set(
          BrowserWindow.getAllWindows().map((window) => window.id),
        );
        let resourceTimeout = "";
        try {
          await renderPrintRevision(snapshot, () => {
            const hung = createPrintSurface(1000);
            const printWindow = BrowserWindow.getAllWindows().find(
              (window) => !windowIds.has(window.id),
            )!;
            printWindow.webContents.printToPDF = () => new Promise(() => {});
            return hung;
          });
        } catch (error) {
          resourceTimeout = (error as { code: string }).code;
        }
        return {
          pages,
          pdf,
          secondPdf,
          revision: first.revision,
          secondRevision: second.revision,
          diagnostics: first.diagnostics,
          unsupported,
          timeout,
          before,
          after: BrowserWindow.getAllWindows().length,
          hits,
          blocked,
          fontFailure,
          resourceTimeout,
          embeddedFonts,
          imageFailure,
          measured: measured.diagnostics.map((diagnostic) => diagnostic.code),
        };
      },
      {
        renderer: pathToFileURL(join(desktop, "dist/main/print-render.js"))
          .href,
        surface: pathToFileURL(join(desktop, "dist/main/print-surface.js"))
          .href,
        shared: pathToFileURL(resolve("packages/shared/dist/index.js")).href,
      },
    );
    expect(results.diagnostics).toEqual([]);
    expect(results.pages.length).toBeGreaterThan(5);
    expect(results.pages[0]!.folio).toBe("i");
    expect(results.pages[1]!.blank).toBe(true);
    expect(results.pages[2]).toMatchObject({ side: "recto", folio: "1" });
    expect(
      results.pages.find(
        (page) => page.chapterId.endsWith("114") && !page.blank,
      )?.side,
    ).toBe("recto");
    expect(results.revision).toBe(results.secondRevision);
    expect(results.unsupported).toBe("PRINT_UNRESOLVED_FONT");
    expect(results.timeout).toBe("PRINT_TIMEOUT");
    expect(results.after).toBe(results.before);
    expect(results.hits).toBe(0);
    expect(results.blocked).toBe(true);
    expect(results.fontFailure).toBe(true);
    expect(results.resourceTimeout).toBe("PRINT_RESOURCE_TIMEOUT");
    expect(results.embeddedFonts).toBe(true);
    expect(results.imageFailure).toBe(true);
    expect(results.measured).toContain("overflow");
    expect(results.measured).toContain("clipping");
    await writeFile(
      join(scratch, "preview.pdf"),
      Buffer.from(results.pdf, "base64"),
    );
    // Independent PDF.js text/geometry comparison, ignoring PDF creation timestamps.
    const inspect = async (bytes: Uint8Array) => {
      const task = getDocument({
        data: bytes,
        useSystemFonts: false,
        isEvalSupported: false,
      });
      try {
        const pdf = await task.promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          pages.push({
            size: page.view,
            text: (await page.getTextContent()).items.map((item) =>
              "str" in item
                ? { text: item.str, position: item.transform }
                : item,
            ),
          });
        }
        return pages;
      } finally {
        await task.destroy();
      }
    };
    const pages = await inspect(
      new Uint8Array(await readFile(join(scratch, "preview.pdf"))),
    );
    expect(pages).toEqual(
      await inspect(new Uint8Array(Buffer.from(results.secondPdf, "base64"))),
    );
    expect(pages[1]!.text).toEqual([]);
    expect(JSON.stringify(pages)).toContain("Paragraph 65.");
    expect(JSON.stringify(pages)).toContain("After the scene break.");
    if (process.platform === "win32")
      expect(pages).toEqual(
        JSON.parse(
          await readFile(test.info().snapshotPath("print-pages.json"), "utf8"),
        ),
      );
    // Track each prose paragraph across physical pages by its line baselines.
    let paragraph = 0;
    const fragments = new Map<number, Map<number, Set<number>>>();
    pages.forEach((page, index) => {
      for (const item of page.text) {
        if (!("text" in item) || !item.text.trim()) continue;
        const y = item.position[5] as number;
        if (y < 54 || y > 594) continue; // running matter is outside the content area
        const match = /^Paragraph (\d+)\./.exec(item.text);
        if (match) paragraph = Number(match[1]);
        if (item.text.startsWith("After the scene")) paragraph = 0;
        if (!paragraph) continue;
        const byPage =
          fragments.get(paragraph) ?? new Map<number, Set<number>>();
        const lines = byPage.get(index) ?? new Set<number>();
        lines.add(y);
        byPage.set(index, lines);
        fragments.set(paragraph, byPage);
      }
    });
    const split = [...fragments.values()].filter((pages) => pages.size > 1);
    expect(split.length).toBeGreaterThan(0);
    for (const pages of split)
      for (const lines of pages.values())
        expect(lines.size).toBeGreaterThanOrEqual(2);
    const headingPage = pages.findIndex((page) =>
      JSON.stringify(page.text).includes("Keep this heading"),
    );
    expect(JSON.stringify(pages[headingPage]!.text)).toContain(
      "The final paragraph",
    );
    await test.info().attach("print-preview.pdf", {
      body: Buffer.from(results.pdf, "base64"),
      contentType: "application/pdf",
    });
  } finally {
    await application.close();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
