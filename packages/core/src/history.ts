import {
  HistorySnapshotSchema,
  ManuscriptDocumentSchema,
  type HistorySnapshot,
} from "@drelwick/project-model";
import {
  ApplicationError,
  createIsoDate,
  createUuid,
  isUuid,
} from "@drelwick/shared";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Stats } from "node:fs";
import { createHash } from "node:crypto";
import { writeJsonAtomically } from "./index.js";
import { assertMigrationReadable } from "./migration-state.js";

export const HISTORY_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
export const HISTORY_KEEP_ALL_MS = 24 * 60 * 60 * 1000;
export const HISTORY_KEEP_HOURLY_MS = 7 * 24 * 60 * 60 * 1000;
export const HISTORY_KEEP_DAILY_MS = 30 * 24 * 60 * 60 * 1000;

export interface HistorySnapshotInput {
  projectPath: string;
  chapterId: string;
  document: Record<string, unknown>;
  reason?: HistorySnapshot["reason"];
  now?: string;
}

export interface HistoryFileSystem {
  mkdir(path: string): Promise<void>;
  lstat(
    path: string,
  ): Promise<Pick<Stats, "isDirectory" | "isFile" | "isSymbolicLink">>;
  realpath(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeJson(path: string, value: unknown): Promise<void>;
  unlink(path: string): Promise<void>;
}

const defaultFileSystem: HistoryFileSystem = {
  mkdir: async (path) => {
    await mkdir(path);
  },
  lstat,
  realpath,
  readdir: async (path) => readdir(path),
  readFile: async (path, encoding) => readFile(path, encoding),
  writeJson: writeJsonAtomically,
  unlink,
};

export interface HistoryRetentionResult {
  removed: number;
  retained: number;
}

interface StoredSnapshot {
  snapshot: HistorySnapshot;
  path: string;
}

export async function createHistorySnapshot(
  input: HistorySnapshotInput,
  fileSystem: HistoryFileSystem = defaultFileSystem,
): Promise<HistorySnapshot | null> {
  if (!isUuid(input.chapterId)) throw unavailableSnapshot();
  if (!isAbsolute(input.projectPath)) {
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  }
  const document = ManuscriptDocumentSchema.safeParse(input.document);
  if (!document.success) {
    throw new ApplicationError(
      "CHAPTER_DOCUMENT_INVALID",
      "The chapter document has an unsupported or invalid structure.",
    );
  }
  const created = input.now ?? createIsoDate();
  const timestamp = Date.parse(created);
  if (Number.isNaN(timestamp)) {
    throw new ApplicationError(
      "HISTORY_TIMESTAMP_INVALID",
      "The history snapshot timestamp is invalid.",
    );
  }
  const root = await fileSystem.realpath(input.projectPath);
  await assertMigrationReadable(root, fileSystem);
  if (!(await isSafeDirectory(root, root, fileSystem)))
    throw unsafeHistoryPath();
  const historyDirectory = join(root, ".history");
  const snapshotsDirectory = join(historyDirectory, "snapshots");
  const directory = join(snapshotsDirectory, input.chapterId);
  await ensureHistoryDirectory(root, historyDirectory, fileSystem);
  await ensureHistoryDirectory(root, snapshotsDirectory, fileSystem);
  await ensureHistoryDirectory(root, directory, fileSystem);
  const latest =
    input.reason === "before-recovery" ||
    input.reason === "before-replace" ||
    input.reason === "before-restructure"
      ? null
      : await readLatestSnapshot(directory, fileSystem, root);
  if (
    latest &&
    JSON.stringify(latest.content) === JSON.stringify(document.data)
  )
    return null;
  if (
    latest &&
    timestamp - Date.parse(latest.created) < HISTORY_SNAPSHOT_INTERVAL_MS
  )
    return null;
  const snapshot: HistorySnapshot = {
    schemaVersion: 1,
    id: createUuid(),
    chapterId: input.chapterId,
    created,
    reason: input.reason ?? "interval",
    content: document.data,
  };
  if (!HistorySnapshotSchema.safeParse(snapshot).success)
    throw unavailableSnapshot();
  try {
    await fileSystem.writeJson(
      join(directory, `${snapshot.id}.json`),
      snapshot,
    );
    return snapshot;
  } catch {
    throw new ApplicationError(
      "HISTORY_SNAPSHOT_WRITE_FAILED",
      "Unable to create a manuscript history snapshot.",
    );
  }
}

/** Read one bounded, versioned snapshot; never accept renderer filesystem paths. */
export async function readHistorySnapshot(
  projectPath: string,
  chapterId: string,
  snapshotId: string,
  fileSystem: HistoryFileSystem = defaultFileSystem,
): Promise<{ snapshot: HistorySnapshot; fingerprint: string }> {
  if (!isAbsolute(projectPath) || !isUuid(chapterId) || !isUuid(snapshotId))
    throw unavailableSnapshot();
  try {
    const root = await fileSystem.realpath(projectPath);
    await assertMigrationReadable(root, fileSystem);
    let directory = root;
    for (const part of [".history", "snapshots", chapterId]) {
      directory = join(directory, part);
      if (!(await isSafeDirectory(root, directory, fileSystem)))
        throw unavailableSnapshot();
    }
    const path = join(directory, `${snapshotId}.json`);
    if (!(await isSafeFile(root, path, fileSystem)))
      throw unavailableSnapshot();
    const source = await fileSystem.readFile(path, "utf8");
    const parsed = HistorySnapshotSchema.safeParse(JSON.parse(source));
    if (
      !parsed.success ||
      parsed.data.id !== snapshotId ||
      parsed.data.chapterId !== chapterId
    )
      throw unavailableSnapshot();
    return {
      snapshot: parsed.data,
      fingerprint: createHash("sha256").update(source).digest("hex"),
    };
  } catch {
    throw unavailableSnapshot();
  }
}

/** Full validation requires reading each existing envelope; only metadata is returned. */
export async function listHistorySnapshots(
  projectPath: string,
  chapterId: string,
) {
  if (!isAbsolute(projectPath) || !isUuid(chapterId))
    throw unavailableSnapshot();
  const root = await realpath(projectPath);
  await assertMigrationReadable(root, defaultFileSystem);
  let directory = root;
  for (const part of [".history", "snapshots", chapterId]) {
    directory = join(directory, part);
    if (!(await isSafeDirectory(root, directory, defaultFileSystem)))
      return { entries: [], unavailable: 0 };
  }
  const entries: { id: string; chapterId: string; created: string }[] = [];
  let unavailable = 0;
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".json")) continue;
    try {
      const { snapshot } = await readHistorySnapshot(
        root,
        chapterId,
        name.slice(0, -5),
      );
      entries.push({
        id: snapshot.id,
        chapterId: snapshot.chapterId,
        created: snapshot.created,
      });
    } catch {
      unavailable++;
    }
  }
  entries.sort(
    (a, b) =>
      Date.parse(b.created) - Date.parse(a.created) || a.id.localeCompare(b.id),
  );
  return { entries, unavailable };
}

function unavailableSnapshot(): ApplicationError {
  return new ApplicationError(
    "HISTORY_UNAVAILABLE",
    "This snapshot is missing, changed, unsafe or unsupported. Refresh Chapter History.",
  );
}

export async function applyHistoryRetention(
  projectPath: string,
  now = new Date().toISOString(),
  fileSystem: HistoryFileSystem = defaultFileSystem,
): Promise<HistoryRetentionResult> {
  if (!isAbsolute(projectPath)) {
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new ApplicationError(
      "HISTORY_TIMESTAMP_INVALID",
      "The history retention timestamp is invalid.",
    );
  }
  let root: string;
  try {
    root = await fileSystem.realpath(projectPath);
  } catch {
    throw unsafeHistoryPath();
  }
  await assertMigrationReadable(root, fileSystem);
  if (!(await isSafeDirectory(root, root, fileSystem)))
    throw unsafeHistoryPath();
  const historyRoot = join(root, ".history");
  const snapshotsRoot = join(historyRoot, "snapshots");
  if (!(await isSafeDirectory(root, historyRoot, fileSystem)))
    return { removed: 0, retained: 0 };
  if (!(await isSafeDirectory(root, snapshotsRoot, fileSystem)))
    return { removed: 0, retained: 0 };
  let chapterIds: string[];
  try {
    chapterIds = await fileSystem.readdir(snapshotsRoot);
  } catch (error) {
    if (isMissing(error)) return { removed: 0, retained: 0 };
    throw new ApplicationError(
      "HISTORY_SNAPSHOT_READ_FAILED",
      "Unable to read manuscript history.",
    );
  }

  const snapshots: StoredSnapshot[] = [];
  for (const chapterId of chapterIds) {
    if (!isUuid(chapterId)) continue;
    const directory = join(snapshotsRoot, chapterId);
    if (!(await isSafeDirectory(root, directory, fileSystem))) continue;
    let names: string[];
    try {
      names = await fileSystem.readdir(directory);
    } catch (error) {
      if (isMissing(error)) continue;
      throw new ApplicationError(
        "HISTORY_SNAPSHOT_READ_FAILED",
        "Unable to read manuscript history.",
      );
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const path = join(directory, name);
      if (!(await isSafeFile(root, path, fileSystem))) continue;
      try {
        const parsed = HistorySnapshotSchema.safeParse(
          JSON.parse(await fileSystem.readFile(path, "utf8")),
        );
        if (parsed.success && parsed.data.chapterId === chapterId)
          snapshots.push({ snapshot: parsed.data, path });
      } catch {
        // Invalid history is disposable and is never promoted or overwritten.
      }
    }
  }

  snapshots.sort(
    (left, right) =>
      Date.parse(right.snapshot.created) - Date.parse(left.snapshot.created),
  );
  const keep = new Set<string>();
  const buckets = new Set<string>();
  for (const stored of snapshots) {
    const age = nowMs - Date.parse(stored.snapshot.created);
    if (age <= HISTORY_KEEP_ALL_MS) {
      keep.add(stored.path);
    } else if (age <= HISTORY_KEEP_HOURLY_MS) {
      const key = `${stored.snapshot.chapterId}:hour:${stored.snapshot.created.slice(0, 13)}`;
      if (!buckets.has(key)) {
        buckets.add(key);
        keep.add(stored.path);
      }
    } else if (age <= HISTORY_KEEP_DAILY_MS) {
      const key = `${stored.snapshot.chapterId}:day:${stored.snapshot.created.slice(0, 10)}`;
      if (!buckets.has(key)) {
        buckets.add(key);
        keep.add(stored.path);
      }
    }
  }

  let removed = 0;
  for (const stored of snapshots) {
    if (keep.has(stored.path)) continue;
    if (!(await isSafeFile(root, stored.path, fileSystem))) continue;
    try {
      await fileSystem.unlink(stored.path);
    } catch {
      throw new ApplicationError(
        "HISTORY_SNAPSHOT_DELETE_FAILED",
        "Unable to remove expired manuscript history.",
      );
    }
    removed += 1;
  }
  return { removed, retained: keep.size };
}

async function readLatestSnapshot(
  directory: string,
  fileSystem: HistoryFileSystem,
  root: string,
): Promise<HistorySnapshot | null> {
  let names: string[];
  try {
    names = await fileSystem.readdir(directory);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw new ApplicationError(
      "HISTORY_SNAPSHOT_READ_FAILED",
      "Unable to read manuscript history.",
    );
  }
  let latest: HistorySnapshot | null = null;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(directory, name);
    if (!(await isSafeFile(root, path, fileSystem))) continue;
    try {
      const parsed = HistorySnapshotSchema.safeParse(
        JSON.parse(await fileSystem.readFile(path, "utf8")),
      );
      if (
        parsed.success &&
        (!latest ||
          Date.parse(parsed.data.created) > Date.parse(latest.created))
      )
        latest = parsed.data;
    } catch {
      // Invalid history is disposable and must not block future snapshots.
    }
  }
  return latest;
}

async function ensureHistoryDirectory(
  root: string,
  directory: string,
  fileSystem: HistoryFileSystem,
): Promise<void> {
  try {
    await fileSystem.lstat(directory);
  } catch (error) {
    if (!isMissing(error)) throw unsafeHistoryPath();
    try {
      await fileSystem.mkdir(directory);
    } catch (mkdirError) {
      if (!isAlreadyExists(mkdirError)) throw unsafeHistoryPath();
    }
  }
  if (!(await isSafeDirectory(root, directory, fileSystem)))
    throw unsafeHistoryPath();
}

async function isSafeDirectory(
  root: string,
  path: string,
  fileSystem: HistoryFileSystem,
): Promise<boolean> {
  try {
    const stats = await fileSystem.lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return false;
    return isWithin(root, await fileSystem.realpath(path));
  } catch (error) {
    if (isMissing(error)) return false;
    throw unsafeHistoryPath();
  }
}

async function isSafeFile(
  root: string,
  path: string,
  fileSystem: HistoryFileSystem,
): Promise<boolean> {
  try {
    const stats = await fileSystem.lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) return false;
    return isWithin(root, await fileSystem.realpath(path));
  } catch (error) {
    if (isMissing(error)) return false;
    throw unsafeHistoryPath();
  }
}

function isWithin(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function unsafeHistoryPath(): ApplicationError {
  return new ApplicationError(
    "PROJECT_PATH_INVALID",
    "Manuscript history contains an unsafe filesystem path.",
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
