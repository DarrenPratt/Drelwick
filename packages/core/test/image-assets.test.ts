import {
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import {
  IMAGE_LIMITS,
  ImageAssetIdSchema,
  ManuscriptDocumentSchema,
} from "@bookeditor/project-model";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
import {
  IMAGE_IMPORT_CHECKPOINTS,
  importImageAsset,
  readImageAsset,
  findImageReferences,
  validateImageContent,
  loadChapter,
  saveChapter,
  openProject,
  openProjectForEditing,
  writeJsonAtomically,
} from "../src/index.js";

const copies: FixtureCopy[] = [];
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const copy = await copyFixture("multi-chapter-book");
  copies.push(copy);
  const sourceRoot = await mkdtemp(join(tmpdir(), "bookeditor-images-"));
  temporary.push(sourceRoot);
  const sourcePath = join(sourceRoot, "synthetic.png");
  await writeFile(sourcePath, await syntheticImage());
  const project = await openProject(copy.projectPath);
  return {
    root: copy.projectPath,
    sourceRoot,
    sourcePath,
    ids: project.project.manuscript.order,
  };
}
const imageDocument = (assetId: string, count = 1) => ({
  type: "doc",
  content: Array.from({ length: count }, () => ({
    type: "image",
    attrs: { assetId, alt: "海 — café 🌱", size: "large" },
  })),
});

it("rejects invalid pixel streams even when container endings and CRCs are intact", async () => {
  const png = await syntheticImage();
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      png.fill(0, offset + 8, offset + 8 + length);
      png.writeUInt32BE(
        crc32(png.subarray(offset + 4, offset + 8 + length)),
        offset + 8 + length,
      );
      break;
    }
    offset += length + 12;
  }
  await expect(validateImageContent(png, "invalid.png")).rejects.toMatchObject({
    code: "IMAGE_INVALID",
  });
  const jpeg = await syntheticImage("jpeg");
  await expect(
    validateImageContent(
      Buffer.concat([
        jpeg.subarray(0, jpeg.length - 8),
        Buffer.from([255, 217]),
      ]),
      "invalid.jpg",
    ),
  ).rejects.toMatchObject({ code: "IMAGE_INVALID" });
});

it("rejects corrupt staged copies before publishing an asset", async () => {
  const f = await fixture();
  await expect(
    importImageAsset(
      { projectPath: f.root, sourcePath: f.sourcePath },
      {
        checkpoint: async (stage) => {
          if (stage !== "after-copy") return;
          const images = join(f.root, "assets", "images");
          const pending = (await readdir(images)).find((name) =>
            name.startsWith(".import-"),
          )!;
          await writeFile(
            join(images, pending, "original.png"),
            "injected incomplete write",
          );
        },
      },
    ),
  ).rejects.toMatchObject({ code: "IMAGE_IMPORT_FAILED" });
  expect(
    (await readdir(join(f.root, "assets", "images"))).every((name) =>
      name.startsWith(".import-"),
    ),
  ).toBe(true);
  expect(await findImageReferences(f.root)).toEqual([]);
});

it("preserves the old image on an actual chapter atomic-replacement failure", async () => {
  const f = await fixture();
  const old = await importImageAsset({
    projectPath: f.root,
    sourcePath: f.sourcePath,
  });
  const replacement = await importImageAsset({
    projectPath: f.root,
    sourcePath: f.sourcePath,
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: imageDocument(old.id),
  });
  const path = join(f.root, "manuscript", `${f.ids[0]}.json`);
  const previous = await readFile(path);
  await expect(
    saveChapter(
      {
        projectPath: f.root,
        chapterId: f.ids[0]!,
        document: imageDocument(replacement.id),
      },
      {
        writeChapter: (target, value) =>
          writeJsonAtomically(target, value, {
            open,
            rename: async () => {
              throw new Error("Injected rename failure");
            },
            unlink,
          }),
      },
    ),
  ).rejects.toMatchObject({ code: "CHAPTER_SAVE_FAILED" });
  expect(await readFile(path)).toEqual(previous);
  await openProjectForEditing(f.root);
  expect(
    (await loadChapter({ projectPath: f.root, chapterId: f.ids[0]! })).content,
  ).toEqual(imageDocument(old.id));
  await readImageAsset(f.root, old.id);
  await readImageAsset(f.root, replacement.id);
});

it("rejects a linked source ancestor and path syntax before copying", async () => {
  const f = await fixture();
  const linked = join(f.root, "linked-source");
  await symlink(
    f.sourceRoot,
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    importImageAsset({
      projectPath: f.root,
      sourcePath: join(linked, "synthetic.png"),
    }),
  ).rejects.toMatchObject({ code: "IMAGE_PATH_INVALID" });
  for (const sourcePath of [
    "relative.png",
    "file:///outside.png",
    `${f.sourceRoot}/../synthetic.png`,
    `${f.sourcePath}:stream`,
    `${f.sourcePath}\u0000`,
  ])
    await expect(
      importImageAsset({ projectPath: f.root, sourcePath }),
    ).rejects.toMatchObject({ code: "IMAGE_PATH_INVALID" });
});

it.each(["png", "jpeg"] as const)(
  "imports and verifies original %s bytes with safe metadata",
  async (format) => {
    const f = await fixture();
    const source = join(f.sourceRoot, `synthetic.${format}`);
    const original = await syntheticImage(format);
    await writeFile(source, original);
    const asset = await importImageAsset({
      projectPath: f.root,
      sourcePath: source,
    });
    expect(ImageAssetIdSchema.safeParse(asset.id).success).toBe(true);
    expect(asset).toMatchObject({
      schemaVersion: 1,
      mediaType: `image/${format}`,
      originalFilename: `synthetic.${format}`,
      width: 2,
      height: 3,
      byteSize: original.length,
    });
    expect(JSON.stringify(asset)).not.toContain(f.sourceRoot);
    expect((await readImageAsset(f.root, asset.id)).bytes).toEqual(original);
    expect(await readFile(source)).toEqual(original);
    expect(
      (await lstat(join(f.root, "assets", "images", asset.id))).isDirectory(),
    ).toBe(true);
  },
);

it.each([
  "../outside",
  "..\\outside",
  "/outside",
  "C:\\outside",
  "file:///outside",
  "https://example.invalid/image.png",
  "\\\\server\\share",
  "id\u0000",
  "00000000-0000-4000-8000-000000000001/../outside",
])("rejects crafted asset identifier %s", async (id) => {
  const f = await fixture();
  await expect(readImageAsset(f.root, id)).rejects.toMatchObject({
    code: "IMAGE_PATH_INVALID",
  });
  expect(ManuscriptDocumentSchema.safeParse(imageDocument(id)).success).toBe(
    false,
  );
});

it("rejects executable, active, unsupported, truncated, mismatched and corrupt content", async () => {
  const png = await syntheticImage();
  const jpeg = await syntheticImage("jpeg");
  const corrupt = Buffer.from(png);
  corrupt[corrupt.length - 20] = 0;
  for (const [bytes, name] of [
    [Buffer.from("MZ executable"), "cover.jpg"],
    [Buffer.from("<html><script>alert(1)</script></html>"), "cover.png"],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "cover.svg"],
    [Buffer.from("GIF89a"), "cover.gif"],
    [png, "cover.jpg"],
    [jpeg, "cover.png"],
    [png, "cover.webp"],
    [png.subarray(0, 45), "cover.png"],
    [jpeg.subarray(0, jpeg.length - 8), "cover.jpg"],
    [Buffer.concat([png, Buffer.from("payload")]), "cover.png"],
    [corrupt, "cover.png"],
  ] as const)
    await expect(validateImageContent(bytes, name)).rejects.toMatchObject({
      code: "IMAGE_INVALID",
    });
});

it("rejects oversized files and dimensions before full pixel decoding", async () => {
  const f = await fixture();
  await writeFile(f.sourcePath, Buffer.alloc(IMAGE_LIMITS.bytes + 1));
  await expect(
    importImageAsset({ projectPath: f.root, sourcePath: f.sourcePath }),
  ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  const oversized = await syntheticImage();
  oversized.writeUInt32BE(IMAGE_LIMITS.dimension + 1, 16);
  oversized.writeUInt32BE(crc32(oversized.subarray(12, 29)), 29);
  await expect(validateImageContent(oversized, "huge.png")).rejects.toThrow();
  oversized.writeUInt32BE(6000, 16);
  oversized.writeUInt32BE(6000, 20);
  oversized.writeUInt32BE(crc32(oversized.subarray(12, 29)), 29);
  await expect(validateImageContent(oversized, "huge.png")).rejects.toThrow();
});

it("rejects linked source/destination paths and hard-linked files", async () => {
  const f = await fixture();
  const linked = join(f.sourceRoot, "linked.png");
  await link(f.sourcePath, linked);
  await expect(
    importImageAsset({ projectPath: f.root, sourcePath: linked }),
  ).rejects.toMatchObject({ code: "IMAGE_PATH_INVALID" });
  await rm(linked);
  const ancestor = join(f.sourceRoot, "linked-root");
  await symlink(
    f.root,
    ancestor,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    importImageAsset({ projectPath: ancestor, sourcePath: f.sourcePath }),
  ).rejects.toMatchObject({ code: "IMAGE_PATH_INVALID" });
  const outside = join(f.sourceRoot, "outside");
  await mkdir(outside);
  await mkdir(join(f.root, "assets"), { recursive: true });
  await symlink(
    outside,
    join(f.root, "assets", "images"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    importImageAsset({ projectPath: f.root, sourcePath: f.sourcePath }),
  ).rejects.toMatchObject({ code: "IMAGE_PATH_INVALID" });
  expect(await readdir(outside)).toEqual([]);
});

it.each(IMAGE_IMPORT_CHECKPOINTS)(
  "preserves manuscript and previous image when interrupted at %s",
  async (point) => {
    const f = await fixture();
    const previous = await importImageAsset({
      projectPath: f.root,
      sourcePath: f.sourcePath,
    });
    const document = imageDocument(previous.id);
    await saveChapter({ projectPath: f.root, chapterId: f.ids[0]!, document });
    const before = await readFile(
      join(f.root, "manuscript", `${f.ids[0]}.json`),
    );
    await expect(
      importImageAsset(
        { projectPath: f.root, sourcePath: f.sourcePath },
        {
          checkpoint: async (stage) => {
            if (stage === point) throw new Error("Injected disk failure");
          },
        },
      ),
    ).rejects.toThrow();
    await openProject(f.root);
    expect(
      await readFile(join(f.root, "manuscript", `${f.ids[0]}.json`)),
    ).toEqual(before);
    expect(
      (await loadChapter({ projectPath: f.root, chapterId: f.ids[0]! }))
        .content,
    ).toEqual(document);
    expect((await readImageAsset(f.root, previous.id)).bytes).toEqual(
      await syntheticImage(),
    );
    await expect(
      lstat(join(f.root, ".chapter-create.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("retains both assets and prior manuscript after replacement document-write failure", async () => {
  const f = await fixture();
  const old = await importImageAsset({
    projectPath: f.root,
    sourcePath: f.sourcePath,
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: imageDocument(old.id),
  });
  const replacement = await importImageAsset({
    projectPath: f.root,
    sourcePath: f.sourcePath,
  });
  await expect(
    saveChapter(
      {
        projectPath: f.root,
        chapterId: f.ids[0]!,
        document: imageDocument(replacement.id),
      },
      {
        writeChapter: async () => {
          throw new Error("Injected write failure");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "CHAPTER_SAVE_FAILED" });
  expect(
    (await loadChapter({ projectPath: f.root, chapterId: f.ids[0]! })).content,
  ).toEqual(imageDocument(old.id));
  await readImageAsset(f.root, old.id);
  await readImageAsset(f.root, replacement.id);
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: imageDocument(replacement.id),
  });
  expect(
    (await loadChapter({ projectPath: f.root, chapterId: f.ids[0]! })).content,
  ).toEqual(imageDocument(replacement.id));
  await readImageAsset(f.root, old.id);
});

it("preserves duplicate and multi-chapter references through deletion, offline move and migration", async () => {
  const f = await fixture();
  const asset = await importImageAsset({
    projectPath: f.root,
    sourcePath: f.sourcePath,
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: imageDocument(asset.id, 2),
  });
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[1]!,
    document: imageDocument(asset.id),
  });
  expect(await findImageReferences(f.root)).toHaveLength(3);
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: imageDocument(asset.id),
  });
  expect(await findImageReferences(f.root)).toHaveLength(2);
  await saveChapter({
    projectPath: f.root,
    chapterId: f.ids[0]!,
    document: { type: "doc", content: [{ type: "paragraph" }] },
  });
  expect(await findImageReferences(f.root)).toEqual([
    { chapterId: f.ids[1], assetId: asset.id },
  ]);
  const moved = join(f.sourceRoot, "portable-project");
  await cp(f.root, moved, { recursive: true });
  await rm(f.sourcePath);
  await openProjectForEditing(moved);
  expect((await readImageAsset(moved, asset.id)).bytes).toEqual(
    await syntheticImage(),
  );
  expect(
    (await loadChapter({ projectPath: moved, chapterId: f.ids[1]! })).content,
  ).toEqual(imageDocument(asset.id));
});

it("preserves missing and damaged references across open, save and reopen", async () => {
  const f = await fixture();
  const asset = await importImageAsset({
    projectPath: f.root,
    sourcePath: f.sourcePath,
  });
  const document = imageDocument(asset.id);
  await saveChapter({ projectPath: f.root, chapterId: f.ids[0]!, document });
  const original = join(f.root, "assets", "images", asset.id, "original.png");
  await writeFile(original, "invalid");
  await expect(readImageAsset(f.root, asset.id)).rejects.toMatchObject({
    code: "IMAGE_UNAVAILABLE",
  });
  await rm(original);
  await openProject(f.root);
  expect(
    (await loadChapter({ projectPath: f.root, chapterId: f.ids[0]! })).content,
  ).toEqual(document);
  await saveChapter({ projectPath: f.root, chapterId: f.ids[0]!, document });
  await expect(readImageAsset(f.root, asset.id)).rejects.toMatchObject({
    code: "IMAGE_UNAVAILABLE",
  });
  expect(
    (await loadChapter({ projectPath: f.root, chapterId: f.ids[0]! })).content,
  ).toEqual(document);
});
