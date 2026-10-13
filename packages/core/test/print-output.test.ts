import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { readFile, readdir, writeFile, mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import {
  inspectExportDestination,
  writeExportAtomically,
  printPreflight,
  printSourceRevision,
  assembleBook,
} from "../src/index.js";
import { defaultPrintSettings, type PrintPreview } from "@drelwick/shared";

const copies: FixtureCopy[] = [];
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    link: vi.fn(actual.link),
    unlink: vi.fn(actual.unlink),
  };
});
afterEach(async () => {
  vi.mocked(fs.open).mockRestore();
  vi.mocked(fs.rename).mockRestore();
  vi.mocked(fs.link).mockRestore();
  vi.mocked(fs.unlink).mockRestore();
  await Promise.all(copies.splice(0).map((c) => c.cleanup()));
});

it.each(["write", "sync", "rename", "link"] as const)(
  "preserves source and destination after an actual %s operation fails",
  async (phase) => {
    const c = await fixture();
    const path = join(dirname(c.projectPath), "fault.pdf");
    const sourcePath = join(c.projectPath, "project.json");
    const source = await readFile(sourcePath);
    if (phase !== "link") await writeFile(path, "previous PDF");
    const destination = await inspectExportDestination(
      path,
      c.projectPath,
      "pdf",
    );
    const fault = Object.assign(
      new Error("private manuscript text must not escape"),
      { code: phase === "write" ? "ENOSPC" : "EIO" },
    );
    if (phase === "write" || phase === "sync") {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
        const handle = await actual.open(...args);
        if (phase === "write")
          vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => {
            await handle.write(Buffer.from("partial"));
            throw fault;
          });
        else vi.spyOn(handle, "sync").mockRejectedValueOnce(fault);
        return handle;
      });
    } else vi.mocked(fs[phase]).mockRejectedValueOnce(fault);
    await expect(
      writeExportAtomically(destination, Buffer.from("replacement"), {
        format: "pdf",
        overwrite: true,
      }),
    ).rejects.toMatchObject({
      code: "PDF_EXPORT_WRITE",
      message:
        "Unable to write export. Check permissions and disk space. The previous destination and project were preserved.",
    });
    if (phase === "link")
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    else expect(await readFile(path, "utf8")).toBe("previous PDF");
    expect(await readFile(sourcePath)).toEqual(source);
    expect(
      (await readdir(dirname(path))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  },
);

it("reports cleanup failure after publication without claiming the export failed", async () => {
  const c = await fixture();
  const path = join(dirname(c.projectPath), "cleanup.pdf");
  const destination = await inspectExportDestination(
    path,
    c.projectPath,
    "pdf",
  );
  vi.mocked(fs.unlink).mockRejectedValueOnce(
    Object.assign(new Error("locked"), { code: "EPERM" }),
  );
  await expect(
    writeExportAtomically(destination, Buffer.from("complete"), {
      format: "pdf",
      overwrite: false,
    }),
  ).resolves.toEqual({ cleanupWarning: true });
  expect(await readFile(path, "utf8")).toBe("complete");
});
async function fixture() {
  const c = await copyFixture("minimal-book");
  copies.push(c);
  return c;
}

it("preserves existing PDFs on failed validation/write, overwrite rejection, cancellation and destination races", async () => {
  const c = await fixture();
  const path = join(dirname(c.projectPath), "proof.pdf");
  const bytes = Buffer.from("synthetic validated output");
  await writeFile(path, "previous valid PDF");
  const destination = await inspectExportDestination(
    path,
    c.projectPath,
    "pdf",
  );
  const unchanged = async () => {
    expect(await readFile(path, "utf8")).toBe("previous valid PDF");
    expect(
      (await readdir(dirname(path))).filter((p) => p.endsWith(".tmp")),
    ).toEqual([]);
  };
  await expect(
    writeExportAtomically(destination, bytes, {
      format: "pdf",
      overwrite: false,
    }),
  ).rejects.toMatchObject({ code: "PDF_EXPORT_OVERWRITE" });
  await unchanged();
  for (const phase of ["written", "commit"] as const) {
    await expect(
      writeExportAtomically(destination, bytes, {
        format: "pdf",
        overwrite: true,
        checkpoint: async (p) => {
          if (p === phase) throw new Error("disk failure");
        },
      }),
    ).rejects.toMatchObject({ code: "PDF_EXPORT_WRITE" });
    await unchanged();
    const abort = new AbortController();
    await expect(
      writeExportAtomically(destination, bytes, {
        format: "pdf",
        overwrite: true,
        signal: abort.signal,
        checkpoint: async (p) => {
          if (p === phase) abort.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "PDF_EXPORT_CANCELLED" });
    await unchanged();
  }
  await expect(
    writeExportAtomically(destination, bytes, {
      format: "pdf",
      overwrite: true,
      validate: async () => {
        throw new Error("invalid PDF");
      },
    }),
  ).rejects.toMatchObject({ code: "PDF_EXPORT_WRITE" });
  await unchanged();
  await writeFile(path, "externally changed");
  await expect(
    writeExportAtomically(destination, bytes, {
      format: "pdf",
      overwrite: true,
    }),
  ).rejects.toMatchObject({ code: "PDF_EXPORT_CHANGED" });
  expect(await readFile(path, "utf8")).toBe("externally changed");
  const fresh = await inspectExportDestination(path, c.projectPath, "pdf");
  let inspected = false;
  await writeExportAtomically(fresh, bytes, {
    format: "pdf",
    overwrite: true,
    validate: async (staged) => {
      expect(Buffer.from(staged)).toEqual(bytes);
      inspected = true;
    },
  });
  expect(inspected).toBe(true);
  expect(await readFile(path)).toEqual(bytes);
});

it("publishes new PDFs without clobbering concurrent files and rejects unsafe destinations", async () => {
  const c = await fixture();
  const parent = dirname(c.projectPath);
  const path = join(parent, "new.pdf");
  const selected = await inspectExportDestination(path, c.projectPath, "pdf");
  await expect(
    writeExportAtomically(selected, Buffer.from("new"), {
      format: "pdf",
      overwrite: false,
      checkpoint: async (phase) => {
        if (phase === "commit") await writeFile(path, "concurrent");
      },
    }),
  ).rejects.toMatchObject({ code: "PDF_EXPORT_CHANGED" });
  expect(await readFile(path, "utf8")).toBe("concurrent");
  await writeExportAtomically(
    await inspectExportDestination(
      join(parent, "safe.pdf"),
      c.projectPath,
      "pdf",
    ),
    Buffer.from("new"),
    { format: "pdf", overwrite: false },
  );
  expect(await readFile(join(parent, "safe.pdf"), "utf8")).toBe("new");
  const other = join(parent, "other");
  await mkdir(other);
  await writeFile(join(other, "project.json"), "{}");
  const linked = join(parent, "linked");
  await symlink(c.projectPath, linked, "junction");
  for (const invalid of [
    "relative.pdf",
    join(c.projectPath, "book.pdf"),
    join(other, "book.pdf"),
    join(linked, "book.pdf"),
    join(parent, "book.txt"),
    join(parent, "con.pdf"),
    join(parent, "book.pdf:stream"),
  ]) {
    await expect(
      inspectExportDestination(invalid, c.projectPath, "pdf"),
    ).rejects.toMatchObject({ code: "PDF_EXPORT_DESTINATION" });
  }
});

it("classifies measurable findings and invalid geometry; source identity covers settings and themes", async () => {
  const c = await fixture();
  const book = await assembleBook(c.projectPath, { print: true });
  const revision = printSourceRevision(book);
  book.print!.settings.margins.gutter++;
  expect(printSourceRevision(book)).not.toBe(revision);
  book.print!.settings.margins.gutter--;
  book.presentation.themeId = "modern";
  expect(printSourceRevision(book)).toBe(revision);
  book.print!.editions.standard.themeId = "modern";
  expect(printSourceRevision(book)).not.toBe(revision);
  const preview: PrintPreview = {
    revision,
    pdf: new Uint8Array(),
    pages: [],
    diagnostics: [
      { code: "overflow", chapterId: "chapter", page: 2 },
      { code: "clipping", chapterId: "chapter", page: 3 },
      { code: "unexpected-blank", chapterId: "chapter", page: 4 },
      { code: "unresolved-asset", chapterId: "chapter" },
      { code: "unresolved-font", chapterId: "chapter" },
    ],
    export: {
      sourceRevision: revision,
      settings: defaultPrintSettings(),
      title: "Book",
      author: "Author",
      language: "en",
      chapters: [],
      findings: [],
    },
  };
  preview.export!.settings.margins.inside = 100000;
  const findings = printPreflight(preview);
  expect(
    findings.filter((f) => f.severity === "error").map((f) => f.code),
  ).toEqual([
    "page-count",
    "invalid-settings",
    "overflow",
    "clipping",
    "unresolved-asset",
    "unresolved-font",
  ]);
  expect(findings.find((f) => f.severity === "warning")).toMatchObject({
    code: "unexpected-blank",
    page: 4,
    chapterId: "chapter",
  });
});

it("reviews binding space using the current edition's actual page count and margins", () => {
  const preview: PrintPreview = {
    revision: "a".repeat(64),
    pdf: new Uint8Array(),
    diagnostics: [],
    pages: Array.from({ length: 300 }, () => ({
      chapterId: "chapter",
      side: "recto",
      blank: false,
      folio: "1",
    })),
    export: {
      edition: "large-print",
      sourceRevision: "b".repeat(64),
      settings: defaultPrintSettings(),
      title: "Book",
      author: "Author",
      language: "en",
      chapters: [],
      findings: [],
    },
  };
  expect(printPreflight(preview)).toEqual([]);
  preview.pages.push(preview.pages[0]!);
  expect(printPreflight(preview)).toMatchObject([
    { code: "binding-space-review", severity: "warning", setting: "margins" },
  ]);
  preview.export!.settings.margins.gutter = 6350;
  expect(printPreflight(preview)).toEqual([]);
  preview.export!.settings.margins.inside = 100000;
  expect(
    printPreflight(preview).some(
      (f) => f.code === "invalid-settings" && f.severity === "error",
    ),
  ).toBe(true);
});
