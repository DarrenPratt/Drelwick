import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { copyFixture } from "../helpers/fixture-projects.js";

test("timeline keyboard CRUD, stable associations, deleted targets and reopen work offline", async () => {
  test.setTimeout(120000);
  const fixture = await copyFixture("multi-chapter-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-timeline-ui-"));
  const desktop = resolve("apps/desktop");
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const manifest = JSON.parse(
    await readFile(join(fixture.projectPath, "project.json"), "utf8"),
  ) as { projectId: string; manuscript: { order: string[] } };
  const original = await Promise.all(
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
    return page;
  };
  try {
    let page = await launch();
    const targets = await page.evaluate(async (projectId) => {
      const ids: string[] = [];
      for (const content of [
        {
          kind: "character" as const,
          name: "Navigator",
          aliases: [],
          description: "A careful sailor.",
          tags: [],
          links: [],
        },
        {
          kind: "location" as const,
          name: "Harbour",
          description: "Sheltered water.",
          tags: [],
          links: [],
        },
      ]) {
        const result = await window.drelwick.references.execute({
          operation: "create",
          projectId,
          content,
          generation: 1,
        });
        if (!result.ok || result.value.type !== "record")
          throw new Error("Fixture creation failed");
        ids.push(result.value.value.record.id);
      }
      return ids;
    }, manifest.projectId);
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    let panel = page.locator('[aria-labelledby="timeline-bible-heading"]');
    await expect(panel).toContainText("No timeline events yet");
    await panel.getByLabel("Title", { exact: true }).fill("Departure 🌒");
    await panel.getByLabel("Title", { exact: true }).press("Tab");
    await expect(panel.getByLabel("Date (optional, free text)")).toBeFocused();
    await page.keyboard.type("Second moon");
    await page.keyboard.press("Tab");
    await expect(panel.getByLabel("Sequence (optional integer)")).toBeFocused();
    await page.keyboard.type("-2");
    await panel
      .getByLabel("Description", { exact: true })
      .fill("PRIVATE_TIMELINE_CANARY");
    await panel
      .getByRole("button", { name: "Save event", exact: true })
      .click();
    await expect(panel.getByRole("status")).toHaveText("Timeline saved.");
    const id = await panel.getByLabel("Timeline", { exact: true }).inputValue();
    const file = join(
      fixture.projectPath,
      "reference",
      "timeline",
      `${id}.json`,
    );
    for (const value of [
      `chapter:${manifest.manuscript.order[1]!}`,
      `character:${targets[0]!}`,
      `location:${targets[1]!}`,
    ]) {
      await panel
        .getByLabel("Chapter, character or location")
        .selectOption(value);
      await panel.getByLabel("Chapter, character or location").press("Tab");
      await expect(
        panel.getByRole("button", { name: "Add association", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await panel
      .getByRole("button", { name: "Save event", exact: true })
      .click();
    await expect(panel.getByRole("status")).toHaveText("Timeline saved.");
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toMatchObject({
      title: "Departure 🌒",
      date: "Second moon",
      sequence: -2,
      description: "PRIVATE_TIMELINE_CANARY",
    });
    expect(saved.links).toHaveLength(3);
    await panel.getByLabel("Notes", { exact: true }).fill("A later event edit");
    await panel
      .getByRole("button", { name: "Save event", exact: true })
      .click();
    await expect(panel.getByRole("status")).toHaveText("Timeline saved.");
    expect(JSON.parse(await readFile(file, "utf8")).links).toEqual(saved.links);
    await expect(
      panel.getByRole("button", { name: "Open Navigator", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "Open Navigator", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      panel.getByRole("region", { name: "Associated record" }),
    ).toContainText("A careful sailor.");
    await expect(
      panel.getByRole("heading", { name: "Navigator", exact: true }),
    ).toBeFocused();
    await panel.getByRole("button", { name: "Back to event" }).click();
    await expect(
      panel.getByRole("button", { name: "Open Navigator", exact: true }),
    ).toBeFocused();
    await panel
      .getByRole("button", { name: "Open Harbour", exact: true })
      .click();
    await expect(
      panel.getByRole("region", { name: "Associated record" }),
    ).toContainText("Sheltered water.");
    await panel.getByRole("button", { name: "Back to event" }).click();
    // Opening a chapter uses the existing manuscript navigation/save guard.
    const chapterOpen = panel.getByRole("button", { name: /^Open / }).first();
    await chapterOpen.click();
    await expect(page.locator('[aria-current="page"]')).toContainText(
      JSON.parse(original[1]!.toString()).title,
    );
    await expect(page.locator(".ProseMirror")).toBeEditable();
    await page.evaluate(
      async ({ projectId, targets }) => {
        for (const [index, kind] of (
          ["character", "location"] as const
        ).entries()) {
          const result = await window.drelwick.references.execute({
            operation: "read",
            projectId,
            kind,
            id: targets[index]!,
          });
          if (!result.ok || result.value.type !== "record")
            throw new Error("Fixture read failed");
          const { record, fingerprint } = result.value.value;
          const base = {
            projectId,
            kind,
            id: record.id,
            expectedRevision: record.revision,
            expectedFingerprint: fingerprint,
            generation: 2,
          };
          const updated =
            kind === "character" && record.kind === "character"
              ? await window.drelwick.references.execute({
                  ...base,
                  operation: "update",
                  content: {
                    kind,
                    name: "Renamed navigator",
                    aliases: record.aliases,
                    tags: record.tags,
                    links: record.links,
                  },
                })
              : await window.drelwick.references.execute({
                  ...base,
                  operation: "delete",
                });
          if (!updated.ok) throw new Error("Fixture update failed");
        }
      },
      { projectId: manifest.projectId, targets },
    );
    await panel.getByRole("button", { name: "Refresh associations" }).click();
    await expect(
      panel.getByRole("button", { name: "Open Renamed navigator" }),
    ).toBeEnabled();
    await expect(panel).toContainText("Harbour — deleted");
    expect(JSON.parse(await readFile(file, "utf8")).links).toEqual(saved.links);
    // Invalid edits persist across panel changes and block shutdown.
    await panel.getByLabel("Sequence (optional integer)").fill("1.5");
    await panel
      .getByRole("button", { name: "Save event", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("safe integer");
    await page.getByRole("button", { name: "Locations", exact: true }).click();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(panel.getByLabel("Sequence (optional integer)")).toHaveValue(
      "1.5",
    );
    await application!.evaluate(({ app }) => app.quit());
    await expect(
      page.getByText("Unable to save changes before closing.", {
        exact: false,
      }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Discard changes" }).click();
    await expect(panel.getByLabel("Sequence (optional integer)")).toHaveValue(
      "-2",
    );
    await panel.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(panel).toContainText("Timeline deleted.");
    await panel.getByRole("button", { name: "Restore event" }).click();
    await expect(panel).toContainText("Timeline restored.");
    await application!.close();
    application = undefined;
    page = await launch();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    panel = page.locator('[aria-labelledby="timeline-bible-heading"]');
    await expect(panel.getByLabel("Title", { exact: true })).toHaveValue(
      "Departure 🌒",
    );
    await expect(panel).toContainText("Harbour — deleted");
    expect(JSON.parse(await readFile(file, "utf8")).links).toEqual(saved.links);
    for (const [index, chapterId] of manifest.manuscript.order.entries())
      expect(
        await readFile(
          join(fixture.projectPath, "manuscript", `${chapterId}.json`),
        ),
      ).toEqual(original[index]);
    expect(requests).toEqual([]);
  } finally {
    // A failed dirty-state assertion must not leave teardown waiting on the
    // application's intentional shutdown veto. This is only our fixture app.
    await application
      ?.evaluate(({ app }) => app.exit(0))
      .catch(() => undefined);
    await application?.close().catch(() => undefined);
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
