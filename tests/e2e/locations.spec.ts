import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { copyFixture } from "../helpers/fixture-projects.js";

test("location form preserves drafts, saves offline, restores deletion and reopens without changing manuscript", async () => {
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
    await page.getByRole("button", { name: "Locations", exact: true }).click();
    return page;
  };
  try {
    let page = await launch();
    const panel = page.locator('[aria-labelledby="location-bible-heading"]');
    await expect(panel).toContainText("No locations yet");
    await panel.getByLabel("Name", { exact: true }).fill("港 é 🌊");
    await panel.getByLabel("Name", { exact: true }).press("Tab");
    await expect(panel.getByLabel("Type", { exact: true })).toBeFocused();
    await page.keyboard.type("Harbour");
    await panel
      .getByLabel("Description", { exact: true })
      .fill("  A sheltered port.\n ");
    await panel
      .getByLabel("Notes", { exact: true })
      .fill("PRIVATE_LOCATION_UI_CANARY");
    await panel.getByRole("button", { name: "Add tag" }).click();
    await panel.getByLabel("Tag 1", { exact: true }).fill("coast, home");
    await panel
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(panel.getByRole("status")).toHaveText("Location saved.");
    const id = await panel.getByLabel("Location", { exact: true }).inputValue();
    const file = join(
      fixture.projectPath,
      "reference",
      "locations",
      `${id}.json`,
    );
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      name: "港 é 🌊",
      type: "Harbour",
      description: "  A sheltered port.\n ",
      tags: ["coast, home"],
      notes: "PRIVATE_LOCATION_UI_CANARY",
    });

    // An invalid draft must survive panel changes and block both project and app closure.
    await panel.getByLabel("Name", { exact: true }).fill(" ");
    await page.getByRole("button", { name: "Close tool panel" }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Locations", exact: true }).click();
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue(" ");
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
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue(
      "港 é 🌊",
    );

    // A second writer uses the real service so history and revisions remain valid.
    await page.evaluate(
      async ({ projectId, id }) => {
        const result = await window.drelwick.references.execute({
          operation: "read",
          projectId,
          kind: "location",
          id,
        });
        if (
          !result.ok ||
          result.value.type !== "record" ||
          result.value.value.record.kind !== "location"
        )
          throw new Error("Unable to read test location");
        const { record, fingerprint } = result.value.value;
        const updated = await window.drelwick.references.execute({
          operation: "update",
          projectId,
          kind: "location",
          id,
          expectedRevision: record.revision,
          expectedFingerprint: fingerprint,
          generation: 100,
          content: {
            kind: "location",
            name: "External name",
            description: record.description,
            notes: record.notes,
            type: record.kind === "location" ? record.type : undefined,
            tags: record.tags,
            links: record.links,
          },
        });
        if (!updated.ok) throw new Error("Unable to update test location");
      },
      { projectId: manifest.projectId, id },
    );
    await panel.getByLabel("Name", { exact: true }).fill("Retain stale draft");
    await panel
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue(
      "Retain stale draft",
    );
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      name: "External name",
    });
    await panel.getByRole("button", { name: "Discard changes" }).click();
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue(
      "External name",
    );
    await panel.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Restore location" }),
    ).toBeVisible();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      deletedAt: expect.any(String),
      notes: "PRIVATE_LOCATION_UI_CANARY",
    });
    await panel.getByRole("button", { name: "Restore location" }).click();
    await expect(panel.getByRole("status")).toHaveText("Location restored.");
    await application!.close();
    application = undefined;
    page = await launch();
    await expect(page.locator("#location-name")).toHaveValue("External name");
    await expect(page.locator("#location-notes")).toHaveValue(
      "PRIVATE_LOCATION_UI_CANARY",
    );
    for (const [index, chapterId] of manifest.manuscript.order.entries())
      expect(
        await readFile(
          join(fixture.projectPath, "manuscript", `${chapterId}.json`),
        ),
      ).toEqual(chapters[index]);
    expect(requests).toEqual([]);
  } finally {
    await application?.evaluate(({ app }) => app.exit()).catch(() => undefined);
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
