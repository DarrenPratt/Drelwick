import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "../../apps/desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import {
  revisionProject,
  ACCEPTED_CONTROL,
  PROPOSED_CONTROL,
  REVISION_PRIVATE,
} from "../helpers/revision-project.js";
import { EDITORIAL_CANARIES } from "../helpers/editorial-project.js";
test("E01-E03 actual Chromium PDF selects accepted/proposed text and excludes revision evidence", async () => {
  test.setTimeout(45_000);
  const fixture = await revisionProject();
  const scratch = await mkdtemp(join(tmpdir(), "editorial-pdf-"));
  const bootstrap = join(scratch, "bootstrap.cjs");
  await writeFile(
    bootstrap,
    `globalThis.editorialImport = url => import(url); const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>new BrowserWindow({show:false}));`,
  );
  const application = await electron.launch({
    args: [bootstrap, `--user-data-dir=${join(scratch, "profile")}`],
    cwd: resolve("apps/desktop"),
  });
  try {
    for (const projection of ["accepted", "proposed"] as const) {
      const destination = join(scratch, `${projection}.pdf`);
      await application.evaluate(
        async (_electron, input) => {
          const load = (
            globalThis as unknown as {
              editorialImport(url: string): Promise<unknown>;
            }
          ).editorialImport;
          const { assembleBook } = (await load(
            input.core,
          )) as typeof import("../../packages/core/src/index.js");
          const { renderPrintRevision } = (await load(
            input.renderer,
          )) as typeof import("../../apps/desktop/src/main/print-render.js");
          const { createPrintSurface } = (await load(
            input.surface,
          )) as typeof import("../../apps/desktop/src/main/print-surface.js");
          const { writeFile } = (await load(
            "node:fs/promises",
          )) as typeof import("node:fs/promises");
          const snapshot = await assembleBook(input.projectPath, {
            print: true,
            projection: input.projection,
          });
          const result = await renderPrintRevision(snapshot, () =>
            createPrintSurface(),
          );
          await writeFile(input.destination, result.pdf);
        },
        {
          core: pathToFileURL(resolve("packages/core/dist/index.js")).href,
          renderer: pathToFileURL(
            resolve("apps/desktop/dist/main/print-render.js"),
          ).href,
          surface: pathToFileURL(
            resolve("apps/desktop/dist/main/print-surface.js"),
          ).href,
          projectPath: fixture.projectPath,
          destination,
          projection,
        },
      );
      const task = getDocument({
        data: new Uint8Array(await readFile(destination)),
        useSystemFonts: true,
      });
      try {
        const pdf = await task.promise;
        let publicText = "";
        let privateSurfaces = JSON.stringify({
          metadata: await pdf.getMetadata(),
          attachments: await pdf.getAttachments(),
          outline: await pdf.getOutline(),
        });
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          publicText += content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          privateSurfaces += JSON.stringify(await page.getAnnotations());
        }
        expect(publicText).toContain(
          projection === "accepted" ? ACCEPTED_CONTROL : PROPOSED_CONTROL,
        );
        expect(publicText).not.toContain(
          projection === "accepted" ? PROPOSED_CONTROL : ACCEPTED_CONTROL,
        );
        for (const canary of [
          ...EDITORIAL_CANARIES,
          REVISION_PRIVATE,
          ...fixture.view.state.review.pending.map((g) => g.id),
        ])
          expect(publicText + privateSurfaces).not.toContain(canary);
      } finally {
        await task.destroy();
      }
    }
  } finally {
    await application.close();
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
