import {
  MigrationStateSchema,
  detectProjectVersion,
  type MigrationState,
} from "@bookeditor/project-model";
import { ApplicationError } from "@bookeditor/shared";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export const MIGRATION_DIRECTORY = ".bookeditor-migration";
export const MIGRATION_ERRORS = {
  PROJECT_VERSION_MALFORMED:
    "The project has missing or malformed version information. Preserve the project and restore a valid copy.",
  PROJECT_SCHEMA_UNSUPPORTED:
    "This project requires a newer compatible version of BookEditor. Its files have not been rewritten.",
  MIGRATION_BACKUP_FAILED:
    "Unable to create the pre-migration backup. Check disk space and permissions; project files were not migrated.",
  MIGRATION_BACKUP_INVALID:
    "The pre-migration backup failed verification. Preserve the project and its backup; migration cannot continue.",
  MIGRATION_STAGE_INVALID:
    "Staged migration data failed validation. The verified backup has been retained.",
  MIGRATION_COMMIT_FAILED:
    "The migration commit was interrupted. Preserve the project and its backup, then reopen to resume safely.",
  MIGRATION_FAILED:
    "Project migration could not finish. Preserve the project and its backup, check disk space and permissions, then reopen.",
  MIGRATION_RECOVERY_REQUIRED:
    "An interrupted migration must finish recovery before this project can be opened for editing.",
  MIGRATION_STATE_INVALID:
    "Migration state is invalid or conflicts with project files. Preserve the entire project, including its migration backup, for recovery.",
  MIGRATION_TARGET_CONFLICT:
    "A file already occupies the new format descriptor location. Preserve it and resolve the conflict before migrating.",
  PROJECT_BUSY:
    "Another project operation holds the lock. Close other project processes before retrying; unrelated locks are never removed.",
} as const;
export type MigrationErrorCode = keyof typeof MIGRATION_ERRORS;
export function migrationError(code: MigrationErrorCode): ApplicationError {
  return new ApplicationError(code, MIGRATION_ERRORS[code]);
}

export function assertKnownVersion(value: unknown, current: number): void {
  const detection = detectProjectVersion(value, current);
  if (detection.kind === "malformed")
    throw migrationError("PROJECT_VERSION_MALFORMED");
  if (detection.kind === "newer")
    throw migrationError("PROJECT_SCHEMA_UNSUPPORTED");
}

interface StateFileSystem {
  lstat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

export function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function readMigrationState(
  root: string,
  fs: StateFileSystem = { lstat, readFile },
): Promise<MigrationState | null> {
  const directory = join(root, MIGRATION_DIRECTORY);
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw migrationError("MIGRATION_STATE_INVALID");
  } catch (error) {
    if (isMissing(error)) return null;
    throw migrationError("MIGRATION_STATE_INVALID");
  }
  try {
    const path = join(directory, "state.json");
    const info = await fs.lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw migrationError("MIGRATION_STATE_INVALID");
    const parsed = MigrationStateSchema.safeParse(
      JSON.parse(await fs.readFile(path, "utf8")) as unknown,
    );
    if (!parsed.success) throw migrationError("MIGRATION_STATE_INVALID");
    const state = parsed.data;
    if (state.phase !== "preparing" && state.snapshot === null)
      throw migrationError("MIGRATION_STATE_INVALID");
    if (
      ["validated", "committing", "committed", "complete"].includes(
        state.phase,
      ) &&
      (state.staged.length !== 2 ||
        state.staged[0]?.path !== "format.json" ||
        state.staged[1]?.path !== "project.json")
    )
      throw migrationError("MIGRATION_STATE_INVALID");
    return state;
  } catch (error) {
    // Only a not-yet-published initial journal may be absent. The coordinator
    // checks the directory inventory before initializing it; readers stay gated.
    if (isMissing(error)) throw migrationError("MIGRATION_RECOVERY_REQUIRED");
    throw migrationError("MIGRATION_STATE_INVALID");
  }
}

export async function assertMigrationReadable(
  root: string,
  fs?: StateFileSystem,
): Promise<MigrationState | null> {
  const state = await readMigrationState(root, fs);
  if (state && state.phase !== "complete")
    throw migrationError("MIGRATION_RECOVERY_REQUIRED");
  return state;
}
