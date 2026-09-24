import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RecentProjects } from "../src/main/recent-projects.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "drelwick-recents-"));
  directories.push(root);
  const userData = join(root, "settings");
  const book = join(root, "book");
  await mkdir(book);
  return { root, userData, book, service: new RecentProjects(userData) };
}

it("starts empty, deduplicates canonical paths, refreshes titles and persists order/removal across restarts", async () => {
  const { root, userData, book, service } = await setup();
  expect(await service.list()).toEqual([]);
  const second = join(root, "second");
  await mkdir(second);
  await Promise.all([
    service.add(book, "First"),
    service.add(second, "Second"),
  ]);
  const original = (await service.list()).find(
    (entry) => entry.title === "First",
  );
  await service.add(join(book, "..", "book"), "Renamed");
  if (process.platform === "win32")
    await service.add(book.toUpperCase(), "Renamed");
  const restarted = new RecentProjects(userData);
  const entries = await restarted.list();
  expect(entries.map((entry) => entry.title)).toEqual(["Renamed", "Second"]);
  expect(entries[0]?.id).toBe(original?.id);
  await restarted.remove(entries[0]!.id);
  expect(
    (await new RecentProjects(userData).list()).map((entry) => entry.title),
  ).toEqual(["Second"]);
  expect(
    await readFile(join(userData, "recent-projects.json"), "utf8"),
  ).toContain('"schemaVersion": 1');
});

it("deduplicates a symlink alias and retains missing folders until explicitly removed", async () => {
  const { root, book, service } = await setup();
  const alias = join(root, "alias");
  await symlink(book, alias, process.platform === "win32" ? "junction" : "dir");
  await service.add(book, "Book");
  await service.add(alias, "Book");
  expect(await service.list()).toHaveLength(1);
  await rm(book, { recursive: true });
  const entries = await service.list();
  expect(entries).toHaveLength(1);
  await service.remove(entries[0]!.id);
  expect(await service.list()).toEqual([]);
});

it.each(["{broken", '{"schemaVersion":99,"projects":[]}'])(
  "preserves unreadable/unsupported settings: %s",
  async (contents) => {
    const { userData, book, service } = await setup();
    await mkdir(userData);
    const file = join(userData, "recent-projects.json");
    await writeFile(file, contents);
    await expect(service.list()).rejects.toThrow(
      "Unable to read recent projects",
    );
    await expect(service.add(book, "Book")).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(contents);
  },
);

it("preserves the previous list on write failure and accepts a subsequent retry", async () => {
  const { userData, book, service } = await setup();
  await service.add(book, "Original");
  const file = join(userData, "recent-projects.json");
  const before = await readFile(file, "utf8");
  const obstruction = `${file}.tmp`;
  await mkdir(obstruction);
  await expect(service.add(book, "Changed")).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe(before);
  await rm(obstruction, { recursive: true });
  await service.add(book, "Changed");
  expect((await service.list())[0]?.title).toBe("Changed");
});
