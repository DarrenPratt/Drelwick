import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProjectLayout,
  PROJECT_DIRECTORIES,
  projectPathExists,
  resolveProjectPath,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bookeditor-layout-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("project directory layout", () => {
  it("creates every canonical directory in an empty destination", async () => {
    const projectRoot = join(await createTemporaryDirectory(), "project");

    await createProjectLayout(projectRoot);

    for (const directory of PROJECT_DIRECTORIES) {
      expect(await projectPathExists(join(projectRoot, directory))).toBe(true);
    }
  });

  it("allows an existing empty destination", async () => {
    const projectRoot = await createTemporaryDirectory();

    await createProjectLayout(projectRoot);

    expect(await projectPathExists(join(projectRoot, "manuscript"))).toBe(true);
  });

  it("preserves existing user data by rejecting non-empty destinations", async () => {
    const projectRoot = await createTemporaryDirectory();
    const existingFile = join(projectRoot, "keep-me.txt");
    await writeFile(existingFile, "existing data", "utf8");

    await expect(createProjectLayout(projectRoot)).rejects.toMatchObject({
      code: "PROJECT_DESTINATION_NOT_EMPTY",
    });
    await expect(readFile(existingFile, "utf8")).resolves.toBe("existing data");
  });

  it("reports a useful error when the destination is a file", async () => {
    const parent = await createTemporaryDirectory();
    const destination = join(parent, "not-a-directory");
    await writeFile(destination, "file", "utf8");

    await expect(createProjectLayout(destination)).rejects.toMatchObject({
      code: "PROJECT_LAYOUT_CREATE_FAILED",
    });
  });

  it("rejects relative roots and traversal paths", () => {
    expect(() => resolveProjectPath("relative-root", "manuscript")).toThrow(
      "absolute root",
    );
    expect(() =>
      resolveProjectPath("C:\\Projects\\Book", "../outside"),
    ).toThrow("safe relative child path");
    expect(() =>
      resolveProjectPath("C:\\Projects\\Book", "manuscript/../../outside"),
    ).toThrow("safe relative child path");
  });
});
