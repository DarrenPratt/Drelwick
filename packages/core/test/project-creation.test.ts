import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProject, type ProjectCreationFileSystem } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sarel-create-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("project creation", () => {
  it("creates validated project and book files with metadata", async () => {
    const parent = await createTemporaryDirectory();
    const projectPath = join(parent, "novel");

    const result = await createProject({
      title: "The Example",
      author: "Author",
      language: "en-GB",
      projectPath,
    });

    expect(result.project.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.project.manuscript.order).toEqual([]);
    expect(result.book.title).toBe("The Example");
    await expect(
      readFile(join(projectPath, "project.json"), "utf8"),
    ).resolves.toContain('"bookFile": "book.json"');
    await expect(
      readFile(join(projectPath, "book.json"), "utf8"),
    ).resolves.toContain('"author": "Author"');
  });

  it("rejects a non-empty destination without modifying its contents", async () => {
    const projectPath = await createTemporaryDirectory();
    const fileSystem = {
      pathExists: async () => true,
      mkdir: async () => undefined,
      readdir: async () => ["existing.txt"],
      writeJson: vi.fn(),
      remove: vi.fn(),
    } satisfies ProjectCreationFileSystem;

    await expect(
      createProject(
        {
          title: "The Example",
          author: "Author",
          language: "en-GB",
          projectPath,
        },
        fileSystem,
      ),
    ).rejects.toMatchObject({ code: "PROJECT_DESTINATION_NOT_EMPTY" });
    expect(fileSystem.writeJson).not.toHaveBeenCalled();
    expect(fileSystem.remove).not.toHaveBeenCalled();
  });

  it("cleans only artifacts created by a failed operation", async () => {
    const parent = await createTemporaryDirectory();
    const projectPath = join(parent, "novel");
    const removed: string[] = [];
    let writes = 0;
    const fileSystem: ProjectCreationFileSystem = {
      pathExists: async () => false,
      mkdir: async () => undefined,
      readdir: async () => [],
      writeJson: async () => {
        writes += 1;
        if (writes === 2) {
          throw new Error("disk full");
        }
      },
      remove: async (path) => {
        removed.push(path);
      },
    };

    await expect(
      createProject(
        {
          title: "The Example",
          author: "Author",
          language: "en-GB",
          projectPath,
        },
        fileSystem,
      ),
    ).rejects.toMatchObject({ code: "PROJECT_CREATE_FAILED" });
    expect(removed).toContain(projectPath);
    expect(removed).toContain(join(projectPath, "project.json"));
    expect(removed).not.toContain(join(parent, "unrelated.txt"));
  });

  it("rejects relative project paths", async () => {
    await expect(
      createProject({
        title: "The Example",
        author: "Author",
        language: "en-GB",
        projectPath: "relative/project",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_PATH_INVALID" });
  });
});
