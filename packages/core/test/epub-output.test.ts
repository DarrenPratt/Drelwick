import { afterEach, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import {
  assembleBook,
  generateEpub,
  inspectEpubDestination,
  writeEpubAtomically,
} from "../src/index.js";
import { inspectSnapshot } from "../src/project-snapshot.js";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});

it("publishes atomically, preserves the previous EPUB on failures, and supports cancellation", async () => {
  const copy = await copyFixture("minimal-book");
  copies.push(copy);
  const destination = join(copy.projectPath, "..", "book.epub");
  const source = await inspectSnapshot(copy.projectPath);
  const output = generateEpub(await assembleBook(copy.projectPath));
  const selected = await inspectEpubDestination(destination, copy.projectPath);

  await writeEpubAtomically(selected, output.bytes, { overwrite: false });
  const original = Buffer.from(await readFile(destination));
  expect(original).toEqual(Buffer.from(output.bytes));

  const existing = await inspectEpubDestination(destination, copy.projectPath);
  await expect(
    writeEpubAtomically(existing, output.bytes, { overwrite: false }),
  ).rejects.toMatchObject({ code: "EPUB_EXPORT_OVERWRITE" });

  for (const phase of ["written", "commit"] as const) {
    await expect(
      writeEpubAtomically(existing, output.bytes, {
        overwrite: true,
        checkpoint: async (current) => {
          if (current === phase) throw new Error("simulated disk failure");
        },
      }),
    ).rejects.toMatchObject({ code: "EPUB_EXPORT_WRITE" });
    expect(await readFile(destination)).toEqual(original);
    expect(await inspectSnapshot(copy.projectPath)).toEqual(source);
    expect(
      (await readdir(dirname(copy.projectPath))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  }

  const abort = new AbortController();
  await expect(
    writeEpubAtomically(existing, output.bytes, {
      overwrite: true,
      signal: abort.signal,
      checkpoint: async () => abort.abort(),
    }),
  ).rejects.toMatchObject({ code: "EPUB_EXPORT_CANCELLED" });
  expect(await readFile(destination)).toEqual(original);

  await writeEpubAtomically(existing, output.bytes, { overwrite: true });
  expect(await readFile(destination)).toEqual(Buffer.from(output.bytes));
});

it("rejects EPUB destinations inside a project or with an invalid extension", async () => {
  const copy = await copyFixture("minimal-book");
  copies.push(copy);
  const source = await inspectSnapshot(copy.projectPath);
  for (const path of [
    join(copy.projectPath, "book.epub"),
    join(copy.projectPath, "..", "book.docx"),
  ]) {
    await expect(
      inspectEpubDestination(path, copy.projectPath),
    ).rejects.toMatchObject({ code: "EPUB_EXPORT_DESTINATION" });
  }
  expect(await inspectSnapshot(copy.projectPath)).toEqual(source);
});
