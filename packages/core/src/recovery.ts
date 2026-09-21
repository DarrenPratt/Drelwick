import {
  ChapterFileSchema,
  HistorySnapshotSchema,
  ProjectConfigSchema,
} from "@bookeditor/project-model";
import { ApplicationError, createUuid, isUuid } from "@bookeditor/shared";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { createHistorySnapshot } from "./history.js";
import { assertMigrationReadable } from "./migration-state.js";
import {
  CHAPTER_CREATION_LOCK,
  writeJsonAtomically,
  writeJsonAtomicallyAt,
} from "./index.js";

export type RecoveryCandidateSource = "temporary" | "history";

export interface RecoveryCandidate {
  id: string;
  projectPath: string;
  chapterId: string;
  title?: string;
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
  mkdir(path: string): Promise<void>;
  writeJson(path: string, value: unknown): Promise<void>;
  unlink(path: string): Promise<void>;
  writeRecovery(path: string, value: unknown): Promise<void>;
  acquireLock(path: string): Promise<void>;
  releaseLock(path: string): Promise<void>;
}

const defaultFileSystem: RecoveryFileSystem = {
  lstat,
  realpath,
  readFile,
  readdir: async (path) => readdir(path),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeJson: writeJsonAtomically,
  writeRecovery: (path, value) =>
    writeJsonAtomicallyAt(path, `${path}.${createUuid()}.recovery.tmp`, value),
  acquireLock: async (path) => {
    await mkdir(path);
  },
  releaseLock: rmdir,
  unlink,
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

  private busy = false;

  async recoverCandidate(
    id: string,
    overrides: Partial<RecoveryFileSystem> = {},
  ): Promise<{ warning?: string }> {
    return this.decide(id, true, { ...defaultFileSystem, ...overrides });
  }

  async discardCandidate(
    id: string,
    overrides: Partial<RecoveryFileSystem> = {},
  ): Promise<{ warning?: string }> {
    return this.decide(id, false, { ...defaultFileSystem, ...overrides });
  }

  private async decide(
    id: string,
    recover: boolean,
    fileSystem: RecoveryFileSystem,
  ): Promise<{ warning?: string }> {
    if (this.busy)
      throw new ApplicationError(
        "RECOVERY_BUSY",
        "Please wait for the current recovery operation.",
      );
    const candidate = this.getCandidates().find((item) => item.id === id);
    if (!candidate)
      throw new ApplicationError(
        "RECOVERY_CANDIDATE_NOT_FOUND",
        "This recovery candidate is no longer available.",
      );
    this.busy = true;
    let locked = false;
    let committed = false;
    const result: { warning?: string } = {};
    const lock = join(candidate.projectPath, CHAPTER_CREATION_LOCK);
    try {
      await assertSafePath(candidate.projectPath, fileSystem, true);
      try {
        await fileSystem.acquireLock(lock);
        locked = true;
      } catch {
        throw new ApplicationError(
          "PROJECT_BUSY",
          "Unable to acquire the chapter operation lock. Preserve project files and inspect any stale lock before retrying.",
        );
      }
      await assertSafePath(candidate.path, fileSystem);
      const raw = await readJson(candidate.path, fileSystem);
      const parsed =
        candidate.source === "temporary"
          ? ChapterFileSchema.safeParse(raw)
          : HistorySnapshotSchema.safeParse(raw);
      if (
        !parsed.success ||
        JSON.stringify(parsed.data.content) !==
          JSON.stringify(candidate.document) ||
        ("chapterId" in parsed.data
          ? parsed.data.chapterId
          : parsed.data.id) !== candidate.chapterId ||
        ("modified" in parsed.data
          ? parsed.data.modified
          : parsed.data.created) !== candidate.created
      )
        throw new ApplicationError(
          "RECOVERY_CANDIDATE_CHANGED",
          "Recovery data changed since startup. Cancel startup and restart to scan it again.",
        );
      if (recover) {
        await assertSafePath(
          join(candidate.projectPath, "project.json"),
          fileSystem,
        );
        const project = await readProject(candidate.projectPath, fileSystem);
        if (!project.manuscript.order.includes(candidate.chapterId))
          throw new ApplicationError(
            "CHAPTER_NOT_FOUND",
            "The recovery chapter is no longer in the project.",
          );
        const chapterPath = join(
          candidate.projectPath,
          "manuscript",
          `${candidate.chapterId}.json`,
        );
        await assertSafePath(chapterPath, fileSystem);
        const original = await readJson(chapterPath, fileSystem);
        const current = ChapterFileSchema.safeParse(original);
        if (!current.success || current.data.id !== candidate.chapterId)
          throw new ApplicationError(
            "RECOVERY_MANUSCRIPT_INVALID",
            "The original chapter is invalid. Preserve the files for manual recovery.",
          );
        if (Date.parse(current.data.modified) >= Date.parse(candidate.created))
          throw new ApplicationError(
            "RECOVERY_STALE",
            "The original chapter is now as new as this candidate. Discard this candidate or cancel startup.",
          );
        // Every existing history ancestor must be a real directory before mkdir.
        await assertSafePath(
          join(
            candidate.projectPath,
            ".history",
            "snapshots",
            candidate.chapterId,
          ),
          fileSystem,
          true,
          true,
        );
        await createHistorySnapshot(
          {
            projectPath: candidate.projectPath,
            chapterId: candidate.chapterId,
            document: current.data.content,
            reason: "before-recovery",
          },
          fileSystem,
        );
        await fileSystem.writeRecovery(chapterPath, {
          ...(original as Record<string, unknown>),
          content: parsed.data.content,
          modified: new Date(
            Math.max(Date.now(), Date.parse(candidate.created)),
          ).toISOString(),
        });
        committed = true;
      }
      try {
        await fileSystem.unlink(candidate.path);
        this.removeCandidate(id);
      } catch {
        if (!committed)
          throw new ApplicationError(
            "RECOVERY_DISCARD_FAILED",
            "Unable to discard recovery data. The original and candidate are preserved; retry or cancel startup.",
          );
        result.warning =
          "The chapter was recovered, but its recovery file could not be removed. Discard the remaining candidate to retry cleanup, or cancel startup.";
      }
      return result;
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        !error.code.startsWith("PROJECT_FILE_") &&
        !error.code.startsWith("PROJECT_TEMPORARY_")
      )
        throw error;
      throw new ApplicationError(
        "RECOVERY_FAILED",
        "Recovery could not complete. The original chapter and recovery data are preserved; retry or cancel startup.",
      );
    } finally {
      if (locked) {
        try {
          await fileSystem.releaseLock(lock);
        } catch {
          result.warning =
            "The decision completed, but the project lock could not be removed. Inspect the lock before editing.";
        }
      }
      this.busy = false;
    }
  }

  private removeCandidate(id: string): void {
    for (const [projectPath, candidates] of this.candidates) {
      const remaining = candidates.filter((candidate) => candidate.id !== id);
      if (remaining.length === 0) this.candidates.delete(projectPath);
      else this.candidates.set(projectPath, remaining);
    }
  }
}

async function readProject(
  root: string,
  fileSystem: RecoveryFileSystem,
): Promise<{ manuscript: { order: string[] } }> {
  await assertMigrationReadable(root, fileSystem);
  await assertSafePath(join(root, "project.json"), fileSystem);
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
      id: createUuid(),
      projectPath: root,
      chapterId,
      title: chapter.data.title,
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
      if (
        !parsed.success ||
        parsed.data.chapterId !== chapterId ||
        parsed.data.reason === "before-recovery"
      )
        continue;
      candidates.push({
        id: createUuid(),
        projectPath: root,
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
    await assertSafePath(path, fileSystem, true, true);
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
    await assertSafePath(path, fileSystem);
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
    await assertSafePath(path, fileSystem, true);
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

/** Reject linked ancestors, including directory junctions, before privileged I/O. */
async function assertSafePath(
  path: string,
  fileSystem: RecoveryFileSystem,
  directory = false,
  allowMissing = false,
): Promise<void> {
  const parent = dirname(path);
  if (parent !== path)
    await assertSafePath(parent, fileSystem, true, allowMissing);
  try {
    const stats = await fileSystem.lstat(path);
    if (
      stats.isSymbolicLink() ||
      (directory ? !stats.isDirectory() : !stats.isFile())
    )
      throw new ApplicationError(
        "RECOVERY_PATH_INVALID",
        "Recovery requires regular files and directories without symbolic links.",
      );
  } catch (error) {
    if (allowMissing && isMissing(error)) return;
    throw error;
  }
}
