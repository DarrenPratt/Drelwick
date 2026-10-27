import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { copyFixture } from "../helpers/fixture-projects.js";

test("global search works offline across saved kinds, preserves drafts, rejects stale navigation and rebuilds on reopen", async () => {
  test.setTimeout(120_000);
  const fixture = await copyFixture("multi-chapter-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-global-search-"));
  const desktop = resolve("apps/desktop");
  const manifest = JSON.parse(
    await readFile(join(fixture.projectPath, "project.json"), "utf8"),
  ) as { projectId: string; manuscript: { order: string[] } };
  const secondPath = join(
    fixture.projectPath,
    "manuscript",
    `${manifest.manuscript.order[1]}.json`,
  );
  const second = JSON.parse(await readFile(secondPath, "utf8")) as Record<
    string,
    unknown
  >;
  second.title = "Search destination";
  second.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "needle destination" }],
      },
    ],
  };
  await writeFile(secondPath, JSON.stringify(second));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const network: string[] = [];
  const launch = async () => {
    app = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await app.firstWindow();
    await expect(page).toHaveTitle("Drelwick");
    await page.context().setOffline(true);
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) network.push(request.url());
    });
    await app.evaluate(({ dialog }, path) => {
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
    await page.evaluate(async (projectId) => {
      const records = [
        {
          kind: "character" as const,
          name: "Search character",
          aliases: ["needle alias"],
        },
        {
          kind: "location" as const,
          name: "Search location",
          description: "needle location",
        },
        {
          kind: "canon" as const,
          title: "Search canon",
          category: "other" as const,
          statement: "needle canon",
        },
        {
          kind: "timeline" as const,
          title: "Search timeline",
          date: "needle fictional date",
        },
        {
          kind: "note" as const,
          title: "Search research",
          body: "needle <script>inert reference</script>",
        },
      ];
      for (const content of records) {
        const result = await window.drelwick.references.execute({
          operation: "create",
          projectId,
          generation: 1,
          content: { ...content, tags: [], links: [] },
        });
        if (!result.ok) throw new Error("Fixture creation failed");
      }
    }, manifest.projectId);
    await page.locator(".ProseMirror").fill("needle unsaved manuscript");
    await page
      .getByRole("button", { name: "Search project", exact: true })
      .click();
    let panel = page.getByRole("region", {
      name: "Global local search",
      exact: true,
    });
    await panel.getByLabel("Search project text").fill("needle");
    await expect(panel.getByRole("status")).toHaveText("7 results.");
    expect(
      await readFile(
        join(
          fixture.projectPath,
          "manuscript",
          `${manifest.manuscript.order[0]}.json`,
        ),
        "utf8",
      ),
    ).toContain("needle unsaved manuscript");
    for (const kind of ["character", "location", "canon", "timeline", "note"]) {
      await panel.getByLabel("Record type").selectOption(kind);
      await expect(panel.locator("ol button")).toHaveCount(1);
    }
    await panel.getByLabel("Search project text").press("ArrowDown");
    await expect(panel.locator("ol button")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      panel.getByRole("heading", { name: "Search research" }),
    ).toBeFocused();
    await expect(panel.locator("dl")).toContainText(
      "<script>inert reference</script>",
    );
    await expect(panel.locator("script")).toHaveCount(0);
    await panel.getByRole("button", { name: "Back to search" }).click();
    await panel.getByLabel("Record type").selectOption("chapter");
    await expect(panel.locator("ol button")).toHaveCount(2);
    await panel
      .locator("ol button")
      .filter({ hasText: "Search destination" })
      .click();
    await expect(page.locator(".ProseMirror")).toHaveText("needle destination");

    // Character drafts survive panel changes and are flushed by search.
    await page
      .getByRole("button", { name: "Story bible", exact: true })
      .click();
    await expect(page.locator("#character-name")).toHaveValue(
      "Search character",
    );
    await page.locator("#character-name").fill("Unsaved search character");
    await page.getByRole("button", { name: "Locations", exact: true }).click();
    await expect(page.locator("#character-name")).toHaveValue(
      "Unsaved search character",
    );
    await panel.getByLabel("Record type").selectOption("character");
    await panel
      .getByLabel("Search project text")
      .fill("Unsaved search character");
    await expect
      .poll(async () => {
        const directory = join(fixture.projectPath, "reference", "characters");
        const name = (await readdir(directory)).find((name) =>
          name.endsWith(".json"),
        )!;
        return (
          JSON.parse(await readFile(join(directory, name), "utf8")) as {
            name: string;
          }
        ).name;
      })
      .toBe("Unsaved search character");
    await expect(panel.getByRole("status")).toHaveText("1 results.");
    await expect(panel.locator("ol button")).toHaveCount(1);
    await expect(panel.locator("ol button")).toContainText(
      "Unsaved search character",
    );
    await page
      .getByRole("button", { name: "Story bible", exact: true })
      .click();
    await expect(page.locator("#character-name")).toHaveValue(
      "Unsaved search character",
    );

    // External changes cannot turn an old result into an unrelated selection.
    await panel.getByLabel("Record type").selectOption("chapter");
    await panel.getByLabel("Search project text").fill("needle destination");
    await expect(panel.locator("ol button")).toHaveCount(1);
    second.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "external replacement" }],
        },
      ],
    };
    await writeFile(secondPath, JSON.stringify(second));
    await panel.locator("ol button").click();
    await expect(panel.getByRole("alert")).toContainText("result changed");
    await panel.getByRole("button", { name: "Refresh search" }).click();
    await expect(panel.getByRole("status")).toHaveText("No matching results.");
    await panel.getByRole("button", { name: "Close search" }).click();
    await app!.close();
    app = undefined;
    page = await launch();
    await page
      .getByRole("button", { name: "Search project", exact: true })
      .click();
    panel = page.getByRole("region", {
      name: "Global local search",
      exact: true,
    });
    await panel.getByLabel("Search project text").fill("external replacement");
    await expect(panel.locator("ol button")).toHaveCount(1);
    await panel
      .getByLabel("Search project text")
      .fill("Unsaved search character");
    await expect(panel.locator("ol button")).toHaveCount(1);
    expect(network).toEqual([]);
    await page.screenshot({
      path: "test-results/global-search.png",
      fullPage: true,
    });
  } finally {
    await app
      ?.evaluate(({ app: application }) => application.exit(0))
      .catch(() => undefined);
    await app?.close().catch(() => undefined);
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
