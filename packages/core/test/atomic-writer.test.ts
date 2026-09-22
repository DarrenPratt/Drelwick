import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AtomicWriterFileSystem,
  writeJsonAtomically,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sarel-atomic-"));
  temporaryDirectories.push(directory);
  return join(directory, "project.json");
}

describe("atomic JSON writer", () => {
  it("writes formatted JSON through a temporary file and replaces the target", async () => {
    const filePath = await createTemporaryFile();

    await writeJsonAtomically(filePath, { schemaVersion: 1, title: "Draft" });

    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{\n  "schemaVersion": 1,\n  "title": "Draft"\n}\n',
    );
    await expect(readFile(`${filePath}.tmp`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves the previous valid file when writing fails", async () => {
    const filePath = await createTemporaryFile();
    await writeFile(filePath, '{"title":"Previous"}\n', "utf8");
    const fileSystem: AtomicWriterFileSystem = {
      open: vi.fn(async () => {
        throw new Error("disk full");
      }),
      rename: vi.fn(),
      unlink: vi.fn(async () => undefined),
    };

    await expect(
      writeJsonAtomically(filePath, { title: "Replacement" }, fileSystem),
    ).rejects.toMatchObject({ code: "PROJECT_FILE_WRITE_FAILED" });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"title":"Previous"}\n',
    );
    expect(fileSystem.rename).not.toHaveBeenCalled();
  });

  it("preserves the previous valid file when rename fails", async () => {
    const filePath = await createTemporaryFile();
    await writeFile(filePath, '{"title":"Previous"}\n', "utf8");
    const fileSystem: AtomicWriterFileSystem = {
      open: async (path, flags) => {
        const { open } = await import("node:fs/promises");
        return open(path, flags);
      },
      rename: vi.fn(async () => {
        throw new Error("rename failed");
      }),
      unlink: async (path) => {
        const { unlink } = await import("node:fs/promises");
        await unlink(path);
      },
    };

    await expect(
      writeJsonAtomically(filePath, { title: "Replacement" }, fileSystem),
    ).rejects.toMatchObject({ code: "PROJECT_FILE_WRITE_FAILED" });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"title":"Previous"}\n',
    );
    await expect(readFile(`${filePath}.tmp`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports serialization failures without touching the target", async () => {
    const filePath = await createTemporaryFile();
    await writeFile(filePath, '{"title":"Previous"}\n', "utf8");
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(writeJsonAtomically(filePath, circular)).rejects.toMatchObject(
      {
        code: "PROJECT_FILE_WRITE_FAILED",
      },
    );
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"title":"Previous"}\n',
    );
  });
});

it("preserves a pre-existing temporary recovery file", async () => {
  const path = await createTemporaryFile();
  await writeFile(`${path}.tmp`, "recoverable data");
  await expect(writeJsonAtomically(path, {})).rejects.toMatchObject({
    code: "PROJECT_FILE_WRITE_FAILED",
  });
  expect(await readFile(`${path}.tmp`, "utf8")).toBe("recoverable data");
});
