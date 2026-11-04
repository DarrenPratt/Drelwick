import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { editorialProject } from "../helpers/editorial-project.js";
import { revisionProject } from "../helpers/revision-project.js";

test("R03/R04 retained revision comments restore their recorded targets and mode-off collisions require consent", async () => {
  const fixture = await revisionProject(),
    scratch = await mkdtemp(join(tmpdir(), "drelwick-revision-comments-")),
    desktop = resolve("apps/desktop");
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await app.firstWindow();
    await page.context().setOffline(true);
    page.on("dialog", (dialog) => void dialog.accept());
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, fixture.projectPath);
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Revision tracking and review",
    });
    await panel.getByText("Review pending changes", { exact: true }).click();
    const deletion = panel.getByRole("article", {
      name: "Pending delete",
      exact: true,
    });
    await deletion
      .getByRole("button", { name: "Comment on original text" })
      .click();
    const sidebar = page.getByRole("complementary", {
      name: "Comments and annotations",
    });
    await expect(
      sidebar.getByText(/Commenting on retained original/),
    ).toBeVisible();
    await sidebar
      .getByRole("textbox", { name: "Comment or note", exact: true })
      .fill("Synthetic retained revision discussion");
    await sidebar
      .getByRole("button", { name: "Add annotation", exact: true })
      .click();
    await expect(
      sidebar.getByText("Synthetic retained revision discussion", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("textbox", { name: "Comment or note", exact: true }),
    ).toHaveValue("");
    await deletion
      .getByRole("button", { name: "Review reject change", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Confirm revision decision" }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Confirm revision decision" })
      .getByRole("button", { name: "Confirm revision decision", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("1 pending changes");
    await expect
      .poll(async () => {
        const state = JSON.parse(await readFile(fixture.editorialPath, "utf8")),
          thread = state.threads.find(
            (thread: { comments: { body: string }[] }) =>
              thread.comments.some(
                (c) => c.body === "Synthetic retained revision discussion",
              ),
          );
        const annotation = state.annotations.find(
          (annotation: { threadId: string }) =>
            annotation.threadId === thread?.id,
        );
        return state.anchors.find(
          (anchor: { id: string }) => anchor.id === annotation?.anchorId,
        )?.status;
      })
      .toBe("attached");
    await panel
      .getByRole("checkbox", { name: "Track changes in this chapter" })
      .uncheck();
    await expect(panel.getByRole("status")).toContainText("Tracking off");
    const editor = page.locator(".ProseMirror");
    await editor.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    const combine = page.getByRole("dialog", {
      name: "Combine affected changes",
    });
    await expect(combine).toBeVisible();
    await expect(combine.getByText(/Tracking is off/)).toBeVisible();
    await combine
      .getByRole("button", {
        name: "Review affected changes first",
        exact: true,
      })
      .click();
    await expect(editor).not.toContainText("PROPOSED_ONLXY");
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("R01–R06 native tracking groups typing, requires combine consent, persists and reviews through companion undo offline", async () => {
  test.setTimeout(90_000);
  const fixture = await editorialProject(),
    scratch = await mkdtemp(join(tmpdir(), "drelwick-revision-ui-"));
  const desktop = resolve("apps/desktop");
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      args: [desktop, `--user-data-dir=${join(scratch, "profile")}`],
      cwd: desktop,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    });
    const page = await app.firstWindow();
    await page.context().setOffline(true);
    page.on("dialog", (dialog) => void dialog.accept());
    await app.evaluate(({ dialog }, path) => {
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
    const panel = page.getByRole("region", {
      name: "Revision tracking and review",
    });
    await expect(panel).toBeVisible();
    await panel
      .getByRole("checkbox", { name: "Track changes in this chapter" })
      .check();
    await expect(panel.getByRole("status")).toContainText("Tracking on");
    await editor.click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.type("quick", { delay: 30 });
    await expect(panel.getByRole("status")).toContainText("1 pending changes");
    await expect(
      page.getByRole("dialog", { name: "Combine affected changes" }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Save chapter", exact: true })
      .click();
    const chapterPath = join(
      fixture.projectPath,
      "manuscript",
      `${fixture.chapterId}.json`,
    );
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(chapterPath, "utf8")).review.pending.length,
      )
      .toBe(1);
    await editor.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    const combine = page.getByRole("dialog", {
      name: "Combine affected changes",
    });
    await expect(combine).toBeVisible();
    await combine
      .getByRole("button", { name: "Cancel edit", exact: true })
      .click();
    await expect(editor).not.toContainText("quicXk");
    const oldId = JSON.parse(await readFile(chapterPath, "utf8")).review
      .pending[0].id as string;
    await editor.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    await expect(combine).toBeVisible();
    await combine
      .getByRole("button", {
        name: "Enable tracking and combine affected changes",
        exact: true,
      })
      .click();
    await expect(editor).toContainText("quicXk");
    await page
      .getByRole("button", { name: "Save chapter", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(chapterPath, "utf8")).review.pending[0]
            .supersedes,
      )
      .toEqual([oldId]);
    await panel.getByText("Review pending changes", { exact: true }).click();
    await panel.getByRole("button", { name: /Review reject all/ }).click();
    const review = page.getByRole("dialog", {
      name: "Confirm revision decision",
    });
    await expect(review).toBeVisible();
    await review.screenshot({
      path: test.info().outputPath("revision-review-dialog.png"),
    });
    await review
      .getByRole("button", { name: "Confirm revision decision", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("0 pending changes");
    await expect(editor).not.toContainText("quick");
    await expect(editor).toContainText("Publication control text.");
    await editor.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect(panel.getByRole("status")).toContainText("1 pending changes");
    await expect(editor).toContainText("quicXk");
    await page
      .getByRole("button", { name: "Save chapter", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(chapterPath, "utf8")).review.pending.length,
      )
      .toBe(1);
    await panel.screenshot({
      path: test.info().outputPath("revision-review.png"),
    });
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
