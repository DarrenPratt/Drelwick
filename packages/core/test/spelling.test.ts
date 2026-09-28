import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { SpellingService, type SpellingAdapter } from "../src/spelling.js";
import { createLocalChecker } from "../src/hunspell.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "drelwick-spelling-"));
  directories.push(path);
  const adapter = {
    available: vi.fn(
      async (language: string) => language === "en-US" || language === "en-GB",
    ),
    check: vi.fn(async (language: string, words: string[]) =>
      words.map((word) => word === (language === "en-US" ? "color" : "colour")),
    ),
    suggest: vi.fn(async () => ["color"]),
  } satisfies SpellingAdapter;
  return { path, adapter, service: new SpellingService(path, adapter) };
}

it("persists explicit language and exact personal words across service restarts; serializes concurrent updates", async () => {
  const { path, adapter, service } = await fixture();
  expect((await service.get()).language).toBe("en-US");
  await Promise.all([
    service.update({ operation: "add", word: "Drelwick" }),
    service.update({ operation: "add", word: "Élan" }),
    service.update({ operation: "language", language: "en-GB" }),
  ]);
  await service.update({ operation: "add", word: "Drelwick" });
  const restarted = new SpellingService(path, adapter);
  expect(await restarted.get()).toMatchObject({
    language: "en-GB",
    words: ["Drelwick", "Élan"],
  });
  expect(
    await restarted.check("en-GB", [
      "colour",
      "color",
      "Drelwick",
      "drelwick",
      "Élan",
    ]),
  ).toEqual({ available: true, incorrect: ["color", "drelwick"] });
  expect(adapter.check).toHaveBeenLastCalledWith("en-GB", [
    "colour",
    "color",
    "drelwick",
  ]);
  expect(await restarted.suggest("en-GB", "Drelwick")).toEqual([]);
  await restarted.update({ operation: "remove", word: "Drelwick" });
  expect((await new SpellingService(path, adapter).get()).words).toEqual([
    "Élan",
  ]);
  expect(await restarted.suggest("en-GB", "Drelwick")).toEqual(["color"]);
});

it("reports unavailable and changed languages without checking or offering stale suggestions", async () => {
  const { service, adapter } = await fixture();
  await service.update({ operation: "language", language: "fr-FR" });
  expect(await service.check("fr-FR", ["bonjour"])).toEqual({
    available: false,
    incorrect: [],
  });
  expect(await service.check("en-US", ["color"])).toEqual({
    available: false,
    incorrect: [],
  });
  expect(await service.suggest("en-US", "colur")).toEqual([]);
  expect(adapter.check).not.toHaveBeenCalled();
  expect(adapter.suggest).not.toHaveBeenCalled();
  adapter.available.mockResolvedValue(false);
  expect(
    (await service.get()).languages.every((entry) => !entry.available),
  ).toBe(true);
});

it("preserves previous valid settings when an atomic save fails, and permits retry", async () => {
  const { path, adapter, service } = await fixture();
  await service.update({ operation: "add", word: "Drelwick" });
  const previous = await readFile(join(path, "spelling.json"), "utf8");
  const failing = new SpellingService(path, adapter, async () => {
    throw new Error("Synthetic write failure");
  });
  await expect(
    failing.update({ operation: "remove", word: "Drelwick" }),
  ).rejects.toThrow();
  expect(await readFile(join(path, "spelling.json"), "utf8")).toBe(previous);
  await service.update({ operation: "add", word: "Retried" });
  expect((await service.get()).words).toEqual(["Drelwick", "Retried"]);
});

it.each([
  "{invalid private content",
  JSON.stringify({
    schemaVersion: 2,
    language: "en-US",
    words: ["Privateword"],
  }),
])(
  "does not overwrite corrupt or future settings, or expose their payload",
  async (bytes) => {
    const { path, service } = await fixture();
    await writeFile(join(path, "spelling.json"), bytes);
    await expect(service.get()).rejects.toThrow(
      "Spelling settings could not be read",
    );
    await expect(
      service.update({ operation: "add", word: "Newword" }),
    ).rejects.toThrow("Spelling settings could not be read");
    expect(await readFile(join(path, "spelling.json"), "utf8")).toBe(bytes);
  },
);

it("checks and suggests with a deterministic synthetic Hunspell resource, without host dictionaries", () => {
  const checker = createLocalChecker({
    aff: Buffer.from("SET UTF-8\nTRY abcdefghijklmnopqrstuvwxyz\n"),
    dic: Buffer.from("3\nhello\nworld\ncolour\n"),
  });
  expect(checker.correct("hello")).toBe(true);
  expect(checker.correct("helo")).toBe(false);
  expect(checker.suggest("helo")).toContain("hello");
  expect(checker.correct("color")).toBe(false);
});
