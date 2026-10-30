import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "../../apps/desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import {
  editorialProject,
  EDITORIAL_CANARIES,
  PUBLICATION_CONTROL,
} from "../helpers/editorial-project.js";

test("E03 actual Chromium PDF excludes private editorial text, annotations and metadata", async () => {
  test.setTimeout(45_000);
  const fixture = await editorialProject();
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
    const destination = join(scratch, "publication.pdf");
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
        const snapshot = await assembleBook(input.projectPath, { print: true });
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
      expect(publicText).toContain(PUBLICATION_CONTROL);
      for (const canary of EDITORIAL_CANARIES)
        expect(publicText + privateSurfaces).not.toContain(canary);
    } finally {
      await task.destroy();
    }
  } finally {
    await application.close();
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("local annotations support keyboard editing, saved companion undo, tombstone restore and offline reload", async () => {
  test.setTimeout(45_000);
  const fixture = await editorialProject();
  const scratch = await mkdtemp(join(tmpdir(), "editorial-ui-"));
  const desktop = resolve("apps/desktop");
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = async (profile = "profile") => {
    application = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, profile)}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await application.firstWindow();
    await page.context().setOffline(true);
    page.on("dialog", (dialog) => dialog.accept());
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(page.locator(".ProseMirror")).toBeEditable();
    return page;
  };
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const state = async () =>
    JSON.parse(await readFile(fixture.editorialPath, "utf8")) as {
      annotations: {
        id: string;
        anchorId: string;
        threadId: string;
        deletedAt: string | null;
      }[];
      anchors: {
        id: string;
        status: string;
        segments: { from: number; to: number }[];
        lost: unknown[];
      }[];
      threads: { id: string; comments: { body: string }[] }[];
    };
  try {
    let page = await launch();
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.keyboard.press(`${modifier}+Home`);
    await page.keyboard.press(`${modifier}+Shift+ArrowRight`);
    let sidebar = page.getByRole("complementary", {
      name: "Comments and annotations",
    });
    await expect(
      sidebar.getByText("Text selected for annotation.", { exact: true }),
    ).toBeVisible();
    await sidebar
      .getByRole("textbox", { name: "Comment or note", exact: true })
      .fill("Keyboard annotation");
    await sidebar
      .getByRole("button", { name: "Add annotation", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    const discussion = sidebar
      .locator("article")
      .filter({ hasText: "Keyboard annotation" });
    await expect(discussion).toBeVisible();
    const saved = await state();
    const thread = saved.threads.find((item) =>
      item.comments.some((comment) => comment.body === "Keyboard annotation"),
    )!;
    const annotation = saved.annotations.find(
      (item) => item.threadId === thread.id,
    )!;
    const original = saved.anchors.find(
      (item) => item.id === annotation.anchorId,
    )!.segments[0]!;
    await expect(editor).toBeEditable();
    await editor.click();
    await page.keyboard.press(`${modifier}+Home`);
    await page.keyboard.insertText("A ");
    await page.keyboard.press(`${modifier}+s`);
    await expect
      .poll(
        async () =>
          (await state()).anchors.find(
            (item) => item.id === annotation.anchorId,
          )!.segments[0]!.from,
      )
      .toBe(original.from + 2);
    await page.keyboard.press(`${modifier}+z`);
    await page.keyboard.press(`${modifier}+s`);
    await expect
      .poll(
        async () =>
          (await state()).anchors.find(
            (item) => item.id === annotation.anchorId,
          )!.segments[0]!.from,
      )
      .toBe(original.from);
    await page.keyboard.press(`${modifier}+z`);
    await page.keyboard.press(`${modifier}+s`);
    await expect
      .poll(async () =>
        (await state()).annotations.some((item) => item.id === annotation.id),
      )
      .toBe(false);
    await page.keyboard.press(`${modifier}+Shift+z`);
    await page.keyboard.press(`${modifier}+s`);
    await expect
      .poll(async () =>
        (await state()).annotations.some((item) => item.id === annotation.id),
      )
      .toBe(true);
    await sidebar
      .getByRole("button", { name: "Refresh annotations", exact: true })
      .click();
    await discussion
      .getByRole("button", { name: "Delete annotation", exact: true })
      .click();
    await sidebar
      .getByRole("checkbox", { name: "Show deleted annotations" })
      .check();
    const deleted = sidebar
      .locator("article")
      .filter({ hasText: "Keyboard annotation" });
    await deleted
      .getByRole("button", { name: "Restore annotation", exact: true })
      .click();
    await expect(
      discussion.getByRole("button", { name: "Go to text", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByText("Annotation changes are unsaved.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      sidebar.getByRole("button", { name: "Refresh annotations", exact: true }),
    ).toBeEnabled();
    await application!.close();
    application = undefined;
    page = await launch();
    sidebar = page.getByRole("complementary", {
      name: "Comments and annotations",
    });
    await expect(
      sidebar.getByText("Keyboard annotation", { exact: true }),
    ).toBeVisible();
    expect(
      (await state()).annotations.find((item) => item.id === annotation.id)!
        .deletedAt,
    ).toBeNull();
  } finally {
    if (application) {
      const closed = application
        .waitForEvent("close", { timeout: 5000 })
        .catch(() => {
          application?.process().kill("SIGKILL");
        });
      await application
        .evaluate(({ app }) => {
          setTimeout(() => app.exit(0), 0);
        })
        .catch(() => undefined);
      await closed;
    }
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("orphaned discussions remain editable after deleting the last chapter", async () => {
  const { deleteChapter } = await import("../../packages/core/src/index.js");
  const fixture = await editorialProject();
  const scratch = await mkdtemp(join(tmpdir(), "editorial-orphans-"));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await deleteChapter({
      projectPath: fixture.projectPath,
      chapterId: fixture.chapterId,
    });
    const desktop = resolve("apps/desktop");
    application = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await application.firstWindow();
    await page.context().setOffline(true);
    page.on("dialog", (dialog) => dialog.accept());
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your story starts here." }),
    ).toBeVisible();
    const sidebar = page.getByRole("complementary", {
      name: "Comments and annotations",
    });
    const note = sidebar
      .locator("article")
      .filter({ hasText: "PRIVATE_NOTE_CANARY" });
    await expect(note).toBeVisible();
    await expect(
      note.getByRole("button", { name: "Reattach to selected text" }),
    ).toBeDisabled();
    await note.getByRole("button", { name: "Resolve", exact: true }).click();
    await sidebar
      .getByLabel("Discussion state", { exact: true })
      .selectOption("all");
    await expect(
      note.getByRole("button", { name: "Reopen", exact: true }),
    ).toBeVisible();
    await note
      .getByRole("button", { name: "Delete annotation", exact: true })
      .click();
    await sidebar.getByLabel("Show deleted annotations").check();
    await sidebar
      .locator("article")
      .filter({ hasText: "PRIVATE_NOTE_CANARY" })
      .getByRole("button", { name: "Restore annotation" })
      .click();
    await expect(
      note.getByRole("button", { name: "Reopen", exact: true }),
    ).toBeVisible();
  } finally {
    if (application) {
      const closed = application
        .waitForEvent("close", { timeout: 5000 })
        .catch(() => {
          application?.process().kill("SIGKILL");
        });
      await application
        .evaluate(({ app }) => {
          setTimeout(() => app.exit(0), 0);
        })
        .catch(() => undefined);
      await closed;
    }
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("interrupted annotation drafts offer preview, cancel and explicit coherent recovery", async () => {
  const {
    commitEditorialTransaction,
    recoverEditorialTransactions,
    openProject,
  } = await import("../../packages/core/src/index.js");
  const fixture = await editorialProject();
  const scratch = await mkdtemp(join(tmpdir(), "editorial-recovery-ui-"));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const source = await openProject(fixture.projectPath);
    if (source.project.schemaVersion !== 3)
      throw new Error("Expected editorial project");
    const state = JSON.parse(await readFile(fixture.editorialPath, "utf8"));
    const created = new Date().toISOString();
    state.generation++;
    state.threads[0].modified = created;
    state.threads[0].comments.push({
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000000081",
      body: "Recovered discussion draft",
      authorLabel: null,
      created,
      modified: created,
      deletedAt: null,
    });
    try {
      await commitEditorialTransaction({
        projectPath: fixture.projectPath,
        projectId: source.project.projectId,
        kind: "annotation",
        expectedGeneration: source.project.generation,
        editorGeneration: 7,
        changes: [
          {
            path: "editorial/state.json",
            after: Buffer.from(`${JSON.stringify(state, null, 2)}\n`),
          },
          {
            path: "project.json",
            after: Buffer.from(
              `${JSON.stringify({ ...source.project, modified: created, generation: source.project.generation + 1 }, null, 2)}\n`,
            ),
          },
        ],
        checkpoint: async (point) => {
          if (point === "prepared") throw new Error("Interrupted save");
        },
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Interrupted save")
        throw error;
    }
    await recoverEditorialTransactions(fixture.projectPath);
    const desktop = resolve("apps/desktop");
    application = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    const sidebar = page.getByRole("complementary", {
      name: "Comments and annotations",
    });
    const offer = sidebar.getByRole("button", {
      name: /^Preview draft from saved version/,
    });
    await offer.click();
    const preview = sidebar.getByRole("region", {
      name: "Draft preview",
      exact: true,
    });
    await expect(
      preview.getByText("Recovered discussion draft", { exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Cancel draft preview", exact: true })
      .click();
    expect(
      JSON.parse(await readFile(fixture.editorialPath, "utf8")).generation,
    ).toBe(source.project.generation);
    await offer.click();
    await expect(
      preview.getByRole("button", { name: "Recover draft", exact: true }),
    ).toBeEnabled();
    page.once("dialog", (dialog) => dialog.accept());
    await preview
      .getByRole("button", { name: "Recover draft", exact: true })
      .click();
    await expect(
      sidebar.getByText("Recovered discussion draft", { exact: true }),
    ).toBeVisible();
    await expect(offer).toHaveCount(0);
    expect(
      JSON.parse(await readFile(fixture.editorialPath, "utf8")).generation,
    ).toBe(source.project.generation + 1);
  } finally {
    if (application) {
      const closed = application
        .waitForEvent("close", { timeout: 5000 })
        .catch(() => {
          application?.process().kill("SIGKILL");
        });
      await application
        .evaluate(({ app }) => {
          setTimeout(() => app.exit(0), 0);
        })
        .catch(() => undefined);
      await closed;
    }
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
