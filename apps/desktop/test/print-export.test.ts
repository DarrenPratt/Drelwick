import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { BrowserWindow } from "electron";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  assembleBook,
  printSourceRevision,
  saveChapter,
  savePrintConfiguration,
} from "@drelwick/core";
import type { PrintPreview } from "@drelwick/shared";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
const { save, confirm } = vi.hoisted(() => ({
  save: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: { showSaveDialog: save, showMessageBox: confirm },
}));
import { exportPrint } from "../src/main/print-export.js";
import { inspectPrintPdf } from "../src/main/print-inspection.js";
const require = createRequire(import.meta.url);
const copies: FixtureCopy[] = [];
beforeEach(() => {
  save.mockReset();
  confirm.mockReset();
});
afterEach(async () => {
  await Promise.all(copies.splice(0).map((c) => c.cleanup()));
});
async function fixture() {
  const copy = await copyFixture("multi-chapter-book");
  copies.push(copy);
  const snapshot = await assembleBook(copy.projectPath, { print: true });
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle(snapshot.book.title);
  document.setAuthor(snapshot.book.metadata!.author);
  document.setLanguage(snapshot.book.language);
  const font = await document.embedFont(
    await readFile(
      require.resolve("@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff"),
    ),
    { subset: true },
  );
  document
    .addPage([432, 648])
    .drawText("Synthetic print proof", { font, x: 70, y: 500, size: 12 });
  const preview: PrintPreview = {
    revision: "a".repeat(64),
    pdf: await document.save(),
    pages: [
      {
        chapterId: snapshot.book.chapters[0]!.id,
        side: "recto",
        blank: false,
        folio: "1",
      },
    ],
    diagnostics: [],
    export: {
      sourceRevision: printSourceRevision(snapshot),
      settings: snapshot.print!.settings,
      title: snapshot.book.title,
      author: snapshot.book.metadata!.author,
      language: snapshot.book.language,
      chapters: [],
      findings: [],
    },
  };
  const path = join(dirname(copy.projectPath), "proof.pdf");
  save.mockResolvedValue({ canceled: false, filePath: path });
  const controller = new AbortController();
  const options = {
    authorized: () => true,
    signal: controller.signal,
    acceptWarnings: false,
    progress: vi.fn(),
  };
  const run = () =>
    exportPrint({} as BrowserWindow, copy.projectPath, preview, options);
  return { copy, preview, path, options, controller, run, snapshot };
}

it("inspects actual page boxes, metadata, language and embedded fonts and exports identical bytes", async () => {
  const f = await fixture();
  expect(await inspectPrintPdf(f.preview)).toEqual([]);
  expect(await f.run()).toMatchObject({
    created: true,
    revision: f.preview.revision,
  });
  expect(await readFile(f.path)).toEqual(Buffer.from(f.preview.pdf));
  const pdf = await PDFDocument.load(await readFile(f.path));
  expect(pdf.getPages()[0]!.getMediaBox()).toEqual({
    x: 0,
    y: 0,
    width: 432,
    height: 648,
  });
  expect(pdf.getTitle()).toBe(f.snapshot.book.title);
  const before = f.preview.pdf;
  pdf.getPages()[0]!.setMediaBox(0, 0, 500, 700);
  pdf.addPage([432, 648]);
  pdf.setTitle("wrong");
  pdf.setLanguage("fr");
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.get(PDFName.of("Type")) === PDFName.of("FontDescriptor")
    ) {
      object.delete(PDFName.of("FontFile2"));
      object.delete(PDFName.of("FontFile3"));
    }
  }
  f.preview.pdf = await pdf.save();
  expect((await inspectPrintPdf(f.preview)).map((v) => v.code)).toEqual(
    expect.arrayContaining([
      "page-count",
      "page-box",
      "metadata",
      "metadata-language",
      "font-embedding",
    ]),
  );
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_PREFLIGHT" });
  expect(await readFile(f.path)).toEqual(Buffer.from(before));
  expect(
    (await inspectPrintPdf(f.preview, new Uint8Array())).map((v) => v.code),
  ).toContain("invalid-pdf");
});

it("rejects stale previews before selection and source changes during destination selection", async () => {
  const f = await fixture();
  const mutate = async () =>
    saveChapter({
      projectPath: f.copy.projectPath,
      chapterId: f.snapshot.book.chapters[0]!.id,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Changed after preview" }],
          },
        ],
      },
    });
  await writeFile(f.path, "previous PDF");
  save.mockImplementationOnce(async () => {
    await mutate();
    return { canceled: false, filePath: f.path };
  });
  confirm.mockResolvedValue({ response: 1 });
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_STALE" });
  expect(await readFile(f.path, "utf8")).toBe("previous PDF");
  expect(
    (await readdir(dirname(f.path))).filter((p) => p.endsWith(".tmp")),
  ).toEqual([]);
  save.mockClear();
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_STALE" });
  expect(save).not.toHaveBeenCalled();
});

it("rejects a different selected edition even when geometry is identical, including a switch during export", async () => {
  const f = await fixture();
  const switchEdition = async () => {
    const current = (await assembleBook(f.copy.projectPath, { print: true }))
      .print!;
    return savePrintConfiguration({
      projectPath: f.copy.projectPath,
      projectId: f.snapshot.book.projectId,
      expectedRevision: current.revision,
      edition: "large-print",
      ...current.editions["large-print"],
    });
  };
  await writeFile(f.path, "previous PDF");
  save.mockImplementationOnce(async () => {
    await switchEdition();
    return { canceled: false, filePath: f.path };
  });
  confirm.mockResolvedValue({ response: 1 });
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_STALE" });
  expect(await readFile(f.path, "utf8")).toBe("previous PDF");
  save.mockClear();
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_STALE" });
  expect(save).not.toHaveBeenCalled();
});

it("preserves existing exports when overwrite is rejected, picker cancelled, or cancellation follows confirmation", async () => {
  const f = await fixture();
  await writeFile(f.path, "previous PDF");
  confirm.mockResolvedValue({ response: 0 });
  expect(await f.run()).toMatchObject({ created: false });
  save.mockResolvedValueOnce({ canceled: true });
  expect(await f.run()).toMatchObject({ created: false });
  confirm.mockImplementationOnce(async () => {
    f.controller.abort();
    return { response: 1 };
  });
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_CANCELLED" });
  expect(await readFile(f.path, "utf8")).toBe("previous PDF");
});

it("requires warning acknowledgement and blocks measured overflow without opening a picker", async () => {
  const f = await fixture();
  f.preview.diagnostics = [
    {
      code: "unexpected-blank",
      chapterId: f.preview.pages[0]!.chapterId,
      page: 1,
    },
  ];
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_WARNINGS" });
  expect(save).not.toHaveBeenCalled();
  f.options.acceptWarnings = true;
  expect(await f.run()).toMatchObject({ created: true });
  f.preview.diagnostics.push({
    code: "overflow",
    chapterId: f.preview.pages[0]!.chapterId,
  });
  save.mockClear();
  await expect(f.run()).rejects.toMatchObject({ code: "PDF_EXPORT_PREFLIGHT" });
  expect(save).not.toHaveBeenCalled();
});
