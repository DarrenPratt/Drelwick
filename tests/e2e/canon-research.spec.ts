import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { copyFixture } from "../helpers/fixture-projects.js";

for (const kind of ["canon", "note"] as const) {
  test(`${kind} form supports offline keyboard CRUD, safe drafts and restart`, async () => {
    const label = kind === "canon" ? "Canon record" : "Research note";
    const prose = kind === "canon" ? "Statement" : "Body";
    const secondary =
      kind === "canon" ? "Notes" : "Source (plain-text citation)";
    test.setTimeout(120000);
    const fixture = await copyFixture("multi-chapter-book");
    const scratch = await mkdtemp(join(tmpdir(), "drelwick-location-ui-"));
    const desktop = resolve("apps/desktop");
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    const manifest = JSON.parse(
      await readFile(join(fixture.projectPath, "project.json"), "utf8"),
    ) as { projectId: string; manuscript: { order: string[] } };
    const chapters = await Promise.all(
      manifest.manuscript.order.map((id) =>
        readFile(join(fixture.projectPath, "manuscript", `${id}.json`)),
      ),
    );
    const requests: string[] = [];
    const launch = async () => {
      application = await electron.launch({
        args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
        cwd: desktop,
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
      });
      const page = await application.firstWindow();
      await expect(page).toHaveTitle("Drelwick");
      page.on("request", (request) => {
        if (/^https?:/.test(request.url())) requests.push(request.url());
      });
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
      await expect(page.locator(".ProseMirror")).toBeEditable();
      await page
        .getByRole("button", { name: "Canon & research", exact: true })
        .click();
      return page;
    };
    try {
      let page = await launch();
      const panel = page.locator(`[aria-labelledby="${kind}-bible-heading"]`);
      await expect(panel).toContainText("No records yet");
      await panel.getByLabel("Title", { exact: true }).fill("港 é 🌊");
      await panel.getByLabel("Title", { exact: true }).press("Tab");
      await expect(
        panel.getByLabel(kind === "canon" ? "Category" : "Body", {
          exact: true,
        }),
      ).toBeFocused();
      if (kind === "canon")
        await panel
          .getByLabel("Category", { exact: true })
          .selectOption("technology");
      await panel
        .getByLabel(prose, { exact: true })
        .fill("  <script>private()</script> é 🌊\n ");
      await panel
        .getByLabel(secondary, { exact: true })
        .fill("PRIVATE_CANON_RESEARCH_CANARY");
      await panel.getByRole("button", { name: "Add tag" }).click();
      await panel.getByLabel("Tag 1", { exact: true }).fill("coast, home");
      await panel
        .getByRole("button", {
          name: `Save ${label.toLowerCase()}`,
          exact: true,
        })
        .click();
      await expect(panel.getByRole("status")).toHaveText("Record saved.");
      const id = await panel.getByLabel(label, { exact: true }).inputValue();
      const file = join(
        fixture.projectPath,
        "reference",
        kind === "canon" ? "canon" : "notes",
        `${id}.json`,
      );
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        schemaVersion: 1,
        kind,
        title: "港 é 🌊",
        tags: ["coast, home"],
        ...(kind === "canon"
          ? {
              category: "technology",
              statement: "  <script>private()</script> é 🌊\n ",
              notes: "PRIVATE_CANON_RESEARCH_CANARY",
            }
          : {
              body: "  <script>private()</script> é 🌊\n ",
              source: "PRIVATE_CANON_RESEARCH_CANARY",
            }),
      });
      await expect(panel.locator("script, img, a")).toHaveCount(0);

      // An invalid draft must survive panel changes and block both project and app closure.
      await panel.getByLabel("Title", { exact: true }).fill(" ");
      await page.getByRole("button", { name: "Close tool panel" }).click();
      await expect(panel).toBeHidden();
      await page
        .getByRole("button", { name: "Canon & research", exact: true })
        .click();
      await expect(panel.getByLabel("Title", { exact: true })).toHaveValue(" ");
      await page.locator("summary").filter({ hasText: "Projects" }).click();
      await application!.evaluate(({ Menu }) => {
        const file = Menu.getApplicationMenu()!.items.find(
          (item) => item.label === "File",
        )!;
        const close = file.submenu!.items.find(
          (item) => item.label === "Close Project",
        )!;
        close.click();
      });
      await expect(page.locator(".ProseMirror")).toBeEditable();
      await expect(panel).toContainText("Unsaved changes");
      await application!.evaluate(({ app }) => app.quit());
      await expect(
        page.getByText("Unable to save changes before closing.", {
          exact: false,
        }),
      ).toBeVisible();
      await panel.getByRole("button", { name: "Discard changes" }).click();
      await expect(panel.getByLabel("Title", { exact: true })).toHaveValue(
        "港 é 🌊",
      );

      // Edit through the real form, then inspect recoverable deletion.
      await panel.getByLabel("Title", { exact: true }).fill("Updated title");
      await panel
        .getByRole("button", {
          name: `Save ${label.toLowerCase()}`,
          exact: true,
        })
        .click();
      await expect(panel.getByRole("status")).toHaveText("Record saved.");
      await panel.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(
        panel.getByRole("button", { name: `Restore ${label.toLowerCase()}` }),
      ).toBeVisible();
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        deletedAt: expect.any(String),
        title: "Updated title",
      });
      await panel
        .getByRole("button", { name: `Restore ${label.toLowerCase()}` })
        .click();
      await expect(panel.getByRole("status")).toHaveText("Record restored.");
      await application!.close();
      application = undefined;
      page = await launch();
      await expect(page.locator(`#${kind}-title`)).toHaveValue("Updated title");
      await expect(
        page.locator(kind === "canon" ? "#canon-notes" : "#note-source"),
      ).toHaveValue("PRIVATE_CANON_RESEARCH_CANARY");
      for (const [index, chapterId] of manifest.manuscript.order.entries())
        expect(
          await readFile(
            join(fixture.projectPath, "manuscript", `${chapterId}.json`),
          ),
        ).toEqual(chapters[index]);
      expect(requests).toEqual([]);
    } finally {
      await application
        ?.evaluate(({ app }) => app.exit())
        .catch(() => undefined);
      await fixture.cleanup();
      await rm(scratch, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  });
}
