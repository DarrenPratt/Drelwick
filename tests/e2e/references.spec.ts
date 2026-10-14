import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type {
  ReferenceInput,
  ReferenceSaved,
} from "../../packages/shared/src/reference-contracts.js";
import { copyFixture } from "../helpers/fixture-projects.js";

test("restricted story bible persistence survives restart and backup offline and stays out of EPUB DOCX PDF", async () => {
  test.setTimeout(120000);
  const fixture = await copyFixture("multi-chapter-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-reference-e2e-"));
  const desktop = resolve("apps/desktop");
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = async () => {
    application = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("Drelwick");
    await page.context().setOffline(true);
    await application.evaluate(({ dialog, session }, projectPath) => {
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*"] },
        (_details, callback) => callback({ cancel: true }),
      );
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [projectPath],
      });
    }, fixture.projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(page.locator(".ProseMirror")).toBeEditable();
    return page;
  };
  try {
    let page = await launch();
    const requests: string[] = [];
    page.on("request", (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url());
    });
    const manifest = JSON.parse(
      await readFile(join(fixture.projectPath, "project.json"), "utf8"),
    ) as { projectId: string; manuscript: { order: string[] } };
    const projectId = manifest.projectId;
    const saved = await page.evaluate(
      async ({ projectId, chapterId }) => {
        const common = { tags: ["PRIVATE_STORY_BIBLE_CANARY"], links: [] };
        const contents: ReferenceInput[] = [
          { ...common, kind: "character", name: "Mira", aliases: [] },
          { ...common, kind: "location", name: "Harbour" },
          {
            ...common,
            kind: "canon",
            title: "Tides",
            category: "other",
            statement: "PRIVATE_STORY_BIBLE_CANARY",
          },
          {
            ...common,
            kind: "timeline",
            title: "Departure",
            date: "Second tide",
          },
          {
            ...common,
            kind: "note",
            title: "Research",
            body: "PRIVATE_STORY_BIBLE_CANARY",
            links: [{ target: { kind: "chapter", id: chapterId } }],
          },
        ];
        const records: ReferenceSaved[] = [];
        for (const content of contents) {
          const result = await window.drelwick.references.execute({
            operation: "create",
            projectId,
            content,
            generation: 1,
          });
          if (!result.ok || result.value.type !== "record")
            throw new Error(JSON.stringify(result));
          records.push(result.value.value);
        }
        return records;
      },
      { projectId, chapterId: manifest.manuscript.order[0]! },
    );
    expect(saved).toHaveLength(5);
    expect(
      await page.evaluate(() => ({
        require: typeof (globalThis as unknown as { require?: unknown })
          .require,
        process: typeof (globalThis as unknown as { process?: unknown })
          .process,
      })),
    ).toEqual({ require: "undefined", process: "undefined" });
    const deleted = await page.evaluate(
      async ({ projectId, value }) =>
        window.drelwick.references.execute({
          operation: "delete",
          projectId,
          kind: value.record.kind,
          id: value.record.id,
          expectedRevision: value.record.revision,
          expectedFingerprint: value.fingerprint,
          generation: 2,
        }),
      { projectId, value: saved[0]! },
    );
    expect(deleted).toMatchObject({
      ok: true,
      value: {
        type: "record",
        value: { record: { deletedAt: expect.any(String) } },
      },
    });

    const destination = async (filePath: string) =>
      application!.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: path,
        });
        dialog.showMessageBox = async () => ({
          response: 0,
          checkboxChecked: false,
        });
      }, filePath);
    await destination(join(scratch, "backup.drelwick.zip"));
    expect(
      await page.evaluate(() =>
        window.drelwick.project.backup({ includeHistory: false }),
      ),
    ).toMatchObject({ ok: true, value: { created: true } });
    const require = createRequire(resolve("packages/core/package.json"));
    const { unzipSync } = require("fflate") as {
      unzipSync(data: Uint8Array): Record<string, Uint8Array>;
    };
    const archive = unzipSync(
      await readFile(join(scratch, "backup.drelwick.zip")),
    );
    expect(
      Object.keys(archive).some((p) => p.startsWith("reference/history/")),
    ).toBe(true);
    expect(
      Object.keys(archive).some((p) => p.startsWith("reference/recovery/")),
    ).toBe(true);
    for (const format of ["epub", "docx"] as const) {
      const target = join(scratch, `book.${format}`);
      await destination(target);
      const result = await page.evaluate(
        async ({ projectId, format }) =>
          format === "epub"
            ? await window.drelwick.project.exportEpub({ projectId })
            : await window.drelwick.project.exportDocx({ projectId }),
        { projectId, format },
      );
      expect(result).toMatchObject({ ok: true, value: { created: true } });
      const files = unzipSync(await readFile(target));
      expect(Object.keys(files).some((p) => p.startsWith("reference/"))).toBe(
        false,
      );
      expect(
        Object.values(files)
          .map((b) => Buffer.from(b).toString())
          .join("\n"),
      ).not.toContain("PRIVATE_STORY_BIBLE_CANARY");
    }
    const preview = await page.evaluate(
      (projectId) => window.drelwick.project.previewPrint({ projectId }),
      projectId,
    );
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    await destination(join(scratch, "book.pdf"));
    expect(
      await page.evaluate(
        ({ projectId, revision }) =>
          window.drelwick.project.exportPrint({
            projectId,
            revision,
            acceptWarnings: true,
          }),
        { projectId, revision: preview.value.revision },
      ),
    ).toMatchObject({ ok: true, value: { created: true } });
    const { getDocument } =
      await import("../../apps/desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: Uint8Array.from(await readFile(join(scratch, "book.pdf"))),
      useSystemFonts: false,
      isEvalSupported: false,
    });
    try {
      const pdf = await task.promise;
      let text = JSON.stringify(await pdf.getMetadata());
      for (let index = 1; index <= pdf.numPages; index++)
        text += JSON.stringify(
          await (await pdf.getPage(index)).getTextContent(),
        );
      expect(text).not.toContain("PRIVATE_STORY_BIBLE_CANARY");
      expect(text).toContain("A deterministic beginning comes first.");
    } finally {
      await task.destroy();
    }
    expect(requests).toEqual([]);
    await application!.close();
    application = undefined;
    page = await launch();
    expect(
      await page.evaluate(
        (projectId) =>
          window.drelwick.references.execute({
            operation: "list",
            projectId,
            includeDeleted: true,
          }),
        projectId,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        type: "list",
        readOnly: false,
        records: expect.arrayContaining([
          expect.objectContaining({
            id: saved[0]!.record.id,
            deletedAt: expect.any(String),
          }),
        ]),
      },
    });
  } finally {
    await application?.close();
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
