import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  editorialProject,
  EDITORIAL_CANARIES,
} from "../helpers/editorial-project.js";
import {
  captureNamedSnapshot,
  listManuscriptSnapshots,
} from "../../packages/core/src/index.js";
import { randomUUID as createUuid } from "node:crypto";

test("C01/C02 native offline comparison flushes current, labels projections, navigates and leaves saved sources unchanged", async () => {
  test.setTimeout(90_000);
  const fixture = await editorialProject(),
    scratch = await mkdtemp(join(tmpdir(), "drelwick-comparison-ui-"));
  const projectId = JSON.parse(
    await readFile(join(fixture.projectPath, "project.json"), "utf8"),
  ).projectId as string;
  const snapshot = await captureNamedSnapshot({
    projectPath: fixture.projectPath,
    projectId,
    operationId: createUuid(),
    expected: (await listManuscriptSnapshots(fixture.projectPath, projectId))
      .source,
    label: "Before revision",
  });
  const desktop = resolve("apps/desktop");
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await application.firstWindow();
    page.on("dialog", (dialog) => void dialog.accept());
    await page.context().setOffline(true);
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();
    await editor.fill("Current 👩‍💻 revision with é.");
    await page
      .getByRole("button", { name: "Manuscript snapshots", exact: true })
      .click();
    const panel = page.getByRole("dialog", {
      name: "Manuscript snapshots",
      exact: true,
    });
    const compare = panel.getByRole("region", {
      name: "Compare manuscript revisions",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(compare).toBeVisible({ timeout: 5000 });
    await compare
      .getByLabel("Before version", { exact: true })
      .selectOption(snapshot.snapshotId);
    await compare
      .getByLabel("Before projection", { exact: true })
      .selectOption("accepted");
    await compare
      .getByRole("button", { name: "Compare versions", exact: true })
      .click();
    await expect(
      compare.getByRole("status").filter({ hasText: "Comparison complete." }),
    ).toBeVisible();
    await expect(compare).toContainText("Captured saved current manuscript");
    await expect(compare).toContainText("accepted");
    const chapterPath = join(
      fixture.projectPath,
      "manuscript",
      `${fixture.chapterId}.json`,
    );
    const saved = await readFile(chapterPath);
    expect(saved.toString()).toContain("Current 👩‍💻 revision");
    for (const canary of EDITORIAL_CANARIES)
      await expect(compare).not.toContainText(canary);
    const next = compare.getByRole("button", {
      name: "Next change",
      exact: true,
    });
    if (await next.isEnabled()) {
      await next.focus();
      await page.keyboard.press("Enter");
      await expect(compare.getByRole("article")).toBeFocused();
    }
    await panel.screenshot({
      path: test.info().outputPath("manuscript-comparison.png"),
    });
    await compare
      .getByLabel("After version", { exact: true })
      .selectOption(snapshot.snapshotId);
    await compare
      .getByRole("button", { name: "Compare versions", exact: true })
      .click();
    await expect(
      compare.getByText("0 changes. Comparison complete.", { exact: true }),
    ).toBeVisible();
    expect(await readFile(chapterPath)).toEqual(saved);
    const immutablePath = join(
      fixture.projectPath,
      "snapshots/manuscript",
      snapshot.snapshotId,
      "snapshot.json",
    );
    const immutable = await readFile(immutablePath);
    await compare
      .getByRole("button", { name: "Compare versions", exact: true })
      .click();
    await expect(
      compare.getByText("0 changes. Comparison complete.", { exact: true }),
    ).toBeVisible();
    expect(await readFile(immutablePath)).toEqual(immutable);
    await panel
      .getByRole("button", { name: "Close manuscript snapshots", exact: true })
      .click();
    await expect(editor).toContainText("Current 👩‍💻 revision with é.");
  } finally {
    await application
      ?.evaluate(({ app }) => app.exit(0))
      .catch(() => undefined);
    await application?.close().catch(() => undefined);
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
