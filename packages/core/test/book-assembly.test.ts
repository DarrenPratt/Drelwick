import { join } from "node:path";
import { mkdir, readFile, writeFile, rmdir, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
import {
  assembleBook,
  CHAPTER_CREATION_LOCK,
  importImageAsset,
  saveChapter,
  openProject,
  writeJsonAtomically,
  replaceManuscript,
} from "../src/index.js";
import { renderBook } from "@drelwick/renderer";
const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function fixture() {
  const copy = await copyFixture("multi-chapter-book");
  copies.push(copy);
  return copy.projectPath;
}
it("captures canonical order independently of filenames and repeats byte-identical output", async () => {
  const root = await fixture();
  const before = await readFile(join(root, "project.json"));
  const one = await assembleBook(root);
  const two = await assembleBook(root);
  const order = JSON.parse(before.toString()).manuscript.order as string[];
  expect(order).not.toEqual([...order].sort());
  expect(one.book.chapters.map((chapter) => chapter.id)).toEqual(order);
  expect(two).toEqual(one);
  expect(renderBook(one.book, { resolveAsset: () => undefined })).toEqual(
    renderBook(two.book, { resolveAsset: () => undefined }),
  );
  expect(await readFile(join(root, "project.json"))).toEqual(before);
  expect(JSON.stringify(one.book)).not.toContain(root);
});
it("holds the writer lock across all reads and releases it before subsequent saves", async () => {
  const root = await fixture();
  let attempts = 0;
  const one = await assembleBook(root, {
    checkpoint: async (id) => {
      attempts++;
      await expect(
        saveChapter({
          projectPath: root,
          chapterId: id,
          document: { type: "doc" },
        }),
      ).rejects.toMatchObject({ code: "PROJECT_BUSY" });
      await expect(assembleBook(root)).rejects.toMatchObject({
        code: "PROJECT_BUSY",
      });
    },
  });
  expect(attempts).toBe(3);
  await saveChapter({
    projectPath: root,
    chapterId: one.book.chapters[0]!.id,
    document: { type: "doc" },
  });
  const two = await assembleBook(root);
  expect(two.book.revision).not.toBe(one.book.revision);
  expect(one.book.chapters[0]!.document).not.toEqual(
    two.book.chapters[0]!.document,
  );
});

it("cannot observe a partially committed multi-chapter revision", async () => {
  const root = await fixture();
  const ids = (await openProject(root)).project.manuscript.order;
  const content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
    ],
  };
  for (const chapterId of ids)
    await saveChapter({ projectPath: root, chapterId, document: content });
  let checkpoints = 0;
  await replaceManuscript(
    {
      projectPath: root,
      expected: ids.map((id) => ({ id, content })),
      options: { query: "Before", matchCase: true, wholeWord: true },
      replacement: "After",
    },
    {
      afterWrite: async (index) => {
        checkpoints++;
        if (index === 0) {
          const first = await readFile(
            join(root, "manuscript", `${ids[0]}.json`),
            "utf8",
          );
          const second = await readFile(
            join(root, "manuscript", `${ids[1]}.json`),
            "utf8",
          );
          expect(first).toContain("After");
          expect(second).toContain("Before");
        }
        await expect(assembleBook(root)).rejects.toMatchObject({
          code: "PROJECT_BUSY",
        });
      },
    },
  );
  expect(checkpoints).toBe(3);
  const assembled = await assembleBook(root);
  for (const chapter of assembled.book.chapters) {
    expect(JSON.stringify(chapter.document)).toContain("After");
    expect(JSON.stringify(chapter.document)).not.toContain("Before");
  }
});
it("refuses a retained operation lock and recoverable temporary prose", async () => {
  const root = await fixture();
  const lock = join(root, CHAPTER_CREATION_LOCK);
  await mkdir(lock);
  await expect(assembleBook(root)).rejects.toMatchObject({
    code: "PROJECT_BUSY",
  });
  await rmdir(lock);
  const id = (await openProject(root)).project.manuscript.order[0]!;
  const temporary = join(root, "manuscript", `${id}.json.tmp`);
  await writeFile(temporary, "recoverable prose");
  await expect(assembleBook(root)).rejects.toMatchObject({
    code: "CHAPTER_RECOVERY_REQUIRED",
  });
  expect(await readFile(temporary, "utf8")).toBe("recoverable prose");
  await rm(temporary);
  expect((await assembleBook(root)).book.chapters).toHaveLength(3);
});
it("detects an external chapter or manifest change during capture", async () => {
  for (const target of ["chapter", "manifest"]) {
    const root = await fixture();
    let changed = false;
    await expect(
      assembleBook(root, {
        checkpoint: async (id) => {
          if (changed) return;
          changed = true;
          const path =
            target === "chapter"
              ? join(root, "manuscript", `${id}.json`)
              : join(root, "project.json");
          const value = JSON.parse(await readFile(path, "utf8"));
          if (target === "chapter") value.title = "Externally changed";
          else value.manuscript.order.reverse();
          await writeJsonAtomically(path, value);
        },
      }),
    ).rejects.toMatchObject({ code: "BOOK_REVISION_CHANGED" });
  }
});
it("validates assets by content, retains captured bytes and locates missing/invalid references", async () => {
  const root = await fixture();
  const sourcePath = join(root, "synthetic.png");
  await writeFile(sourcePath, await syntheticImage());
  const asset = await importImageAsset({ projectPath: root, sourcePath });
  const id = (await openProject(root)).project.manuscript.order[0]!;
  await saveChapter({
    projectPath: root,
    chapterId: id,
    document: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { assetId: asset.id, alt: "Synthetic image", size: "medium" },
        },
      ],
    },
  });
  const captured = await assembleBook(root);
  expect(captured.assets.get(asset.id)).toEqual(
    new Uint8Array(await syntheticImage()),
  );
  expect(captured.book.assets[0]).toMatchObject({
    status: "available",
    descriptor: { id: asset.id, mediaType: "image/png" },
  });
  const original = join(root, "assets", "images", asset.id, "original.png");
  await writeFile(original, "<svg onload='bad' />");
  const invalid = await assembleBook(root);
  expect(invalid.book.assets).toEqual([{ status: "invalid", id: asset.id }]);
  expect(
    renderBook(invalid.book, { resolveAsset: () => undefined }).diagnostics,
  ).toContainEqual(
    expect.objectContaining({
      code: "invalid-asset",
      chapterId: id,
      path: [0],
      assetId: asset.id,
    }),
  );
  expect(captured.assets.get(asset.id)).toEqual(
    new Uint8Array(await syntheticImage()),
  );
  await rm(join(root, "assets", "images", asset.id, "asset.json"));
  expect((await assembleBook(root)).book.assets).toEqual([
    { status: "missing", id: asset.id },
  ]);
});
it("rejects unsupported documents and unknown format versions without rewriting them", async () => {
  const root = await fixture();
  const session = await openProject(root);
  const path = join(
    root,
    "manuscript",
    `${session.project.manuscript.order[0]}.json`,
  );
  const chapter = JSON.parse(await readFile(path, "utf8"));
  chapter.content = { type: "doc", content: [{ type: "future-node" }] };
  await writeJsonAtomically(path, chapter);
  const before = await readFile(path);
  await expect(assembleBook(root)).rejects.toMatchObject({
    code: "CHAPTER_DOCUMENT_INVALID",
  });
  expect(await readFile(path)).toEqual(before);
  const manifestPath = join(root, "project.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.schemaVersion = 999;
  await writeJsonAtomically(manifestPath, manifest);
  await expect(assembleBook(root)).rejects.toBeDefined();
  expect(JSON.parse(await readFile(manifestPath, "utf8")).schemaVersion).toBe(
    999,
  );
});
