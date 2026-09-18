import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createHistorySnapshot } from "../src/history.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const document = {
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "bookeditor-history-"));
  directories.push(root);
  return root;
}

it("creates validated snapshots under .history with chapter metadata", async () => {
  const root = await setup();
  const snapshot = await createHistorySnapshot({
    projectPath: root,
    chapterId: "123e4567-e89b-42d3-a456-426614174001",
    document,
    now: "2026-09-18T16:00:00.000Z",
  });
  expect(snapshot).toMatchObject({
    chapterId: "123e4567-e89b-42d3-a456-426614174001",
    created: "2026-09-18T16:00:00.000Z",
    reason: "interval",
  });
  const files = await readdir(
    join(root, ".history", "snapshots", snapshot!.chapterId),
  );
  expect(files).toHaveLength(1);
  expect(
    JSON.parse(
      await readFile(
        join(root, ".history", "snapshots", snapshot!.chapterId, files[0]!),
        "utf8",
      ),
    ),
  ).toEqual(snapshot);
});

it("suppresses identical and too-frequent snapshots", async () => {
  const root = await setup();
  const input = {
    projectPath: root,
    chapterId: "123e4567-e89b-42d3-a456-426614174001",
    document,
  };
  expect(
    await createHistorySnapshot({ ...input, now: "2026-09-18T16:00:00.000Z" }),
  ).not.toBeNull();
  expect(
    await createHistorySnapshot({ ...input, now: "2026-09-18T16:01:00.000Z" }),
  ).toBeNull();
  expect(
    await createHistorySnapshot({
      ...input,
      document: { ...document, content: [{ type: "paragraph" }] },
      now: "2026-09-18T16:02:00.000Z",
    }),
  ).toBeNull();
  expect(
    await createHistorySnapshot({
      ...input,
      document: { ...document, content: [{ type: "paragraph" }] },
      now: "2026-09-18T16:06:00.000Z",
    }),
  ).not.toBeNull();
});

it("ignores invalid history files and reports write failures", async () => {
  const root = await setup();
  const directory = join(
    root,
    ".history",
    "snapshots",
    "123e4567-e89b-42d3-a456-426614174001",
  );
  const fs = await import("node:fs/promises");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, "broken.json"), "{}", "utf8");
  await expect(
    createHistorySnapshot({
      projectPath: root,
      chapterId: "123e4567-e89b-42d3-a456-426614174001",
      document,
    }),
  ).resolves.not.toBeNull();
  await expect(
    createHistorySnapshot(
      {
        projectPath: root,
        chapterId: "123e4567-e89b-42d3-a456-426614174001",
        document,
        now: "2026-09-18T17:00:00.000Z",
      },
      {
        mkdir: async () => undefined,
        readdir: async () => [],
        readFile: async () => "",
        writeJson: async () => {
          throw new Error("disk full");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "HISTORY_SNAPSHOT_WRITE_FAILED" });
});
