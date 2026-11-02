import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openProject } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("opens v3 and validates the editorial state against chapter v2", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-open-"));
  roots.push(root);
  await cp(
    new URL("../../../docs/examples/editorial-v1/project/", import.meta.url),
    root,
    { recursive: true },
  );
  const chapterPath = join(
    root,
    "manuscript",
    "00000000-0000-4000-8000-000000000002.json",
  );
  const chapter = JSON.parse(await readFile(chapterPath, "utf8")) as {
    content: unknown;
    review: { proposed: unknown };
  };
  chapter.content = chapter.review.proposed;
  Object.assign(chapter.review, { schemaVersion: 1, mode: "off", pending: [] });
  await writeFile(chapterPath, `${JSON.stringify(chapter, null, 2)}\n`);
  const opened = await openProject(root, { rebuildSummaries: true });
  expect(opened.project.schemaVersion).toBe(3);
  expect(opened.chapters).toHaveLength(1);
});

it("rejects pending revisions instead of opening a flattened chapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-pending-"));
  roots.push(root);
  await cp(
    new URL("../../../docs/examples/editorial-v1/project/", import.meta.url),
    root,
    { recursive: true },
  );
  await expect(
    openProject(root, { rebuildSummaries: true }),
  ).rejects.toMatchObject({
    code: "PROJECT_SCHEMA_INVALID",
  });
});
