import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  BookMetadataSchema,
  ChapterFileSchema,
  HistorySnapshotSchema,
  ManuscriptDocumentSchema,
  ProjectConfigSchema,
} from "@drelwick/project-model";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyFixture,
  fixturePath,
  type FixtureCopy,
  type FixtureName,
} from "../../../tests/helpers/fixture-projects.js";
import { openProject, scanRecoveryCandidates } from "../src/index.js";

const execFileAsync = promisify(execFile);
const copies: FixtureCopy[] = [];
const invalidChapterId = "00000000-0000-4000-8000-000000000511";
const recoveryChapterId = "00000000-0000-4000-8000-000000000611";
const recoverySnapshotId = "00000000-0000-4000-8000-000000000691";
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

afterEach(async () => {
  await Promise.all(copies.splice(0).map((fixture) => fixture.cleanup()));
});

async function copiedFixture(name: FixtureName): Promise<FixtureCopy> {
  const fixture = await copyFixture(name);
  copies.push(fixture);
  return fixture;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("canonical project fixtures", () => {
  it.each([
    ["minimal-book", 1],
    ["multi-chapter-book", 3],
    ["formatted-book", 1],
    ["unicode-book", 1],
    ["recovery-project", 1],
  ] as const)("opens the valid %s fixture", async (name, chapterCount) => {
    const fixture = await copiedFixture(name);
    const opened = await openProject(fixture.projectPath, {
      rebuildSummaries: true,
    });
    expect(opened.chapters).toHaveLength(chapterCount);
    expect(opened.project.manuscript.order).toHaveLength(chapterCount);
  });

  it("preserves manifest ordering in the multi-chapter fixture", async () => {
    const fixture = await copiedFixture("multi-chapter-book");
    const opened = await openProject(fixture.projectPath, {
      rebuildSummaries: true,
    });
    expect(opened.chapters.map((chapter) => chapter.title)).toEqual([
      "An Ordered Beginning",
      "The Second Step",
      "A Clear Ending",
    ]);
  });

  it("uses only nodes and marks accepted by the current manuscript schema", async () => {
    const fixture = await copiedFixture("formatted-book");
    const opened = await openProject(fixture.projectPath, {
      rebuildSummaries: true,
    });
    const chapterId = opened.project.manuscript.order[0];
    expect(chapterId).toBeTruthy();
    const chapter = ChapterFileSchema.parse(
      await readJson(
        join(fixture.projectPath, "manuscript", `${chapterId}.json`),
      ),
    );
    expect(ManuscriptDocumentSchema.safeParse(chapter.content).success).toBe(
      true,
    );
    expect(chapter.content.content?.map((node) => node["type"])).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "blockquote",
      "bulletList",
      "orderedList",
      "codeBlock",
      "sceneBreak",
      "horizontalRule",
    ]);
  });

  it("preserves Unicode punctuation and non-ASCII text when copied", async () => {
    const relativeChapter = join(
      "manuscript",
      "00000000-0000-4000-8000-000000000411.json",
    );
    const canonical = await readFile(
      join(fixturePath("unicode-book"), relativeChapter),
      "utf8",
    );
    const fixture = await copiedFixture("unicode-book");
    const copied = await readFile(
      join(fixture.projectPath, relativeChapter),
      "utf8",
    );
    expect(copied).toBe(canonical);
    expect(copied).toContain("“Bonjour,”");
    expect(copied).toContain("l’autrice — déjà");
    expect(copied).toContain("vingt–deux");
    expect(copied).toContain("Español: mañana");
    expect(copied).toContain("Καλημέρα κόσμε");
    expect(copied).toContain("こんにちは世界");
    expect(copied).toContain("مرحبًا بالعالم");
  });

  it("copies fixtures into isolated, independently mutable directories", async () => {
    const canonicalBookPath = join(fixturePath("minimal-book"), "book.json");
    const canonical = await readFile(canonicalBookPath, "utf8");
    const first = await copiedFixture("minimal-book");
    const second = await copiedFixture("minimal-book");
    expect(first.projectPath).not.toBe(second.projectPath);

    await writeFile(
      join(first.projectPath, "book.json"),
      canonical.replace("Minimal Fixture", "Modified Copy"),
      "utf8",
    );

    expect(await readFile(canonicalBookPath, "utf8")).toBe(canonical);
    expect(await readFile(join(second.projectPath, "book.json"), "utf8")).toBe(
      canonical,
    );
  });
});

describe("intentional invalid fixture", () => {
  it("fails only for the duplicate manifest order", async () => {
    const source = fixturePath("invalid-project");
    expect(
      BookMetadataSchema.safeParse(await readJson(join(source, "book.json")))
        .success,
    ).toBe(true);
    expect(
      ChapterFileSchema.safeParse(
        await readJson(join(source, "manuscript", `${invalidChapterId}.json`)),
      ).success,
    ).toBe(true);
    const project = ProjectConfigSchema.safeParse(
      await readJson(join(source, "project.json")),
    );
    expect(project.success).toBe(false);
    if (!project.success)
      expect(project.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["manuscript", "order"],
          message: "Manuscript order must not contain duplicate chapter IDs",
        }),
      );

    const fixture = await copiedFixture("invalid-project");
    await expect(openProject(fixture.projectPath)).rejects.toMatchObject({
      code: "PROJECT_ORDER_INVALID",
      message: "Invalid manuscript chapter order in project.json",
    });
  });
});

describe("recovery fixture", () => {
  const relativeSnapshotPath = [
    "tests",
    "fixtures",
    "recovery-project",
    ".history",
    "snapshots",
    recoveryChapterId,
    `${recoverySnapshotId}.json`,
  ].join("/");

  it("contains one newer, valid history recovery candidate", async () => {
    const fixture = await copiedFixture("recovery-project");
    const result = await scanRecoveryCandidates(fixture.projectPath);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      chapterId: recoveryChapterId,
      created: "2026-01-06T12:05:00.000Z",
      source: "history",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Newer synthetic text available for recovery.",
              },
            ],
          },
        ],
      },
    });
    expect(
      HistorySnapshotSchema.safeParse(
        await readJson(join(repositoryRoot, relativeSnapshotPath)),
      ).success,
    ).toBe(true);
  });

  it("keeps the required recovery history file tracked and unignored", async () => {
    const options = { cwd: repositoryRoot, encoding: "utf8" as const };
    const tracked = await execFileAsync(
      "git",
      ["ls-files", "--error-unmatch", "--", relativeSnapshotPath],
      options,
    );
    expect(tracked.stdout.trim().replaceAll("\\", "/")).toBe(
      relativeSnapshotPath,
    );
    const ignoreRule = await execFileAsync(
      "git",
      ["check-ignore", "-v", "--no-index", "--", relativeSnapshotPath],
      options,
    );
    expect(ignoreRule.stdout).toContain("!tests/fixtures/**/.history/**");
  });
});
