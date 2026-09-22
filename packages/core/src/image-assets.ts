import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, parse, resolve } from "node:path";
import sharp from "sharp";
import { crc32 } from "node:zlib";
import { ApplicationError } from "@sarel/shared";
import {
  IMAGE_LIMITS,
  ImageAssetIdSchema,
  ImageAssetSchema,
  manuscriptImageReferences,
  type ImageAsset,
} from "@sarel/project-model";
import {
  CHAPTER_CREATION_LOCK,
  loadChapter,
  openProject,
  writeJsonAtomically,
} from "./index.js";
import { syncDirectory } from "./project-snapshot.js";

export const IMAGE_IMPORT_CHECKPOINTS = [
  "before-validation",
  "after-validation",
  "during-copy",
  "after-copy",
  "after-verification",
  "before-commit",
  "after-commit",
] as const;
export interface ImageImportOptions {
  /** Test-only deterministic interruption points. Never accepted over IPC. */
  checkpoint?: (
    point: (typeof IMAGE_IMPORT_CHECKPOINTS)[number],
  ) => Promise<void>;
}
function imageError(code = "IMAGE_INVALID"): ApplicationError {
  const messages: Record<string, string> = {
    IMAGE_INVALID:
      "Choose a complete, valid PNG or JPEG image matching its file extension.",
    IMAGE_TOO_LARGE:
      "The image exceeds the supported file size or pixel dimensions.",
    IMAGE_PATH_INVALID:
      "The image or project path is unsafe. Linked and network paths are not supported.",
    IMAGE_IMPORT_FAILED:
      "Unable to import the image. Existing images and manuscript files were preserved. Check disk space and permissions before retrying.",
    IMAGE_UNAVAILABLE:
      "This project image is missing or damaged. Its manuscript reference is preserved; restore the asset or replace the image.",
  };
  return new ApplicationError(code, messages[code] ?? messages.IMAGE_INVALID!);
}

/** Check ancestors before resolving: realpath alone would hide linked paths. */
async function regularPath(path: string, directory = false): Promise<void> {
  if (
    !isAbsolute(path) ||
    /^[\\/]{2}/.test(path) ||
    [...path].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw imageError("IMAGE_PATH_INVALID");
  if (
    path.split(/[\\/]/).includes("..") ||
    path.slice(parse(path).root.length).includes(":")
  )
    throw imageError("IMAGE_PATH_INVALID");
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current);
    const isDirectory = index < parts.length - 1 || directory;
    if (
      info.isSymbolicLink() ||
      (isDirectory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
    )
      throw imageError("IMAGE_PATH_INVALID");
  }
}

async function boundedRead(path: string, limit: number): Promise<Buffer> {
  await regularPath(path);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1)
      throw imageError("IMAGE_PATH_INVALID");
    if (info.size < 1 || info.size > limit) throw imageError("IMAGE_TOO_LARGE");
    const bytes = Buffer.alloc(info.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(
        bytes,
        count,
        bytes.length - count,
        count,
      );
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count !== info.size) throw imageError("IMAGE_INVALID");
    return bytes.subarray(0, count);
  } finally {
    await handle.close();
  }
}

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const extension = (type: ImageAsset["mediaType"]) =>
  type === "image/png" ? "png" : "jpg";

/** Full decode with strict errors and bounded pixels; decoded bytes are never authoritative. */
export async function validateImageContent(
  bytes: Buffer,
  filename: string,
): Promise<{
  mediaType: ImageAsset["mediaType"];
  width: number;
  height: number;
}> {
  if (bytes.length > IMAGE_LIMITS.bytes) throw imageError("IMAGE_TOO_LARGE");
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const suffix = extname(filename).toLowerCase();
  if (
    (!png && !jpeg) ||
    (png && suffix !== ".png") ||
    (jpeg && ![".jpg", ".jpeg"].includes(suffix))
  )
    throw imageError();
  // Require a complete container and no trailing payload. Animated PNG is outside this contract.
  if (png) {
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL" || offset + length + 12 > bytes.length)
        throw imageError();
      if (
        crc32(bytes.subarray(offset + 4, offset + length + 8)) !==
        bytes.readUInt32BE(offset + length + 8)
      )
        throw imageError();
      offset += length + 12;
      if (type === "IEND") {
        ended = length === 0 && offset === bytes.length;
        break;
      }
    }
    if (!ended) throw imageError();
  } else if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    throw imageError();
  try {
    const decoder = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: IMAGE_LIMITS.pixels,
      limitInputChannels: 4,
    });
    const metadata = await decoder.metadata();
    const { width, height } = metadata;
    if (
      !width ||
      !height ||
      width > IMAGE_LIMITS.dimension ||
      height > IMAGE_LIMITS.dimension ||
      width * height > IMAGE_LIMITS.pixels
    )
      throw imageError("IMAGE_TOO_LARGE");
    if (
      metadata.format !== (png ? "png" : "jpeg") ||
      (metadata.pages ?? 1) !== 1
    )
      throw imageError();
    await decoder.raw().toBuffer();
    return { mediaType: png ? "image/png" : "image/jpeg", width, height };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw imageError();
  }
}

async function imageRoot(projectPath: string, create = false): Promise<string> {
  await regularPath(projectPath, true);
  await openProject(projectPath);
  const assets = join(projectPath, "assets");
  if (create) {
    try {
      await mkdir(assets);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    }
  }
  await regularPath(assets, true);
  const images = join(assets, "images");
  if (create) {
    try {
      await mkdir(images);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    }
  }
  await regularPath(images, true);
  if (create) {
    // Persist newly created parent entries before a chapter can reference them.
    await syncDirectory(assets);
    await syncDirectory(projectPath);
  }
  return images;
}

/** Publish an immutable directory only after original and versioned record verify. */
export async function importImageAsset(
  input: { projectPath: string; sourcePath: string },
  options: ImageImportOptions = {},
): Promise<ImageAsset> {
  const checkpoint = options.checkpoint ?? (async () => undefined);
  let lock: string | undefined;
  let imported: ImageAsset | undefined;
  let failure: ApplicationError | undefined;
  let releaseFailed = false;
  try {
    await checkpoint("before-validation");
    await regularPath(input.projectPath, true);
    const bytes = await boundedRead(input.sourcePath, IMAGE_LIMITS.bytes);
    const properties = await validateImageContent(bytes, input.sourcePath);
    await checkpoint("after-validation");
    const images = await imageRoot(input.projectPath, true);
    const candidate = join(input.projectPath, CHAPTER_CREATION_LOCK);
    try {
      await mkdir(candidate);
    } catch {
      throw new ApplicationError(
        "PROJECT_BUSY",
        "The project is busy. Retry importing after the current operation finishes.",
      );
    }
    lock = candidate;
    const asset = ImageAssetSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      ...properties,
      originalFilename: basename(input.sourcePath),
      byteSize: bytes.length,
      sha256: hash(bytes),
    });
    const stage = join(images, `.import-${asset.id}`);
    await mkdir(stage);
    const original = join(stage, `original.${extension(asset.mediaType)}`);
    const handle = await open(original, "wx");
    try {
      await handle.writeFile(bytes.subarray(0, Math.floor(bytes.length / 2)));
      await checkpoint("during-copy");
      await handle.writeFile(bytes.subarray(Math.floor(bytes.length / 2)));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await checkpoint("after-copy");
    await writeJsonAtomically(join(stage, "asset.json"), asset);
    const copy = await boundedRead(original, IMAGE_LIMITS.bytes);
    if (!copy.equals(bytes)) throw imageError("IMAGE_IMPORT_FAILED");
    await validateImageContent(copy, original);
    if (
      JSON.stringify(
        ImageAssetSchema.parse(
          JSON.parse(await readFile(join(stage, "asset.json"), "utf8")),
        ),
      ) !== JSON.stringify(asset)
    )
      throw imageError("IMAGE_IMPORT_FAILED");
    await syncDirectory(stage);
    await checkpoint("after-verification");
    const destination = join(images, asset.id);
    try {
      await lstat(destination);
      throw imageError("IMAGE_IMPORT_FAILED");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await checkpoint("before-commit");
    await rename(stage, destination);
    await syncDirectory(images);
    await checkpoint("after-commit");
    imported = asset;
  } catch (error) {
    failure =
      error instanceof ApplicationError
        ? error
        : imageError("IMAGE_IMPORT_FAILED");
  } finally {
    // No assets or staging files are deleted, including after a failed import.
    if (lock) {
      try {
        await rmdir(lock);
      } catch {
        releaseFailed = true;
      }
    }
  }
  if (releaseFailed)
    throw new ApplicationError(
      "IMAGE_IMPORT_FAILED",
      "Image import could not release the project lock. Preserve the project and inspect its operation lock before retrying. Manuscript files were not changed.",
    );
  if (failure) throw failure;
  return imported!;
}

/** Local publishing input; never resolves a caller-supplied filename or URL. */
export async function readImageAsset(
  projectPath: string,
  assetId: string,
): Promise<{ asset: ImageAsset; bytes: Buffer }> {
  if (!ImageAssetIdSchema.safeParse(assetId).success)
    throw imageError("IMAGE_PATH_INVALID");
  try {
    const directory = join(await imageRoot(projectPath), assetId);
    const raw = await boundedRead(join(directory, "asset.json"), 8192);
    const asset = ImageAssetSchema.parse(JSON.parse(raw.toString("utf8")));
    if (asset.id !== assetId) throw imageError();
    const bytes = await boundedRead(
      join(directory, `original.${extension(asset.mediaType)}`),
      IMAGE_LIMITS.bytes,
    );
    if (bytes.length !== asset.byteSize || hash(bytes) !== asset.sha256)
      throw imageError();
    const properties = await validateImageContent(
      bytes,
      `original.${extension(asset.mediaType)}`,
    );
    if (
      properties.width !== asset.width ||
      properties.height !== asset.height ||
      properties.mediaType !== asset.mediaType
    )
      throw imageError();
    return { asset, bytes };
  } catch {
    throw imageError("IMAGE_UNAVAILABLE");
  }
}

/** Discover all current chapter occurrences; not a garbage-collection authority. */
export async function findImageReferences(
  projectPath: string,
): Promise<{ chapterId: string; assetId: string }[]> {
  const project = await openProject(projectPath);
  const references: { chapterId: string; assetId: string }[] = [];
  for (const chapterId of project.project.manuscript.order) {
    const chapter = await loadChapter({ projectPath, chapterId });
    for (const assetId of manuscriptImageReferences(chapter.content))
      references.push({ chapterId, assetId });
  }
  return references;
}
