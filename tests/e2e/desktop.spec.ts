import {
  cp,
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
import { docx, p, unicode } from "../../packages/core/test/fixtures/docx.js";
import { syntheticImage } from "../helpers/synthetic-images.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const desktopDirectory = join(repositoryRoot, "apps", "desktop");

test("imports local images, edits semantics and reopens a portable project offline", async () => {
  const fixture = await copyFixture("minimal-book");
  const scratch = await mkdtemp(join(tmpdir(), "sarel-image-e2e-"));
  let application: ElectronApplication | undefined;
  try {
    const source = join(scratch, "synthetic.png");
    await writeFile(source, await syntheticImage());
    const launched = await launchApplication(join(scratch, "user-data"));
    application = launched.application;
    const page = launched.page;
    const requests: string[] = [];
    await page.route(/^https?:/, async (route) => {
      requests.push(route.request().url());
      await route.abort();
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
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, source);
    await page
      .getByRole("button", { name: "Insert image", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    const image = editor.locator("figure img");
    await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
    await image.click();
    await page
      .getByLabel("Alternative text", { exact: true })
      .fill("海 — café 🌱");
    await page.getByLabel("Image size", { exact: true }).selectOption("full");
    await expect(image).toHaveAttribute("alt", "海 — café 🌱");
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "All changes saved",
    );
    const originalSrc = await image.getAttribute("src");
    await writeFile(source, "MZ not an image");
    await page
      .getByRole("button", { name: "Replace image", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("valid PNG or JPEG");
    await expect(image).toHaveAttribute("src", originalSrc!);
    await rm(source);
    await editor.evaluate((element) => {
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<p>Before<img src="https://remote.invalid/tracker.png" alt="remote">After</p>',
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    });
    await expect(editor).toContainText("use Insert image");
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "All changes saved",
    );
    // Undo the paste so the original image remains for portability verification.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(image).toHaveAttribute("alt", "海 — café 🌱");
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "All changes saved",
    );
    expect(requests).toEqual([]);
    await application.close();
    application = undefined;
    const moved = join(scratch, "moved-project");
    await cp(fixture.projectPath, moved, { recursive: true });
    const restarted = await launchApplication(join(scratch, "fresh-user-data"));
    application = restarted.application;
    await restarted.page.context().setOffline(true);
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, moved);
    await restarted.page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    const restored = restarted.page.locator(".ProseMirror figure img");
    await expect(restored).toHaveAttribute("alt", "海 — café 🌱");
    await expect(restored).toHaveAttribute("src", originalSrc!);
    await expect(
      restarted.page.locator('.ProseMirror figure[data-image-size="full"]'),
    ).toBeVisible();
    expect(
      await restored.evaluate(
        (element) => (element as HTMLImageElement).naturalWidth,
      ),
    ).toBe(2);
  } finally {
    await application?.close();
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});

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
  await expect(page).toHaveTitle("SAREL");
  expect(await application.evaluate(({ app }) => app.getName())).toBe("SAREL");
  expect(await application.evaluate(({ app }) => app.getPath("userData"))).toBe(
    userDataDirectory,
  );
  await expect(
    page.getByRole("heading", { name: "Your manuscript workspace" }),
  ).toBeVisible();
  return { application, page };
}

test("validates Windows authoring, autosave, formatting, ordering and restart", async () => {
  const testDirectory = await mkdtemp(join(tmpdir(), "sarel-e2e-"));
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
    const historyDirectory = join(
      projectDirectory,
      ".history",
      "snapshots",
      chapterId,
    );
    await expect
      .poll(async () => {
        try {
          return await readdir(historyDirectory);
        } catch {
          return [];
        }
      })
      .toHaveLength(1);
    const history = JSON.parse(
      await readFile(
        join(historyDirectory, (await readdir(historyDirectory))[0]!),
        "utf8",
      ),
    ) as { reason: string; content: { content: unknown[] } };
    expect(history).toMatchObject({
      reason: "interval",
      content: chapter.content,
    });

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
  const manifest = JSON.parse(
    await readFile(join(projectPath, "project.json"), "utf8"),
  ) as { manuscript: { order: string[] } };
  const fixtureChapterId = manifest.manuscript.order[0]!;
  const fixtureHistoryPath = join(
    projectPath,
    ".history",
    "snapshots",
    fixtureChapterId,
  );
  for (const file of await readdir(fixtureHistoryPath)) {
    const snapshotPath = join(fixtureHistoryPath, file);
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
      created: string;
    };
    await writeFile(
      snapshotPath,
      JSON.stringify({ ...snapshot, created: new Date().toISOString() }),
      "utf8",
    );
  }
  const userDataDirectory = await mkdtemp(
    join(tmpdir(), "sarel-recovery-e2e-"),
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

test("reviews DOCX warnings and chapter mapping, then imports, edits, saves and reopens exact Unicode text", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "sarel-docx-e2e-"));
  let application: ElectronApplication | undefined;
  const source = join(scratch, "novel.docx");
  const destination = join(scratch, "imported");
  const bytes = Buffer.from(
    docx(
      p("Preface") +
        p("Chapter One", '<w:pStyle w:val="Heading1"/>') +
        p(unicode) +
        `<w:tbl><w:tr><w:tc>${p("Recovered table text")}</w:tc></w:tr></w:tbl>` +
        p("Chapter Two", '<w:pStyle w:val="Heading1"/>') +
        p("End."),
    ),
  );
  try {
    await writeFile(source, bytes);
    await mkdir(destination);
    const launched = await launchApplication(join(scratch, "user-data"));
    application = launched.application;
    const page = launched.page;
    await page.context().setOffline(true);
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, source);
    await page
      .getByRole("button", { name: "Import manuscript", exact: true })
      .click();
    const preview = page.getByRole("dialog", { name: "Import manuscript" });
    await expect(
      preview.getByRole("heading", { name: "Imported metadata" }),
    ).toBeVisible();
    await expect(preview.getByLabel("Chapter 2 title")).toHaveValue(
      "Chapter One",
    );
    await expect(preview.getByLabel("Chapter 3 title")).toHaveValue(
      "Chapter Two",
    );
    const commit = preview.getByRole("button", {
      name: "Choose destination and import",
    });
    await expect(commit).toBeDisabled();
    await page.screenshot({ path: "test-results/import-preview.png" });
    expect(await readdir(destination)).toEqual([]);
    expect(await readFile(source)).toEqual(bytes);
    await preview
      .getByRole("button", { name: "Remove boundary before Chapter One" })
      .click();
    await preview.getByLabel("Start a chapter at block").fill("3");
    await preview.getByRole("button", { name: "Add chapter boundary" }).click();
    await preview.getByLabel("Chapter 2 title").fill("Mapped chapter");
    const decisions = preview.getByRole("checkbox");
    expect(await decisions.count()).toBeGreaterThan(0);
    for (const decision of await decisions.all()) await decision.check();
    await expect(commit).toBeEnabled();
    // Native destination cancellation retains the same author-approved review.
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await commit.click();
    await expect(commit).toBeEnabled();
    await expect(preview).toBeVisible();
    expect(await readdir(destination)).toEqual([]);
    expect(await readFile(source)).toEqual(bytes);
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, destination);
    await commit.click();
    await expect(preview).not.toBeVisible();
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();
    await expect(editor).toHaveText("PrefaceChapter One");
    const chapters = page.locator(".chapter-select");
    await expect(chapters).toHaveCount(3);
    await chapters.nth(1).click();
    await expect(editor).toHaveText(unicode + "Recovered table text");
    await chapters.nth(2).click();
    await expect(editor).toHaveText("Chapter TwoEnd.");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Edited after import.");
    await page
      .getByRole("button", { name: "Save chapter", exact: true })
      .click();
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "All changes saved",
    );
    expect(await readFile(source)).toEqual(bytes);
    await application.close();
    application = undefined;
    const restarted = await launchApplication(join(scratch, "user-data"));
    application = restarted.application;
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, destination);
    await restarted.page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    const reopenedEditor = restarted.page.locator(".ProseMirror");
    const expected = [
      "PrefaceChapter One",
      unicode + "Recovered table text",
      "Chapter TwoEnd. Edited after import.",
    ];
    for (let index = 0; index < expected.length; index++) {
      await restarted.page.locator(".chapter-select").nth(index).click();
      await expect(reopenedEditor).toHaveText(expected[index]!);
    }
    expect(await readFile(source)).toEqual(bytes);
    // The native menu enters the same review and cancellation path with an active project.
    await application.evaluate(({ dialog, Menu, BrowserWindow }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
      const item = Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "File")
        ?.submenu?.items.find((item) =>
          item.label.startsWith("Import manuscript"),
        );
      if (!item) throw new Error("Missing import menu");
      item.click(undefined, BrowserWindow.getAllWindows()[0], {});
    }, source);
    await expect(
      restarted.page.getByRole("heading", { name: "Proposed chapters" }),
    ).toBeVisible();
    await restarted.page
      .getByRole("button", { name: "Cancel import", exact: true })
      .click();
    await expect(restarted.page.getByRole("dialog")).not.toBeVisible();
    await expect(reopenedEditor).toHaveText(expected[2]!);
    expect(await readFile(source)).toEqual(bytes);
  } finally {
    await application?.close();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
