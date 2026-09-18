import {
  ChapterFileSchema,
  HistorySnapshotSchema,
  ProjectConfigSchema,
} from "@bookeditor/project-model";
import { ApplicationError, isUuid } from "@bookeditor/shared";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export type RecoveryCandidateSource = "temporary" | "history";

export interface RecoveryCandidate {
  chapterId: string;
  created: string;
  document: Record<string, unknown>;
  path: string;
  source: RecoveryCandidateSource;
}

export interface RecoveryScanResult {
  candidates: RecoveryCandidate[];
}

export interface RecoveryFileSystem {
  lstat(path: string): Promise<{
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
  }>;
  realpath(path: string): Promise<string>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(path: string): Promise<string[]>;
}

const defaultFileSystem: RecoveryFileSystem = {
  lstat,
  realpath,
  readFile,
  readdir: async (path) => readdir(path),
};

/**
 * Finds valid recovery data without writing to or replacing project files.
 * Only the known manuscript and history directories are traversed.
 */
export async function scanRecoveryCandidates(
  projectPath: string,
  fileSystem: RecoveryFileSystem = defaultFileSystem,
): Promise<RecoveryScanResult> {
  if (!isAbsolute(projectPath)) {
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  }

  let root: string;
  try {
    root = await fileSystem.realpath(projectPath);
  } catch {
    throw new ApplicationError(
      "PROJECT_PATH_ACCESS_FAILED",
      "Unable to access project folder.",
    );
  }

  const project = await readProject(root, fileSystem);
  const persisted = await readPersistedChapters(
    root,
    project.manuscript.order,
    fileSystem,
  );
  const candidates = [
    ...(await scanTemporaryFiles(root, fileSystem)),
    ...(await scanHistoryFiles(root, fileSystem)),
  ].filter((candidate) => {
    const modified = persisted.get(candidate.chapterId);
    return modified === undefined || Date.parse(candidate.created) > modified;
  });

  candidates.sort(
    (left, right) =>
      Date.parse(right.created) - Date.parse(left.created) ||
      left.chapterId.localeCompare(right.chapterId) ||
      left.path.localeCompare(right.path),
  );
  return { candidates };
}

export class RecoveryService {
  private readonly candidates = new Map<string, RecoveryCandidate[]>();

  async scanProject(
    projectPath: string,
    fileSystem: RecoveryFileSystem = defaultFileSystem,
  ): Promise<RecoveryScanResult> {
    const result = await scanRecoveryCandidates(projectPath, fileSystem);
    this.candidates.set(projectPath, result.candidates);
    return result;
  }

  getCandidates(): RecoveryCandidate[] {
    return [...this.candidates.values()].flat();
  }
}

async function readProject(
  root: string,
  fileSystem: RecoveryFileSystem,
): Promise<{ manuscript: { order: string[] } }> {
  const raw = await readJson(join(root, "project.json"), fileSystem);
  const parsed = ProjectConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApplicationError(
      "PROJECT_SCHEMA_INVALID",
      "Invalid project configuration in project.json.",
    );
  }
  return parsed.data;
}

async function readPersistedChapters(
  root: string,
  chapterIds: string[],
  fileSystem: RecoveryFileSystem,
): Promise<Map<string, number>> {
  const persisted = new Map<string, number>();
  for (const chapterId of chapterIds) {
    if (!isUuid(chapterId)) continue;
    const path = join(root, "manuscript", `${chapterId}.json`);
    const parsed = await readRegularJson(path, fileSystem, true);
    const chapter =
      parsed === null ? null : ChapterFileSchema.safeParse(parsed);
    if (chapter?.success) {
      const modified = Date.parse(chapter.data.modified);
      if (!Number.isNaN(modified)) persisted.set(chapter.data.id, modified);
    }
  }
  return persisted;
}

async function scanTemporaryFiles(
  root: string,
  fileSystem: RecoveryFileSystem,
): Promise<RecoveryCandidate[]> {
  const directory = join(root, "manuscript");
  const names = await readDirectory(directory, fileSystem);
  const candidates: RecoveryCandidate[] = [];
  for (const name of names) {
    if (!name.endsWith(".json.tmp")) continue;
    const chapterId = name.slice(0, -".json.tmp".length);
    if (!isUuid(chapterId)) continue;
    const path = join(directory, name);
    if (!(await isRegularFile(path, fileSystem))) continue;
    let parsed: unknown;
    try {
      parsed = await readJson(path, fileSystem);
    } catch {
      continue;
    }
    const chapter = ChapterFileSchema.safeParse(parsed);
    if (!chapter.success || chapter.data.id !== chapterId) continue;
    candidates.push({
      chapterId,
      created: chapter.data.modified,
      document: chapter.data.content,
      path,
      source: "temporary",
    });
  }
  return candidates;
}

async function scanHistoryFiles(
  root: string,
  fileSystem: RecoveryFileSystem,
): Promise<RecoveryCandidate[]> {
  const snapshotsRoot = join(root, ".history", "snapshots");
  const chapterIds = await readDirectory(snapshotsRoot, fileSystem);
  const candidates: RecoveryCandidate[] = [];
  for (const chapterId of chapterIds) {
    if (!isUuid(chapterId)) continue;
    const directory = join(snapshotsRoot, chapterId);
    if (!(await isRegularDirectory(directory, fileSystem))) continue;
    for (const name of await readDirectory(directory, fileSystem)) {
      if (!name.endsWith(".json")) continue;
      const path = join(directory, name);
      if (!(await isRegularFile(path, fileSystem))) continue;
      let raw: unknown;
      try {
        raw = await readJson(path, fileSystem);
      } catch {
        continue;
      }
      const parsed = HistorySnapshotSchema.safeParse(raw);
      if (!parsed.success || parsed.data.chapterId !== chapterId) continue;
      candidates.push({
        chapterId,
        created: parsed.data.created,
        document: parsed.data.content,
        path,
        source: "history",
      });
    }
  }
  return candidates;
}

async function readDirectory(
  path: string,
  fileSystem: RecoveryFileSystem,
): Promise<string[]> {
  try {
    return await fileSystem.readdir(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw new ApplicationError(
      "RECOVERY_SCAN_FAILED",
      "Unable to scan manuscript recovery data.",
    );
  }
}

async function isRegularFile(
  path: string,
  fileSystem: RecoveryFileSystem,
): Promise<boolean> {
  try {
    const stats = await fileSystem.lstat(path);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function isRegularDirectory(
  path: string,
  fileSystem: RecoveryFileSystem,
): Promise<boolean> {
  try {
    const stats = await fileSystem.lstat(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readJson(
  path: string,
  fileSystem: RecoveryFileSystem,
): Promise<unknown> {
  return JSON.parse(await fileSystem.readFile(path, "utf8")) as unknown;
}

async function readRegularJson(
  path: string,
  fileSystem: RecoveryFileSystem,
  missingIsEmpty: boolean,
): Promise<unknown | null> {
  if (!(await isRegularFile(path, fileSystem))) {
    if (missingIsEmpty) return null;
    throw new ApplicationError(
      "RECOVERY_SCAN_FAILED",
      "Unable to scan manuscript recovery data.",
    );
  }
  try {
    return await readJson(path, fileSystem);
  } catch {
    return null;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
