import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  editorialProject,
  PUBLICATION_CONTROL,
} from "../helpers/editorial-project.js";

test("S01/S03 native snapshots flush unsaved discussions, restore safely, recover deletion and reopen offline", async () => {
  test.setTimeout(90_000);
  const fixture = await editorialProject();
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-snapshot-ui-"));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = async () => {
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
    await expect(page.locator(".ProseMirror")).toBeEditable();
    return page;
  };
  try {
    let page = await launch();
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.locator(".ProseMirror").click();
    await page.keyboard.press(`${modifier}+Home`);
    await page.keyboard.press(`${modifier}+Shift+ArrowRight`);
    const sidebar = page.getByRole("complementary", {
      name: "Comments and annotations",
    });
    await expect(
      sidebar.getByText("Text selected for annotation.", { exact: true }),
    ).toBeVisible();
    await sidebar
      .getByRole("textbox", { name: "Comment or note", exact: true })
      .fill("Unsaved snapshot discussion");
    await page
      .getByRole("button", { name: "Manuscript snapshots", exact: true })
      .click();
    const panel = page.getByRole("dialog", {
      name: "Manuscript snapshots",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await panel
      .getByRole("textbox", { name: "Snapshot name" })
      .fill("Native checkpoint");
    await panel
      .getByRole("button", { name: "Capture named snapshot", exact: true })
      .click();
    await expect(
      panel.getByText("Named manuscript snapshot saved.", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Inspect Native checkpoint", exact: true })
      .click();
    await panel.getByText("Saved discussions", { exact: true }).click();
    await expect(
      panel.locator("pre").filter({ hasText: "Unsaved snapshot discussion" }),
    ).toBeVisible();
    const before = JSON.parse(await readFile(fixture.editorialPath, "utf8"));
    expect(JSON.stringify(before)).toContain("Unsaved snapshot discussion");
    await panel
      .getByRole("button", { name: "Close manuscript snapshots", exact: true })
      .click();
    await page
      .locator(".ProseMirror")
      .fill("Current manuscript before restore");
    await page
      .getByRole("button", { name: "Manuscript snapshots", exact: true })
      .click();
    await panel
      .getByRole("button", {
        name: "Preview restore Native checkpoint",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("region", { name: "Restore preview" }),
    ).toBeVisible();
    await panel.screenshot({
      path: test.info().outputPath("manuscript-snapshot-preview.png"),
    });
    await panel
      .getByRole("button", {
        name: "Restore selected manuscript snapshot",
        exact: true,
      })
      .click();
    await expect(
      panel.getByText(
        "Manuscript restored. The before-restore safety snapshot preserves the previous manuscript.",
        { exact: true },
      ),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Delete Native checkpoint", exact: true })
      .click();
    await panel.getByLabel("Deleted snapshots", { exact: true }).check();
    await expect(
      panel.getByRole("button", {
        name: "Undelete Native checkpoint",
        exact: true,
      }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Undelete Native checkpoint", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Close manuscript snapshots", exact: true })
      .click();
    await expect(page.locator(".ProseMirror")).toContainText(
      PUBLICATION_CONTROL,
    );
    await application!.close();
    application = undefined;
    page = await launch();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "unresolved restore conflicts" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Manuscript snapshots", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Inspect Native checkpoint",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close manuscript snapshots", exact: true })
      .click();
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

test("failed pending-discussion flush preserves the visible draft and never opens a capture dialog", async () => {
  test.setTimeout(45_000);
  const fixture = await editorialProject(),
    scratch = await mkdtemp(join(tmpdir(), "snapshot-flush-failure-"));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const blocker = join(
    fixture.projectPath,
    ".editorial/transactions/00000000-0000-4000-8000-000000000099",
  );
  try {
    const desktop = resolve("apps/desktop");
    application = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
    });
    const page = await application.firstWindow();
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
    await expect(page.locator(".ProseMirror")).toBeEditable();
    await page.locator(".ProseMirror").click();
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+Home`);
    await page.keyboard.press(`${modifier}+Shift+ArrowRight`);
    const sidebar = page.getByRole("complementary", {
      name: "Comments and annotations",
    });
    await expect(
      sidebar.getByText("Text selected for annotation.", { exact: true }),
    ).toBeVisible();
    const draft = sidebar.getByRole("textbox", {
      name: "Comment or note",
      exact: true,
    });
    await draft.fill("Draft remains visible after failed capture flush");
    const before = await readFile(fixture.editorialPath);
    await mkdir(blocker);
    await page
      .getByRole("button", { name: "Manuscript snapshots", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Snapshot capture was cancelled" }),
    ).toBeVisible();
    await expect(draft).toHaveValue(
      "Draft remains visible after failed capture flush",
    );
    await expect(
      page.getByRole("dialog", { name: "Manuscript snapshots", exact: true }),
    ).toHaveCount(0);
    expect(await readFile(fixture.editorialPath)).toEqual(before);
    // Remove only this test's empty synthetic blocker; no project recovery image is deleted.
    await rm(blocker, { recursive: true, force: true });
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
