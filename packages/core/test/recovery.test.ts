import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createProject,
  scanRecoveryCandidates,
  writeJsonAtomically,
} from "../src/index.js";
import { createUuid } from "@bookeditor/shared";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bookeditor-recovery-"));
  directories.push(root);
  const chapterId = createUuid();
  const project = await createProject({
    projectPath: root,
    title: "Recovery",
    author: "Author",
    language: "en-GB",
  });
  const chapter = {
    schemaVersion: 1,
    id: chapterId,
    type: "chapter",
    title: "Chapter",
    status: "draft",
    created: project.project.created,
    modified: "2026-09-18T16:00:00.000Z",
    content: { type: "doc", content: [{ type: "paragraph" }] },
  };
  await writeJsonAtomically(join(root, "project.json"), {
    ...project.project,
    manuscript: { order: [chapterId] },
  });
  await writeJsonAtomically(
    join(root, "manuscript", `${chapterId}.json`),
    chapter,
  );
  return { root, chapterId, chapter };
}

it("identifies newer valid temporary and history documents", async () => {
  const { root, chapterId, chapter } = await fixture();
  const temporary = {
    ...chapter,
    modified: "2026-09-18T16:05:00.000Z",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "temp" }] },
      ],
    },
  };
  await writeFile(
    join(root, "manuscript", `${chapterId}.json.tmp`),
    JSON.stringify(temporary),
    "utf8",
  );
  const historyPath = join(root, ".history", "snapshots", chapterId);
  await mkdir(historyPath, { recursive: true });
  await writeJsonAtomically(join(historyPath, `${createUuid()}.json`), {
    schemaVersion: 1,
    id: createUuid(),
    chapterId,
    created: "2026-09-18T16:10:00.000Z",
    reason: "manual",
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });

  const result = await scanRecoveryCandidates(root);
  expect(result.candidates.map(({ source }) => source)).toEqual([
    "history",
    "temporary",
  ]);
  expect(
    result.candidates.every((candidate) => candidate.chapterId === chapterId),
  ).toBe(true);
});

it("ignores invalid, tied, and older recovery data", async () => {
  const { root, chapterId, chapter } = await fixture();
  await writeFile(
    join(root, "manuscript", `${chapterId}.json.tmp`),
    "{ invalid",
    "utf8",
  );
  await writeFile(
    join(root, "manuscript", "not-a-uuid.json.tmp"),
    "{}",
    "utf8",
  );
  const historyPath = join(root, ".history", "snapshots", chapterId);
  await mkdir(historyPath, { recursive: true });
  for (const [index, created] of [
    "2026-09-18T15:59:00.000Z",
    "2026-09-18T16:00:00.000Z",
  ].entries()) {
    await writeJsonAtomically(join(historyPath, `${createUuid()}.json`), {
      schemaVersion: 1,
      id: createUuid(),
      chapterId,
      created,
      reason: "manual",
      content: chapter.content,
      index,
    });
  }

  await expect(scanRecoveryCandidates(root)).resolves.toEqual({
    candidates: [],
  });
});

it("does not modify the authoritative manuscript", async () => {
  const { root, chapterId } = await fixture();
  const path = join(root, "manuscript", `${chapterId}.json`);
  const before = await readFile(path, "utf8");
  await writeFile(
    `${path}.tmp`,
    JSON.stringify({
      schemaVersion: 1,
      id: chapterId,
      type: "chapter",
      title: "Chapter",
      status: "draft",
      created: "2026-09-18T16:00:00.000Z",
      modified: "2026-09-18T16:05:00.000Z",
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }),
    "utf8",
  );
  await scanRecoveryCandidates(root);
  expect(await readFile(path, "utf8")).toBe(before);
});
