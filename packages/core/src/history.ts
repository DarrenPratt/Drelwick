import {
  HistorySnapshotSchema,
  ManuscriptDocumentSchema,
  type HistorySnapshot,
} from "@bookeditor/project-model";
import {
  ApplicationError,
  createIsoDate,
  createUuid,
  isUuid,
} from "@bookeditor/shared";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { writeJsonAtomically } from "./index.js";

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
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeJson(path: string, value: unknown): Promise<void>;
  unlink(path: string): Promise<void>;
}

const defaultFileSystem: HistoryFileSystem = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
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
  const directory = join(
    input.projectPath,
    ".history",
    "snapshots",
    input.chapterId,
  );
  const latest = await readLatestSnapshot(directory, fileSystem);
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
  try {
    await fileSystem.mkdir(directory);
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
  const snapshotsRoot = join(projectPath, ".history", "snapshots");
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
    try {
      const parsed = HistorySnapshotSchema.safeParse(
        JSON.parse(await fileSystem.readFile(join(directory, name), "utf8")),
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

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
