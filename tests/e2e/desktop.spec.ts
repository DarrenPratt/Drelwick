import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import { copyFixture } from "../helpers/fixture-projects.js";

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

test("validates Windows authoring, autosave, formatting, ordering and restart", async () => {
  const testDirectory = await mkdtemp(join(tmpdir(), "bookeditor-e2e-"));
  const projectDirectory = join(testDirectory, "project");
  const userDataDirectory = join(testDirectory, "user-data");
  const title = "E2E persistence project";
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

    for (let chapterNumber = 1; chapterNumber <= 10; chapterNumber += 1) {
      const title = `Chapter ${chapterNumber}`;
      await page.getByLabel("New chapter title").fill(title);
      await page
        .getByRole("button", { name: "New chapter", exact: true })
        .click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
    await page.getByLabel("Actions for Chapter 10").click();
    await page.getByRole("button", { name: "Move Chapter 10 up" }).click();

    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();
    await editor.fill(prose);
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "Unsaved changes",
    );
    await page.getByRole("button", { name: "Bold" }).click();
    await editor.pressSequentially(" in bold");
    await page.getByRole("button", { name: "Insert scene break" }).click();
    await expect(editor.locator("strong")).toHaveText(" in bold");
    await expect(editor.locator("[data-scene-break]")).toHaveCount(1);
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "All changes saved",
      { timeout: 10_000 },
    );
    expect(
      await page.evaluate(() => ({
        nodeProcess: "process" in window,
        nodeRequire: "require" in window,
      })),
    ).toEqual({ nodeProcess: false, nodeRequire: false });

    const project = JSON.parse(
      await readFile(join(projectDirectory, "project.json"), "utf8"),
    ) as { manuscript: { order: string[] } };
    expect(project.manuscript.order).toHaveLength(10);
    const orderedChapters = await Promise.all(
      project.manuscript.order.map(
        async (id) =>
          JSON.parse(
            await readFile(
              join(projectDirectory, "manuscript", `${id}.json`),
              "utf8",
            ),
          ) as { title: string },
      ),
    );
    expect(orderedChapters.slice(8).map((chapter) => chapter.title)).toEqual([
      "Chapter 10",
      "Chapter 9",
    ]);
    const chapterId = project.manuscript.order[8]!;
    expect(chapterId).toBeTruthy();
    const chapter = JSON.parse(
      await readFile(
        join(projectDirectory, "manuscript", `${chapterId}.json`),
        "utf8",
      ),
    ) as { content: { content: unknown[] } };
    expect(chapter.content.content).toEqual(
      expect.arrayContaining([
        {
          type: "paragraph",
          content: [
            { type: "text", text: prose },
            { type: "text", marks: [{ type: "bold" }], text: " in bold" },
          ],
        },
        { type: "sceneBreak" },
      ]),
    );

    await application.close();
    application = undefined;

    const restarted = await launchApplication(userDataDirectory);
    application = restarted.application;
    await restarted.page
      .getByRole("button", { name: title, exact: true })
      .click();
    await restarted.page.getByRole("button", { name: /Chapter 10/ }).click();
    await expect(
      restarted.page.getByRole("heading", { name: "Chapter 10" }),
    ).toBeVisible();
    await expect(restarted.page.locator(".ProseMirror")).toContainText(prose);
    await expect(restarted.page.locator(".ProseMirror strong")).toHaveText(
      " in bold",
    );
    await expect(
      restarted.page.locator(".ProseMirror [data-scene-break]"),
    ).toHaveCount(1);
  } finally {
    await application?.close().catch(() => undefined);
    await rm(testDirectory, { recursive: true, force: true });
  }
});

test("recovers a history version after a forced process shutdown", async () => {
  const { projectPath, cleanup } = await copyFixture("recovery-project");
  const userDataDirectory = await mkdtemp(
    join(tmpdir(), "bookeditor-recovery-e2e-"),
  );
  let application: ElectronApplication | undefined;

  try {
    await mkdir(userDataDirectory, { recursive: true });
    await writeFile(
      join(userDataDirectory, "recent-projects.json"),
      JSON.stringify({
        schemaVersion: 1,
        projects: [
          {
            id: "10000000-0000-4000-8000-000000000701",
            path: projectPath,
            title: "Recovery History Fixture",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(userDataDirectory, "session.json"),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: "10000000-0000-4000-8000-000000000702",
        started: "2026-01-06T12:00:00.000Z",
        cleanShutdown: true,
        shutdown: "2026-01-06T12:01:00.000Z",
      }),
      "utf8",
    );

    const first = await launchApplication(userDataDirectory);
    application = first.application;
    await first.page
      .getByRole("button", { name: "Recovery History Fixture", exact: true })
      .click();
    await expect(
      first.page.getByRole("heading", { name: "Recoverable Chapter" }),
    ).toBeVisible();

    const child = application.process();
    const exited = new Promise<void>((resolveExit) => {
      child.once("exit", () => resolveExit());
    });
    if (process.platform === "win32")
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
    else if (!child.kill("SIGKILL"))
      throw new Error("Unable to force-terminate the Electron test process.");
    await exited;
    application = undefined;

    const restarted = await electron.launch({
      args: [desktopDirectory, "--user-data-dir=" + userDataDirectory],
      cwd: desktopDirectory,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });
    application = restarted;
    const page = await restarted.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Manuscript recovery" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Recover" }).click();
    await expect(
      page.getByRole("heading", { name: "Your manuscript workspace" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Recovery History Fixture", exact: true })
      .click();
    await expect(page.locator(".ProseMirror")).toHaveText(
      "Newer synthetic text available for recovery.",
    );

    const manifest = JSON.parse(
      await readFile(join(projectPath, "project.json"), "utf8"),
    ) as { manuscript: { order: string[] } };
    const chapterId = manifest.manuscript.order[0]!;
    const recovered = JSON.parse(
      await readFile(
        join(projectPath, "manuscript", chapterId + ".json"),
        "utf8",
      ),
    ) as { content: unknown };
    expect(recovered.content).toMatchObject({
      content: [
        {
          content: [{ text: "Newer synthetic text available for recovery." }],
        },
      ],
    });
    const historyDirectory = join(
      projectPath,
      ".history",
      "snapshots",
      chapterId,
    );
    const historyFiles = await readdir(historyDirectory);
    const snapshots = await Promise.all(
      historyFiles.map(
        async (file) =>
          JSON.parse(await readFile(join(historyDirectory, file), "utf8")) as {
            reason: string;
            content: { content: { content?: { text: string }[] }[] };
          },
      ),
    );
    expect(
      snapshots.some(
        (snapshot) =>
          snapshot.reason === "before-recovery" &&
          snapshot.content.content[0]?.content?.[0]?.text ===
            "Saved synthetic text.",
      ),
    ).toBe(true);
  } finally {
    await application?.close().catch(() => undefined);
    await cleanup();
    await rm(userDataDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
