import { expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  ApplicationError,
  defaultPrintSettings,
  defaultPrintEditions,
} from "@drelwick/shared";
import { readFile } from "node:fs/promises";
import type { AssembledBook } from "@drelwick/core";
import { renderPrintRevision } from "../src/main/print-render.js";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

function snapshot(): AssembledBook {
  return {
    print: {
      settings: defaultPrintSettings(),
      revision: "a".repeat(64),
      edition: "standard",
      editions: defaultPrintEditions(),
    },
    presentation: {
      schemaVersion: 1,
      projectId: "11111111-1111-4111-8111-111111111111",
      themeId: "classic",
    },
    assets: new Map(),
    book: {
      projectId: "11111111-1111-4111-8111-111111111111",
      revision: "b".repeat(64),
      title: "Test book",
      language: "en",
      assets: [],
      chapters: [
        {
          id: "11111111-1111-4111-8111-111111111112",
          title: "Chapter",
          type: "chapter",
          document: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Prose" }] },
            ],
          },
        },
      ],
    },
  };
}
async function page(blank = false) {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([432, 648]);
  if (!blank)
    sheet.drawText("Prose", {
      font: await pdf.embedFont(StandardFonts.Helvetica),
      size: 12,
      x: 70,
      y: 500,
    });
  return pdf.save();
}
it("captures settings/theme in render identity and returns the actual pipeline bytes with located measurements", async () => {
  const pdf = await page();
  const close = vi.fn();
  const render = vi.fn(async () => ({ pdf, overflow: true, clipping: true }));
  const source = snapshot();
  const before = JSON.stringify(source);
  const one = await renderPrintRevision(source, () => ({ render, close }));
  expect(close).toHaveBeenCalledOnce();
  expect(one.diagnostics.map((d) => d.code)).toEqual(["overflow", "clipping"]);
  expect(new TextDecoder().decode(one.pdf.slice(0, 5))).toBe("%PDF-");
  expect(JSON.stringify(source)).toBe(before);
  source.print!.settings.margins.gutter += 1000;
  const two = await renderPrintRevision(source, () => ({ render, close }));
  expect(two.revision).not.toBe(one.revision);
  expect(render.mock.calls.length).toBe(2);
  source.book.title = "First line\nSecond line";
  source.print!.settings.headers.showOnChapterOpening = true;
  render.mockResolvedValue({ pdf, overflow: false, clipping: false });
  const multiline = await renderPrintRevision(source, () => ({
    render,
    close,
  }));
  expect(multiline.diagnostics).toEqual([
    { code: "overflow", chapterId: source.book.chapters[0]!.id, page: 1 },
  ]);
});
it("detects unexpected blank output independently of headers and folios", async () => {
  const pdf = await page(true);
  const result = await renderPrintRevision(snapshot(), () => ({
    render: async () => ({ pdf, overflow: false, clipping: false }),
    close: vi.fn(),
  }));
  expect(result.diagnostics).toContainEqual({
    code: "unexpected-blank",
    chapterId: snapshot().book.chapters[0]!.id,
    page: 1,
  });
});
it("closes the render context on failure and time limit without returning partial PDF", async () => {
  const close = vi.fn();
  await expect(
    renderPrintRevision(snapshot(), () => ({
      close,
      render: async () => {
        throw new Error("failure");
      },
    })),
  ).rejects.toThrow("failure");
  expect(close).toHaveBeenCalledOnce();
  const hanging = vi.fn();
  await expect(
    renderPrintRevision(
      snapshot(),
      () => ({ close: hanging, render: () => new Promise(() => {}) }),
      100,
    ),
  ).rejects.toMatchObject({ code: "PRINT_TIMEOUT" });
  expect(hanging).toHaveBeenCalled();
});
it("refuses missing assets and unsupported font glyphs before opening Chromium", async () => {
  const source = snapshot();
  const factory = vi.fn();
  source.book.chapters[0]!.document.content = [
    {
      type: "image",
      attrs: {
        assetId: "11111111-1111-4111-8111-111111111113",
        alt: "Image",
        size: "full",
      },
    },
  ];
  await expect(renderPrintRevision(source, factory)).rejects.toMatchObject({
    code: "PRINT_ASSET_OR_CONTENT_INVALID",
    message: expect.stringContaining("Chapter: Chapter."),
  });
  source.book.chapters[0]!.document.content = [
    { type: "paragraph", content: [{ type: "text", text: "漢字" }] },
  ];
  await expect(renderPrintRevision(source, factory)).rejects.toMatchObject({
    code: "PRINT_UNRESOLVED_FONT",
    message: expect.stringContaining("Chapter: Chapter."),
  });
  expect(factory).not.toHaveBeenCalled();
});

it("reports missing bundled fonts and decoded resource failures without exposing underlying payloads", async () => {
  const factory = vi.fn();
  vi.mocked(readFile).mockRejectedValueOnce(new Error("private payload"));
  await expect(renderPrintRevision(snapshot(), factory)).rejects.toMatchObject({
    code: "PRINT_FONT_LOAD_FAILED",
    message: expect.stringContaining(
      "Repair the local application installation",
    ),
  });
  expect(factory).not.toHaveBeenCalled();
  for (const code of [
    "PRINT_FONT_LOAD_FAILED",
    "PRINT_ASSET_OR_CONTENT_INVALID",
  ]) {
    const close = vi.fn();
    await expect(
      renderPrintRevision(snapshot(), () => ({
        close,
        render: async () => {
          throw new ApplicationError(code, "private payload");
        },
      })),
    ).rejects.toMatchObject({
      code,
      message: expect.stringMatching(/Chapter: Chapter\.$/),
    });
    expect(close).toHaveBeenCalledOnce();
  }
});
