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
import { createHash } from "node:crypto";
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
import {
  generateThemeStyles,
  getBookTheme,
} from "../../packages/renderer/src/themes.js";
import { docx, p, unicode } from "../../packages/core/test/fixtures/docx.js";
import {
  fixture as semanticBook,
  assetId as semanticAssetId,
} from "../../packages/renderer/test/fixture.js";

test("Community themes switch offline without rewriting prose and survive restart", async () => {
  const fixture = await copyFixture("minimal-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-themes-"));
  let application: ElectronApplication | undefined;
  try {
    const chapterPath = join(
      fixture.projectPath,
      "manuscript",
      "00000000-0000-4000-8000-000000000111.json",
    );
    const chapter = JSON.parse(await readFile(chapterPath, "utf8"));
    const paragraph = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    chapter.content = {
      type: "doc",
      content: [
        paragraph(
          "The lamps along the harbour were still burning when Mara opened the book. Beyond the window, the first ferry crossed a silver line of dawn.",
        ),
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "One more page,",
              marks: [{ type: "italic" }],
            },
            { type: "text", text: " she thought. " },
            {
              type: "text",
              text: "One more beginning.",
              marks: [{ type: "bold" }],
            },
          ],
        },
        {
          type: "blockquote",
          content: [paragraph("Every journey begins with a question.")],
        },
        {
          type: "epigraph",
          attrs: { attribution: "A traveller’s notebook" },
          content: [paragraph("The sea remembers every shore.")],
        },
        { type: "sceneBreak" },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "The letter" }],
        },
        paragraph(
          "Café — 日本語 — Ελληνικά. The words on the envelope had travelled farther than she had.",
        ),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph("A map")] },
            { type: "listItem", content: [paragraph("A promise")] },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "A distant destination",
              marks: [
                { type: "link", attrs: { href: "https://example.invalid" } },
              ],
            },
          ],
        },
      ],
    };
    await writeFile(chapterPath, JSON.stringify(chapter));
    const before = await readFile(chapterPath);
    let launched = await launchApplication(join(scratch, "user-data"));
    application = launched.application;
    const page = launched.page;
    await page.context().setOffline(true);
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
    await expect(page.locator(".ProseMirror")).toBeEditable();
    // Opening preview must not manufacture an editor change or rewrite chapters.
    await page
      .getByRole("button", { name: "Book preview", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Book preview", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close preview" }).click();
    expect(await readFile(chapterPath)).toEqual(before);
    await page
      .getByRole("button", { name: "Book design", exact: true })
      .click();
    await expect(page.getByLabel("Book theme", { exact: true })).toHaveValue(
      "classic",
    );
    await page.getByLabel("Book theme", { exact: true }).selectOption("modern");
    await expect(
      page.getByRole("status").filter({ hasText: "Theme saved" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open book preview panel", exact: true })
      .click();
    // The rail opens the preview panel; its action opens the manuscript dialog.
    const action = page
      .locator(".workspace-inspector")
      .getByRole("button", { name: "Book preview", exact: true });
    await action.click();
    const dialog = page.getByRole("dialog", {
      name: "Book preview",
      exact: true,
    });
    const iframe = dialog.locator("iframe");
    const frame = iframe.contentFrame();
    await expect(frame.locator(".chapter")).toHaveCSS("text-align", "left");
    const markup = await frame.locator("body").innerHTML();
    const prose = await frame.locator("body").textContent();
    for (const id of ["classic", "modern", "literary"] as const) {
      await dialog.getByLabel("Book theme", { exact: true }).selectOption(id);
      await expect(
        dialog.getByRole("status").filter({ hasText: "Theme saved" }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          (await iframe.getAttribute("srcdoc"))?.includes(
            generateThemeStyles(getBookTheme(id), "ebook").css,
          ),
        )
        .toBe(true);
      await expect(frame.locator(".chapter")).toHaveCSS(
        "text-align",
        id === "classic" ? "justify" : "left",
      );
      expect(await frame.locator("body").innerHTML()).toBe(markup);
      expect(await frame.locator("body").textContent()).toBe(prose);
      expect(await readFile(chapterPath)).toEqual(before);
      await dialog.screenshot({
        path: test.info().outputPath(`theme-${id}.png`),
      });
    }
    // Simulate no preferred font: the same generator's generic-only adapter remains readable offline.
    const css = generateThemeStyles(getBookTheme("literary"), "ebook", {
      fontPolicy: "generic-only",
    }).css;
    const original = (await iframe.getAttribute("srcdoc"))!;
    const fallback = original
      .replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`)
      .replace(
        /sha256-[A-Za-z0-9+/=]+/,
        `sha256-${createHash("sha256").update(css).digest("base64")}`,
      );
    await iframe.evaluate((element, html) => {
      (element as HTMLIFrameElement).srcdoc = html;
    }, fallback);
    await expect(frame.locator(".chapter")).toHaveCSS("font-family", "serif");
    await expect(frame.locator(".chapter-title")).toBeVisible();
    expect(await frame.locator("body").textContent()).toBe(prose);
    expect(requests).toEqual([]);
    await dialog.getByRole("button", { name: "Close preview" }).click();
    await application.close();
    application = undefined;
    launched = await launchApplication(join(scratch, "user-data"));
    application = launched.application;
    await launched.page.context().setOffline(true);
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await launched.page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(launched.page.locator(".ProseMirror")).toBeEditable();
    await launched.page
      .getByRole("button", { name: "Book preview", exact: true })
      .click();
    await expect(
      launched.page
        .getByRole("dialog")
        .getByLabel("Book theme", { exact: true }),
    ).toHaveValue("literary");
    expect(await readFile(chapterPath)).toEqual(before);
    await launched.page.getByRole("button", { name: "Close preview" }).click();
  } finally {
    await application?.close();
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});

test("shared book preview saves pending prose and isolates active content, assets and privileges", async () => {
  const fixture = await copyFixture("minimal-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-book-preview-"));
  let application: ElectronApplication | undefined;
  try {
    const chapterPath = join(
      fixture.projectPath,
      "manuscript",
      "00000000-0000-4000-8000-000000000111.json",
    );
    const chapter = JSON.parse(await readFile(chapterPath, "utf8"));
    chapter.content = semanticBook().chapters[0]!.document;
    await writeFile(chapterPath, JSON.stringify(chapter));
    const bytes = await syntheticImage();
    const assetDirectory = join(
      fixture.projectPath,
      "assets",
      "images",
      semanticAssetId,
    );
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(join(assetDirectory, "original.png"), bytes);
    await writeFile(
      join(assetDirectory, "asset.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: semanticAssetId,
        mediaType: "image/png",
        originalFilename: "synthetic.png",
        width: 2,
        height: 3,
        byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
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
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("Fresh pending prose");
    await page
      .getByRole("button", { name: "Book preview", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Book preview",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const iframe = dialog.locator("iframe");
    await expect(iframe).toHaveAttribute("sandbox", "");
    const frame = iframe.contentFrame();
    await expect(frame.locator("body")).toContainText("Fresh pending prose");
    await expect(frame.locator("body")).toContainText(
      '<script>alert("x")</script>',
    );
    expect(await readFile(chapterPath, "utf8")).toContain(
      "Fresh pending prose",
    );
    expect(await iframe.getAttribute("srcdoc")).not.toContain(
      fixture.projectPath,
    );
    await expect(frame.locator("img")).toHaveCount(4);
    expect(
      await frame
        .locator("img")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBe(2);
    await expect(frame.locator("a,script,iframe,object,[onclick]")).toHaveCount(
      0,
    );
    const privileges = await frame.locator("body").evaluate(() => {
      const globals = globalThis as unknown as Record<string, unknown>;
      let parentBlocked = false;
      try {
        void parent.document;
      } catch {
        parentBlocked = true;
      }
      return {
        node: typeof globals.require,
        process: typeof globals.process,
        preload: typeof globals.drelwick,
        ipc: typeof globals.ipcRenderer,
        parentBlocked,
      };
    });
    expect(privileges).toEqual({
      node: "undefined",
      process: "undefined",
      preload: "undefined",
      ipc: "undefined",
      parentBlocked: true,
    });
    await dialog.screenshot({
      path: test.info().outputPath("book-preview.png"),
    });
    const mainUrl = page.url();
    await frame.getByText("linked emphasis", { exact: true }).click();
    expect(page.url()).toBe(mainUrl);
    // Defense in depth: deliberately bypass the semantic renderer in this test.
    // Even injected active markup remains blocked by the real iframe/CSP boundary.
    await iframe.evaluate((element) => {
      const frame = element as HTMLIFrameElement;
      frame.srcdoc = frame.srcdoc.replace(
        "</body>",
        '<p id="isolation-probe" style="display:none">Isolation probe</p><style>@import url("https://remote.invalid/style.css"); #isolation-probe { display:none }</style><script>globalThis.executed = true; parent.drelwick.project.open()</script><img src="https://remote.invalid/image" onerror="globalThis.executed = true" /><iframe src="https://remote.invalid/frame"></iframe><object data="file:///secret"></object></body>',
      );
    });
    await expect(frame.locator("#isolation-probe")).toHaveText(
      "Isolation probe",
    );
    await expect(frame.locator("#isolation-probe")).toBeVisible();
    expect(
      await frame
        .locator("body")
        .evaluate(
          () => (globalThis as unknown as Record<string, unknown>).executed,
        ),
    ).toBeUndefined();
    expect(requests).toEqual([]);
    expect(page.url()).toBe(mainUrl);
    await dialog.getByRole("button", { name: "Close preview" }).click();
  } finally {
    await application?.close();
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});

for (const format of ["txt", "md", "html"]) {
  test(`imports ${format} offline through shared preview, edits, saves and reopens`, async () => {
    const scratch = await mkdtemp(join(tmpdir(), "drelwick-text-e2e-"));
    let application: ElectronApplication | undefined;
    const source = join(scratch, `novel.${format}`);
    const destination = join(scratch, "imported");
    const prose = "Café “hello” — – Ελληνικά 日本語 العربية 🌱 é";
    const bytes = Buffer.from(
      format === "html"
        ? `<h1>Chapter One</h1><p>${prose}</p>`
        : format === "md"
          ? `# Chapter One\n\n${prose}`
          : `Chapter One\n\n${prose}`,
      "utf8",
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
      const commit = preview.getByRole("button", {
        name: "Choose destination and import",
      });
      await expect(commit).toBeDisabled();
      await preview.getByLabel("Chapter 1 title").fill("Reviewed chapter");
      for (const decision of await preview.getByRole("checkbox").all())
        await decision.check();
      expect(await readFile(source)).toEqual(bytes);
      expect(await readdir(destination)).toEqual([]);
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, destination);
      await commit.click();
      await expect(preview).not.toBeVisible();
      const editor = page.locator(".ProseMirror");
      await expect(editor).toHaveText(`Chapter One${prose}`);
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(" Edited.");
      await page
        .getByRole("button", { name: "Save chapter", exact: true })
        .click();
      await expect(page.getByLabel("Chapter save status")).toHaveText(
        "All changes saved",
      );
      await application.close();
      application = undefined;
      const restarted = await launchApplication(join(scratch, "user-data"));
      application = restarted.application;
      await restarted.page.context().setOffline(true);
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, destination);
      await restarted.page
        .getByRole("button", { name: "Open project", exact: true })
        .click();
      await expect(restarted.page.locator(".ProseMirror")).toHaveText(
        `Chapter One${prose} Edited.`,
      );
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
}
import { syntheticImage } from "../helpers/synthetic-images.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const desktopDirectory = join(repositoryRoot, "apps", "desktop");

test("finds live prose, reviews whole-manuscript replacement and reopens formatted results", async () => {
  const fixture = await copyFixture("multi-chapter-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-search-e2e-"));
  let application: ElectronApplication | undefined;
  try {
    const manifest = JSON.parse(
      await readFile(join(fixture.projectPath, "project.json"), "utf8"),
    );
    const ids: string[] = manifest.manuscript.order;
    for (const id of ids) {
      const path = join(fixture.projectPath, "manuscript", `${id}.json`);
      const chapter = JSON.parse(await readFile(path, "utf8"));
      chapter.content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "silver moon", marks: [{ type: "bold" }] },
            ],
          },
          { type: "sceneBreak" },
        ],
      };
      await writeFile(path, JSON.stringify(chapter));
    }
    const launched = await launchApplication(join(scratch, "user-data"));
    application = launched.application;
    const page = launched.page;
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
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" newer prose");
    await page.keyboard.press("ControlOrMeta+f");
    const find = page.getByRole("region", {
      name: "Manuscript find and replace",
      exact: true,
    });
    await find.getByLabel("Find text", { exact: true }).fill("newer");
    await expect(find).toContainText("0 of 1 matches");
    await find.getByLabel("Find text", { exact: true }).fill("silver");
    await find.getByLabel("Search scope").selectOption("manuscript");
    await expect(find).toContainText("0 of 3 matches");
    await find.getByRole("button", { name: "Next match" }).click();
    await expect(find).toContainText("1 of 3 matches");
    await find.getByRole("button", { name: "Previous match" }).click();
    await expect(find).toContainText("3 of 3 matches");
    await find.getByLabel("Replacement text").fill("金色");
    await find.getByRole("button", { name: "Review replace all" }).click();
    await expect(find).toContainText(
      "whole manuscript: 3 matches in 3 chapters",
    );
    await page.screenshot({
      path: test.info().outputPath("manuscript-search-review.png"),
    });
    await find.getByRole("button", { name: "Confirm replace all" }).click();
    await expect(
      page.getByText(
        "Replaced 3 matches in 3 changed chapters. Pre-replacement history retained.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(editor).toContainText("金色 moon");
    for (const id of ids) {
      const chapter = JSON.parse(
        await readFile(
          join(fixture.projectPath, "manuscript", `${id}.json`),
          "utf8",
        ),
      );
      expect(chapter.content.content[0].content[0].marks).toEqual([
        { type: "bold" },
      ]);
      expect(JSON.stringify(chapter.content)).not.toContain("silver");
    }
    expect(
      await readFile(
        join(fixture.projectPath, "manuscript", `${ids[0]}.json`),
        "utf8",
      ),
    ).toContain("newer prose");
    await application.close();
    application = undefined;
    const restarted = await launchApplication(join(scratch, "user-data"));
    application = restarted.application;
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await restarted.page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(restarted.page.locator(".ProseMirror")).toContainText(
      "金色 moon",
    );
    await expect(restarted.page.locator(".ProseMirror")).toContainText(
      "newer prose",
    );
  } finally {
    await application?.close();
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});

test("imports local images, edits semantics and reopens a portable project offline", async () => {
  const fixture = await copyFixture("minimal-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-image-e2e-"));
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
  await expect(page).toHaveTitle("Drelwick");
  expect(await application.evaluate(({ app }) => app.getName())).toBe(
    "Drelwick",
  );
  expect(await application.evaluate(({ app }) => app.getPath("userData"))).toBe(
    userDataDirectory,
  );
  await expect(
    page.getByRole("heading", { name: "Your manuscript workspace" }),
  ).toBeVisible();
  return { application, page };
}

test("validates Windows authoring, autosave, formatting, ordering and restart", async () => {
  const testDirectory = await mkdtemp(join(tmpdir(), "drelwick-e2e-"));
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
    join(tmpdir(), "drelwick-recovery-e2e-"),
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
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-docx-e2e-"));
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

test("organises formatted chapters offline with duplicate split merge status and restart", async () => {
  const fixture = await copyFixture("multi-chapter-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-organisation-e2e-"));
  let application: ElectronApplication | undefined;
  try {
    const manifest = JSON.parse(
      await readFile(join(fixture.projectPath, "project.json"), "utf8"),
    );
    const originalId: string = manifest.manuscript.order[0];
    const path = join(fixture.projectPath, "manuscript", originalId + ".json");
    const original = JSON.parse(await readFile(path, "utf8"));
    original.title = "First";
    original.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Left Right", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    await writeFile(path, JSON.stringify(original));
    const launched = await launchApplication(join(scratch, "user-data"));
    application = launched.application;
    const page = launched.page;
    await page.context().setOffline(true);
    page.on("dialog", (dialog) => dialog.accept());
    await application.evaluate(({ dialog }, projectPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [projectPath],
      });
    }, fixture.projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(page.locator(".ProseMirror")).toHaveText("Left Right");
    await page.getByLabel("Actions for First", { exact: true }).click();
    await page
      .getByLabel("Status for First", { exact: true })
      .selectOption("final");
    await expect(
      page.getByLabel("Status for First", { exact: true }),
    ).toHaveValue("final");
    await page
      .getByRole("button", { name: "Duplicate", exact: true })
      .first()
      .click();
    await expect(page.locator(".chapter-select")).toHaveCount(4);
    await expect(page.locator(".chapter-select").nth(1)).toContainText(
      "First Copy",
    );
    await expect(page.locator(".ProseMirror")).toHaveText("Left Right");
    await page.locator(".chapter-select").first().click();
    await expect(page.locator(".ProseMirror")).toHaveText("Left Right");
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+Home");
    for (let index = 0; index < 5; index++)
      await page.keyboard.press("ArrowRight");
    const menu = page.locator(".chapter-menu").first();
    if ((await menu.getAttribute("open")) === null)
      await page.getByLabel("Actions for First", { exact: true }).click();
    await page
      .getByRole("button", { name: "Split at cursor", exact: true })
      .first()
      .click();
    const splitDialog = page.getByRole("dialog", { name: "Split chapter" });
    await expect(menu).not.toHaveAttribute("open");
    await expect(splitDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(splitDialog).not.toBeVisible();
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await page.keyboard.type("X");
    await expect(page.locator(".ProseMirror")).toHaveText("Left XRight");
    await page.keyboard.press("Backspace");
    await expect(page.locator(".ProseMirror")).toHaveText("Left Right");
    await page.getByLabel("Actions for First", { exact: true }).click();
    await page
      .getByRole("button", { name: "Split at cursor", exact: true })
      .first()
      .click();
    await splitDialog
      .getByRole("button", { name: "Split chapter", exact: true })
      .click();
    await expect(splitDialog).not.toBeVisible();
    await expect(menu).not.toHaveAttribute("open");
    await expect(page.locator(".chapter-select")).toHaveCount(5);
    await expect(page.locator(".chapter-select").nth(1)).toContainText(
      "First Continued",
    );
    await expect(page.locator(".ProseMirror")).toHaveText("Right");
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await page.keyboard.type("X");
    await expect(page.locator(".ProseMirror")).toHaveText("XRight");
    await page.keyboard.press("Backspace");
    await expect(page.locator(".ProseMirror")).toHaveText("Right");
    await page
      .getByLabel("Select First Continued for merge", { exact: true })
      .check();
    await page.getByLabel("Select First for merge", { exact: true }).check();
    await page.getByRole("button", { name: "Merge selected chapters" }).click();
    await expect(page.locator(".chapter-select")).toHaveCount(4);
    await expect(page.locator(".ProseMirror p")).toHaveCount(2);
    const merged = JSON.parse(await readFile(path, "utf8"));
    expect(merged.id).toBe(originalId);
    expect(merged.status).toBe("final");
    expect(merged.content).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Left ", marks: [{ type: "italic" }] },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Right", marks: [{ type: "italic" }] },
          ],
        },
      ],
    });
    await application.close();
    application = undefined;
    const restarted = await launchApplication(join(scratch, "user-data"));
    application = restarted.application;
    await restarted.page.context().setOffline(true);
    await application.evaluate(({ dialog }, projectPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [projectPath],
      });
    }, fixture.projectPath);
    await restarted.page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(restarted.page.locator(".chapter-select")).toHaveCount(4);
    await expect(
      restarted.page.locator(".chapter-select").first(),
    ).toContainText("final");
    await expect(restarted.page.locator(".ProseMirror p")).toHaveCount(2);
    await expect(
      restarted.page.locator(".chapter-select").nth(1),
    ).toContainText("First Copy");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(merged);
  } finally {
    await application?.close();
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});

test("Chapter History preserves unsaved B before restoring rich OLD and remains usable after restart", async () => {
  const fixture = await copyFixture("formatted-book");
  const scratch = await mkdtemp(join(tmpdir(), "drelwick-history-e2e-"));
  let application: ElectronApplication | undefined;
  const chapterId = "00000000-0000-4000-8000-000000000311";
  const snapshotId = "00000000-0000-4000-8000-000000000399";
  const chapterPath = join(
    fixture.projectPath,
    "manuscript",
    `${chapterId}.json`,
  );
  const historyPath = join(
    fixture.projectPath,
    ".history",
    "snapshots",
    chapterId,
  );
  try {
    const chapter = JSON.parse(await readFile(chapterPath, "utf8"));
    const historical = chapter.content;
    await mkdir(historyPath, { recursive: true });
    await writeFile(
      join(historyPath, `${snapshotId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        id: snapshotId,
        chapterId,
        created: new Date().toISOString(),
        reason: "before-replace",
        content: historical,
      }),
    );
    await writeFile(
      chapterPath,
      JSON.stringify({
        ...chapter,
        modified: new Date().toISOString(),
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Persisted A" }],
            },
          ],
        },
      }),
    );
    const launched = await launchApplication(join(scratch, "user-data"));
    application = launched.application;
    const page = launched.page;
    await page.context().setOffline(true);
    const requests: string[] = [];
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
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await expect(editor).toHaveText("Persisted A");
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await editor.fill("Unsaved B ???");
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "Unsaved changes",
    );
    expect(
      JSON.parse(await readFile(chapterPath, "utf8")).content.content[0]
        .content[0].text,
    ).toBe("Persisted A");
    await page.getByLabel("Actions for Current Formatting").click();
    await page
      .getByRole("button", { name: "Chapter History", exact: true })
      .click();
    const history = page.getByRole("dialog", {
      name: "Chapter History",
      exact: true,
    });
    await history.getByRole("button", { name: new RegExp(snapshotId) }).click();
    await expect(history.getByLabel("Snapshot preview")).toContainText(
      "A semantic heading",
    );
    await expect(
      history.locator("blockquote strong em, blockquote em strong"),
    ).toHaveCount(1);
    await expect(page.getByLabel("Chapter save status")).toHaveText(
      "Unsaved changes",
    );
    await history
      .getByRole("button", { name: "Restore snapshot", exact: true })
      .click();
    await expect(
      history.getByText(/current content, including unsaved edits/),
    ).toBeVisible();
    expect(
      JSON.parse(await readFile(chapterPath, "utf8")).content.content[0]
        .content[0].text,
    ).toBe("Persisted A");
    await history
      .getByRole("button", { name: "Confirm restore", exact: true })
      .click();
    await expect(
      page.getByText(
        "Snapshot restored. Previous content is preserved in Chapter History.",
      ),
    ).toBeVisible();
    const stored = JSON.parse(await readFile(chapterPath, "utf8"));
    expect(stored.content).toEqual(historical);
    expect(stored.id).toBe(chapterId);
    const snapshots = await Promise.all(
      (await readdir(historyPath))
        .filter((name) => name.endsWith(".json"))
        .map(async (name) =>
          JSON.parse(await readFile(join(historyPath, name), "utf8")),
        ),
    );
    const safety = snapshots.find(
      (snapshot) =>
        snapshot.id !== snapshotId &&
        snapshot.reason === "before-replace" &&
        JSON.stringify(snapshot.content).includes("Unsaved B ???"),
    );
    expect(safety).toBeDefined();
    expect(snapshots.some((snapshot) => snapshot.id === snapshotId)).toBe(true);
    expect(requests).toEqual([]);
    await history.getByRole("button", { name: "Close history" }).click();
    await application.close();
    application = undefined;
    const restarted = await launchApplication(join(scratch, "user-data"));
    application = restarted.application;
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await restarted.page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(restarted.page.locator(".ProseMirror")).toContainText(
      "A semantic heading",
    );
    await restarted.page.getByLabel("Actions for Current Formatting").click();
    await restarted.page
      .getByRole("button", { name: "Chapter History", exact: true })
      .click();
    const reopened = restarted.page.getByRole("dialog", {
      name: "Chapter History",
      exact: true,
    });
    await reopened.getByRole("button", { name: new RegExp(safety.id) }).click();
    await expect(reopened.getByLabel("Snapshot preview")).toHaveText(
      "Unsaved B ???",
    );
    await expect(
      reopened.locator(`time[datetime="${safety.created}"]`).first(),
    ).toBeVisible();
    await reopened.getByRole("button", { name: "Close history" }).click();
  } finally {
    await application?.close();
    await fixture.cleanup();
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
