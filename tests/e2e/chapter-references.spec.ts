import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { copyFixture } from "../helpers/fixture-projects.js";

test("chapter links support keyboard attach, bidirectional dirty navigation, removal and reopen offline", async () => {
  test.setTimeout(120000);
  const fixture = await copyFixture("multi-chapter-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-chapter-links-"));
  const desktop = resolve("apps/desktop");
  const manifest = JSON.parse(
    await readFile(join(fixture.projectPath, "project.json"), "utf8"),
  ) as { projectId: string; manuscript: { order: string[] } };
  const [first, second] = manifest.manuscript.order as [string, string];
  const firstPath = join(fixture.projectPath, "manuscript", `${first}.json`);
  const secondTitle = JSON.parse(
    await readFile(
      join(fixture.projectPath, "manuscript", `${second}.json`),
      "utf8",
    ),
  ).title as string;
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const requests: string[] = [];
  const launch = async () => {
    application = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("Drelwick");
    await page.context().setOffline(true);
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
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
      .getByText("Chapter references and backlinks", { exact: true })
      .click();
    return page;
  };
  try {
    let page = await launch();
    let panel = page.getByRole("region", {
      name: "Chapter references",
      exact: true,
    });
    await expect(
      panel.getByRole("button", { name: "Refresh chapter links" }),
    ).toBeEnabled();
    const referenceId = await page.evaluate(
      async ({ projectId, chapterId }) => {
        const result = await window.drelwick.references.execute({
          operation: "create",
          projectId,
          generation: 1,
          content: {
            kind: "note",
            title: "Navigation research",
            body: "Private reference details stay outside the manuscript.",
            tags: [],
            links: [{ target: { kind: "chapter", id: chapterId } }],
          },
        });
        if (!result.ok || result.value.type !== "record")
          throw new Error("Fixture creation failed");
        return result.value.value.record.id;
      },
      { projectId: manifest.projectId, chapterId: second },
    );
    await panel.getByRole("button", { name: "Refresh chapter links" }).click();
    await panel.getByLabel("Story Bible record").selectOption(referenceId);
    await panel.getByLabel("Story Bible record").press("Tab");
    await expect(
      panel.getByRole("button", { name: "View reference and linked chapters" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      panel.getByRole("heading", { name: "Navigation research" }),
    ).toBeFocused();
    await panel.getByRole("button", { name: "Attach current chapter" }).click();
    await expect(panel.getByRole("status")).toHaveText("Chapter links saved.");
    const referencePath = join(
      fixture.projectPath,
      "reference",
      "notes",
      `${referenceId}.json`,
    );
    const linked = JSON.parse(await readFile(referencePath, "utf8"));
    expect(linked.links).toHaveLength(2);
    await page
      .locator(".ProseMirror")
      .fill("Pending linked navigation manuscript edit.");
    await panel
      .getByRole("button", { name: `Open chapter ${secondTitle}`, exact: true })
      .click();
    await expect(page.locator('[aria-current="page"]')).toContainText(
      secondTitle,
    );
    expect(await readFile(firstPath, "utf8")).toContain(
      "Pending linked navigation manuscript edit.",
    );
    await expect(
      panel.getByRole("button", {
        name: "Open Navigation research",
        exact: true,
      }),
    ).toBeEnabled();
    await panel.getByRole("button", { name: "Back to chapter links" }).click();
    await panel
      .getByRole("button", { name: "Open Navigation research", exact: true })
      .click();
    await expect(
      panel.getByRole("region", { name: "Linked reference details" }),
    ).toContainText("Private reference details stay outside the manuscript.");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await application!.close();
    application = undefined;
    page = await launch();
    panel = page.getByRole("region", {
      name: "Chapter references",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "Open Navigation research", exact: true })
      .click();
    expect(JSON.parse(await readFile(referencePath, "utf8")).links).toEqual(
      linked.links,
    );
    await panel
      .getByRole("button", {
        name: `Remove chapter link to ${secondTitle}`,
        exact: true,
      })
      .click();
    await expect(panel.getByRole("status")).toHaveText("Chapter links saved.");
    expect(
      JSON.parse(await readFile(referencePath, "utf8")).links,
    ).toHaveLength(1);
    expect(await readFile(firstPath, "utf8")).not.toContain(
      "Private reference details",
    );
    expect(requests).toEqual([]);
  } finally {
    await application
      ?.evaluate(({ app }) => app.exit(0))
      .catch(() => undefined);
    await application?.close().catch(() => undefined);
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
