import {
  HistorySnapshotSchema,
  ManuscriptDocumentSchema,
  type HistorySnapshot,
} from "@bookeditor/project-model";
import {
  ApplicationError,
  createIsoDate,
  createUuid,
} from "@bookeditor/shared";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { writeJsonAtomically } from "./index.js";

export const HISTORY_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

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
}

const defaultFileSystem: HistoryFileSystem = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readdir: async (path) => readdir(path),
  readFile: async (path, encoding) => readFile(path, encoding),
  writeJson: writeJsonAtomically,
};

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
