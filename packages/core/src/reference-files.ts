import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { ApplicationError, createUuid } from "@drelwick/shared";
import {
  MigrationLockSchema,
  parseReferenceJson,
  REFERENCE_LIMITS,
} from "@drelwick/project-model";
import { regularPath } from "./image-assets.js";
import { CHAPTER_CREATION_LOCK } from "./chapter-creation.js";
import { syncDirectory } from "./project-snapshot.js";
import { isMissing } from "./migration-state.js";

export const referenceError = (code = "REFERENCE_INVALID") =>
  new ApplicationError(
    code,
    "Reference operation could not finish. Saved data and recovery copies were preserved. Review recovery or project access before retrying.",
  );
export const referenceHash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function referenceBytes(value: unknown): Buffer {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, sort(x)]),
      );
    return v;
  };
  return Buffer.from(`${JSON.stringify(sort(value), null, 2)}\n`, "utf8");
}
export function decodeReference(bytes: Buffer): unknown {
  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return parseReferenceJson(text);
  } catch {
    throw referenceError("REFERENCE_MALFORMED");
  }
}
export async function referenceRead(
  path: string,
  max: number = REFERENCE_LIMITS.recordBytes,
): Promise<Buffer> {
  await regularPath(path);
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw referenceError("REFERENCE_PATH_INVALID");
    if (stat.size > max) throw referenceError("REFERENCE_LIMIT");
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await file.read(bytes, count, bytes.length - count, count);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    const after = await file.stat();
    if (
      count !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw referenceError("REFERENCE_STALE");
    await regularPath(path);
    const current = await lstat(path);
    if (
      current.ino !== stat.ino ||
      current.dev !== stat.dev ||
      current.size !== stat.size ||
      current.mtimeMs !== stat.mtimeMs
    )
      throw referenceError("REFERENCE_STALE");
    return bytes.subarray(0, count);
  } finally {
    await file.close();
  }
}
export async function referenceEntries(path: string): Promise<string[]> {
  try {
    await regularPath(path, true);
    const names = await readdir(path);
    if (names.length > REFERENCE_LIMITS.files)
      throw referenceError("REFERENCE_LIMIT");
    return names.sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
/** Stream opaque recovery evidence; never allocate a corrupt file's declared size. */
export async function referenceFingerprint(
  path: string,
  max = 512 * 1024 ** 2,
): Promise<string> {
  await regularPath(path);
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > max)
      throw referenceError("REFERENCE_LIMIT");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(65536);
    let size = 0;
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
      if (size > max) throw referenceError("REFERENCE_LIMIT");
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    await regularPath(path);
    const after = await lstat(path);
    if (
      size !== before.size ||
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw referenceError("REFERENCE_STALE");
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}
export async function preserveReferenceBytes(
  source: string,
  destination: string,
  expectedHash: string,
): Promise<void> {
  await regularPath(source);
  await regularPath(dirname(destination), true);
  if ((await referenceFingerprint(source)) !== expectedHash)
    throw referenceError("REFERENCE_STALE");
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  const file = await open(destination, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  if (
    (await referenceFingerprint(destination)) !== expectedHash ||
    (await referenceFingerprint(source)) !== expectedHash
  )
    throw referenceError("REFERENCE_STALE");
  await syncDirectory(dirname(destination));
}
/** Only fixed component names / validated UUID segments may reach this helper. */
export async function referenceDirectory(
  root: string,
  segments: string[],
): Promise<string> {
  await regularPath(root, true);
  let path = root;
  for (const segment of segments) {
    path = join(path, segment);
    try {
      await mkdir(path);
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
    }
    await regularPath(path, true);
  }
  return path;
}
export async function referenceExclusive(
  path: string,
  bytes: Buffer,
): Promise<void> {
  await regularPath(dirname(path), true);
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  const reread = await referenceRead(
    path,
    Math.max(bytes.length, REFERENCE_LIMITS.draftBytes),
  );
  if (!reread.equals(bytes)) throw referenceError("REFERENCE_WRITE_FAILED");
  await syncDirectory(dirname(path));
}
export interface ReferenceWriteOptions {
  signal?: AbortSignal;
  authorized?: () => boolean;
  /** Fault injection only; never accepted over IPC. */
  checkpoint?: (
    point:
      | "before-draft"
      | "after-draft"
      | "after-snapshot"
      | "after-temporary"
      | "before-commit"
      | "after-commit",
  ) => Promise<void>;
  writeTemporary?: typeof referenceExclusive;
}
export function assertReferenceActive(options: ReferenceWriteOptions): void {
  if (options.signal?.aborted || options.authorized?.() === false)
    throw referenceError("REFERENCE_CANCELLED");
}
export async function publishReference(
  path: string,
  bytes: Buffer,
  exclusive: boolean,
  verify: () => Promise<void>,
  options: ReferenceWriteOptions,
): Promise<string | undefined> {
  const temporary = path.replace(/\.json$/, `.${createUuid()}.tmp`);
  let committed = false;
  try {
    await (options.writeTemporary ?? referenceExclusive)(temporary, bytes);
    await options.checkpoint?.("after-temporary");
    await options.checkpoint?.("before-commit");
    assertReferenceActive(options);
    await verify();
    if (!(await referenceRead(temporary)).equals(bytes))
      throw referenceError("REFERENCE_STALE");
    await regularPath(dirname(path), true);
    if (!exclusive) await regularPath(path);
    if (exclusive) {
      await link(temporary, path);
      committed = true;
      await unlink(temporary);
    } else {
      await rename(temporary, path);
      committed = true;
    }
    await syncDirectory(dirname(path));
    await options.checkpoint?.("after-commit");
    return undefined;
  } catch (error) {
    // A post-publication failure must not be reported as an unsaved revision.
    if (committed) {
      try {
        if ((await referenceRead(path)).equals(bytes))
          return "Reference saved; review retained recovery files before further changes.";
      } catch {
        /* Keep both candidate and live bytes for explicit recovery. */
      }
      throw referenceError("REFERENCE_COMMIT_UNCERTAIN");
    }
    // Failed temporaries are evidence, not disposable garbage.
    throw error;
  }
}
const queues = new Map<string, Promise<void>>();
async function acquireLock(root: string): Promise<void> {
  const lock = join(root, CHAPTER_CREATION_LOCK);
  try {
    await mkdir(lock);
  } catch {
    // Only our own validated, local, demonstrably dead process marker authorizes
    // reclamation. Never guess about chapter/migration/foreign or reused PID locks.
    try {
      await regularPath(lock, true);
      const ownerPath = join(lock, "reference-owner.json");
      const ownerBytes = await referenceRead(ownerPath, 4096);
      const owner = MigrationLockSchema.parse(decodeReference(ownerBytes));
      if (
        owner.host !== hostname() ||
        owner.pid === process.pid ||
        (await readdir(lock)).length !== 1
      )
        throw referenceError("PROJECT_BUSY");
      try {
        process.kill(owner.pid, 0);
        throw referenceError("PROJECT_BUSY");
      } catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "ESRCH"))
          throw referenceError("PROJECT_BUSY");
      }
      const claimPath = join(lock, "reference-reclaim.json");
      const claim = await open(claimPath, "wx", 0o600);
      await claim.close();
      if (!(await referenceRead(ownerPath, 4096)).equals(ownerBytes))
        throw referenceError("PROJECT_BUSY");
      await unlink(ownerPath);
      await unlink(claimPath);
      await rmdir(lock);
      await mkdir(lock);
    } catch {
      throw referenceError("PROJECT_BUSY");
    }
  }
  try {
    await referenceExclusive(
      join(lock, "reference-owner.json"),
      referenceBytes({
        schemaVersion: 1,
        token: createUuid(),
        pid: process.pid,
        host: hostname(),
      }),
    );
  } catch {
    throw referenceError("PROJECT_BUSY");
  }
}
/** Share the existing on-disk project operation lock with chapters and migration. */
export async function withReferenceLock<T>(
  root: string,
  task: (root: string) => Promise<T>,
): Promise<T> {
  await regularPath(root, true);
  root = await realpath(root);
  const key = process.platform === "win32" ? root.toLowerCase() : root;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => pending);
  queues.set(key, tail);
  await previous;
  let locked = false;
  let result: T | undefined;
  try {
    await regularPath(root, true);
    await acquireLock(root);
    locked = true;
    result = await task(root);
    return result;
  } finally {
    if (locked) {
      try {
        await unlink(join(root, CHAPTER_CREATION_LOCK, "reference-owner.json"));
        await rmdir(join(root, CHAPTER_CREATION_LOCK));
      } catch {
        if (result && typeof result === "object")
          Object.assign(result, {
            warning:
              "Operation completed, but the project lock was retained. Resolve it before further changes.",
          });
      }
    }
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}
