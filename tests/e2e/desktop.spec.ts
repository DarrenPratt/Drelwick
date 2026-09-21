import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const desktopDirectory = join(repositoryRoot, "apps", "desktop");

async function launchApplication(userDataDirectory: string) {
  const application = await electron.launch({
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await application.firstWindow();
  await expect(
    page.getByRole("heading", { name: "Your manuscript workspace" }),
  ).toBeVisible();
  return { application, page };
}

test("creates a project and preserves manuscript prose across restart", async () => {
  const testDirectory = await mkdtemp(join(tmpdir(), "bookeditor-e2e-"));
  const projectDirectory = join(testDirectory, "project");
  const userDataDirectory = join(testDirectory, "user-data");
  const title = "E2E persistence project";
  const chapterTitle = "A Test Chapter";
  const prose = "The lighthouse kept its patient watch over the synthetic sea.";
  let application: ElectronApplication | undefined;

  try {
    const launched = await launchApplication(userDataDirectory);
    application = launched.application;
    const page = launched.page;

    await application.evaluate(({ dialog }, selectedDirectory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedDirectory],
      });
    }, projectDirectory);

    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    await page.getByLabel("Book title").fill(title);
    await page.getByLabel("Author").fill("End-to-end test author");
    await page.getByRole("button", { name: "Choose folder…" }).click();
    await expect(page.getByLabel("Project location")).toHaveValue(
      projectDirectory,
    );
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.getByLabel("New chapter title").fill(chapterTitle);
    await page
      .getByRole("button", { name: "New chapter", exact: true })
      .click();
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();
    await editor.fill(prose);
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "Unsaved changes",
    );
    await page.getByRole("button", { name: "Save chapter" }).click();
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "All changes saved",
    );

    const project = JSON.parse(
      await readFile(join(projectDirectory, "project.json"), "utf8"),
    ) as { manuscript: { order: string[] } };
    const chapterId = project.manuscript.order[0];
    expect(chapterId).toBeTruthy();
    const chapter = JSON.parse(
      await readFile(
        join(projectDirectory, "manuscript", `${chapterId}.json`),
        "utf8",
      ),
    ) as { content: unknown };
    expect(chapter.content).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: prose }],
        },
      ],
    });

    await application.close();
    application = undefined;

    const restarted = await launchApplication(userDataDirectory);
    application = restarted.application;
    await restarted.page
      .getByRole("button", { name: title, exact: true })
      .click();
    await expect(
      restarted.page.getByRole("heading", { name: chapterTitle }),
    ).toBeVisible();
    await expect(restarted.page.locator(".ProseMirror")).toHaveText(prose);
  } finally {
    await application?.close().catch(() => undefined);
    await rm(testDirectory, { recursive: true, force: true });
  }
});
