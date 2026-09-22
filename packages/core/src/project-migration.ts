import {
  MigrationLockSchema,
  MigrationStateSchema,
  migrateV1Manifest,
  type MigrationState,
  type ProjectSnapshot,
} from "@sarel/project-model";
import { ApplicationError, createUuid } from "@sarel/shared";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  openProject,
  validateProjectFiles,
  writeJsonAtomicallyAt,
  type OpenedProject,
} from "./index.js";
import {
  MIGRATION_DIRECTORY,
  MIGRATION_ERRORS,
  assertKnownVersion,
  isMissing,
  migrationError,
  readMigrationState,
  type MigrationErrorCode,
} from "./migration-state.js";
import {
  assertRegularPath,
  copySnapshot,
  hashFile,
  inspectSnapshot,
  sameSnapshot,
  syncDirectory,
} from "./project-snapshot.js";

export const MIGRATION_CHECKPOINTS = [
  "before-workspace",
  "after-workspace",
  "before-lock",
  "after-lock",
  "after-initial-journal",
  "before-backup",
  "during-backup",
  "after-backup-copy",
  "before-backup-verification",
  "after-backup-verification",
  "after-backup-journal",
  "before-staging",
  "during-staging",
  "after-staging",
  "before-validation",
  "after-validation",
  "after-validation-journal",
  "before-commit",
  "after-commit-intent",
  "before-format-commit",
  "after-format-commit",
  "after-format-journal",
  "before-project-commit",
  "after-project-commit",
  "after-project-journal",
  "after-authoritative-commit",
  "before-finalisation",
  "after-finalisation",
  "before-lock-release",
  "after-lock-release",
] as const;
export const MIGRATION_RECOVERY_CHECKPOINTS = [
  "after-recovery-claim",
  "after-stale-lock-removal",
] as const;
export type MigrationCheckpoint =
  | (typeof MIGRATION_CHECKPOINTS)[number]
  | (typeof MIGRATION_RECOVERY_CHECKPOINTS)[number];
export interface MigrationOptions {
  /** Deterministic failure/termination boundary, never exposed through IPC. */
  checkpoint?: (point: MigrationCheckpoint) => Promise<void>;
  replace?: typeof rename;
  releaseLock?: typeof unlink;
}

const active = new Set<string>();
const abandonedOwners = new Set<string>();

function assertOwnerStopped(
  owner: ReturnType<typeof MigrationLockSchema.parse>,
  record: string,
): void {
  if (owner.host !== hostname()) throw migrationError("PROJECT_BUSY");
  // A failed local release is known to have finished its operation. No such
  // assumption is made about a different live process or an unrecognised lock.
  if (owner.pid === process.pid && abandonedOwners.has(record)) return;
  try {
    process.kill(owner.pid, 0);
    throw migrationError("PROJECT_BUSY");
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    ))
      throw migrationError("PROJECT_BUSY");
  }
}

async function regularJson(root: string, path: string): Promise<unknown> {
  await assertRegularPath(root, path);
  try {
    return JSON.parse(await readFile(join(root, path), "utf8")) as unknown;
  } catch {
    throw migrationError("MIGRATION_STATE_INVALID");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function canonicalRoot(projectPath: string): Promise<string> {
  if (!isAbsolute(projectPath))
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be absolute.",
    );
  try {
    return await realpath(projectPath);
  } catch {
    throw new ApplicationError(
      "PROJECT_PATH_ACCESS_FAILED",
      "Unable to access project folder.",
    );
  }
}

async function inspectCompatibility(root: string): Promise<number> {
  const project = await regularJson(root, "project.json");
  assertKnownVersion(project, 2);
  return (project as { schemaVersion: number }).schemaVersion;
}

/** Authorised desktop opens use this entry; ordinary readers never start migrations. */
export async function openProjectForEditing(
  projectPath: string,
  options: MigrationOptions = {},
): Promise<OpenedProject> {
  const root = await canonicalRoot(projectPath);
  const version = await inspectCompatibility(root);
  if (version === 1 || (await exists(join(root, MIGRATION_DIRECTORY))))
    await migrateProject(root, options);
  return openProject(root, { rebuildSummaries: true });
}

/** Startup resolves an existing transaction before scanning chapter recovery data. */
export async function recoverProjectMigration(
  projectPath: string,
): Promise<void> {
  const root = await canonicalRoot(projectPath);
  await inspectCompatibility(root);
  if (await exists(join(root, MIGRATION_DIRECTORY))) await migrateProject(root);
}

async function writeState(root: string, state: MigrationState): Promise<void> {
  MigrationStateSchema.parse(state);
  const work = join(root, MIGRATION_DIRECTORY);
  await writeJsonAtomicallyAt(
    join(work, "state.json"),
    join(work, `journal-${createUuid()}.tmp`),
    state,
  );
  await syncDirectory(work);
}

async function verifyBackup(
  root: string,
  state: MigrationState,
): Promise<string> {
  try {
    const backup = join(root, MIGRATION_DIRECTORY, state.backup);
    const info = await lstat(backup);
    if (!info.isDirectory() || info.isSymbolicLink() || !state.snapshot)
      throw migrationError("MIGRATION_BACKUP_INVALID");
    if (!sameSnapshot(state.snapshot, await inspectSnapshot(backup)))
      throw migrationError("MIGRATION_BACKUP_INVALID");
    const original = await validateProjectFiles(backup);
    if (
      original.project.schemaVersion !== 1 ||
      original.project.projectId !== state.projectId
    )
      throw migrationError("MIGRATION_BACKUP_INVALID");
    return backup;
  } catch {
    throw migrationError("MIGRATION_BACKUP_INVALID");
  }
}

async function verifyOriginal(
  root: string,
  snapshot: ProjectSnapshot,
): Promise<void> {
  if (!sameSnapshot(snapshot, await inspectSnapshot(root, true)))
    throw migrationError("MIGRATION_STATE_INVALID");
}

// Only migration-owned hard links with a matching owner record are reclaimable.
// Existing chapter-operation directories (including stale ones) are never stolen.
async function acquireLock(
  root: string,
  point: (p: MigrationCheckpoint) => Promise<void>,
): Promise<string> {
  const work = join(root, MIGRATION_DIRECTORY);
  const lock = join(root, ".chapter-create.lock");
  const token = createUuid();
  const ownerPath = join(work, `owner-${token}.json`);
  let claimed: string | undefined;
  let published = false;
  try {
    await writeJsonAtomicallyAt(ownerPath, `${ownerPath}.tmp`, {
      schemaVersion: 1,
      token,
      pid: process.pid,
      host: hostname(),
    });
    await syncDirectory(work);
    if (await exists(lock)) {
      const info = await lstat(lock);
      if (!info.isFile() || info.isSymbolicLink())
        throw migrationError("PROJECT_BUSY");
      let owner;
      try {
        owner = MigrationLockSchema.parse(
          await regularJson(root, ".chapter-create.lock"),
        );
      } catch {
        throw migrationError("PROJECT_BUSY");
      }
      const tokenPath = join(work, `owner-${owner.token}.json`);
      assertOwnerStopped(owner, tokenPath);
      await assertRegularPath(work, `owner-${owner.token}.json`);
      const tokenInfo = await lstat(tokenPath);
      // Atomically elect one recovery process for this dead owner's token. A
      // terminated recovery claimant is itself reclaimed via another token claim.
      // This avoids check/unlink races between simultaneous recovery processes.
      let claimToken = owner.token;
      const visited = new Set<string>();
      while (true) {
        if (visited.has(claimToken) || visited.size >= 1000)
          throw migrationError("MIGRATION_STATE_INVALID");
        visited.add(claimToken);
        const claim = `recovery-${claimToken}.json`;
        try {
          await link(ownerPath, join(work, claim));
          claimed = join(work, claim);
          await syncDirectory(work);
          break;
        } catch (error) {
          if (!(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EEXIST"
          ))
            throw error;
        }
        const claimant = MigrationLockSchema.parse(
          await regularJson(work, claim),
        );
        await assertRegularPath(work, `owner-${claimant.token}.json`);
        const claimedInfo = await lstat(join(work, claim));
        const claimantInfo = await lstat(
          join(work, `owner-${claimant.token}.json`),
        );
        if (
          claimedInfo.ino !== claimantInfo.ino ||
          claimedInfo.dev !== claimantInfo.dev ||
          claimant.host !== hostname()
        )
          throw migrationError("PROJECT_BUSY");
        assertOwnerStopped(
          claimant,
          join(work, `owner-${claimant.token}.json`),
        );
        claimToken = claimant.token;
      }
      const latest = await lstat(lock);
      if (
        info.ino !== tokenInfo.ino ||
        info.dev !== tokenInfo.dev ||
        latest.ino !== info.ino ||
        latest.dev !== info.dev
      )
        throw migrationError("PROJECT_BUSY");
      await point("after-recovery-claim");
      await unlink(lock);
      await syncDirectory(root);
      await point("after-stale-lock-removal");
    }
    try {
      await link(ownerPath, lock);
      published = true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      )
        throw migrationError("PROJECT_BUSY");
      throw migrationError("MIGRATION_FAILED");
    }
    await syncDirectory(root);
    return ownerPath;
  } catch (error) {
    // Normal I/O failures release this attempt's claims. Abrupt termination
    // leaves durable owner records for the next process to reclaim instead.
    abandonedOwners.add(ownerPath);
    if (published) {
      await assertOwnedLock(root, ownerPath);
      await unlink(lock);
    }
    if (claimed) await unlink(claimed);
    throw error;
  }
}

async function assertOwnedLock(root: string, owner: string): Promise<void> {
  const lock = await lstat(join(root, ".chapter-create.lock"));
  const token = await lstat(owner);
  if (
    !lock.isFile() ||
    lock.isSymbolicLink() ||
    lock.ino !== token.ino ||
    lock.dev !== token.dev
  )
    throw migrationError("PROJECT_BUSY");
}

async function stageMigration(
  root: string,
  state: MigrationState,
  point: (p: MigrationCheckpoint) => Promise<void>,
): Promise<void> {
  const backup = await verifyBackup(root, state);
  await verifyOriginal(root, state.snapshot!);
  state.phase = "staging";
  state.stage = `stage-${createUuid()}`;
  await writeState(root, state);
  const stage = join(root, MIGRATION_DIRECTORY, state.stage);
  await point("before-staging");
  await copySnapshot(backup, stage, state.snapshot!, () =>
    point("during-staging"),
  );
  // Copy validation is byte-based, independent of schema parsing/normalisation.
  if (!sameSnapshot(state.snapshot!, await inspectSnapshot(stage)))
    throw migrationError("MIGRATION_STAGE_INVALID");
  const manifest = migrateV1Manifest(
    await readFile(join(backup, "project.json"), "utf8"),
  );
  const handle = await open(join(stage, "project.json"), "w");
  try {
    await handle.writeFile(manifest, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await writeJsonAtomicallyAt(
    join(stage, "format.json"),
    join(stage, `migration-format-${createUuid()}.tmp`),
    {
      schemaVersion: 1,
      projectId: state.projectId,
      bookSchemaVersion: 1,
      chapterSchemaVersion: 1,
    },
  );
  await syncDirectory(stage);
  await point("after-staging");
  await point("before-validation");
  const validated = await validateProjectFiles(stage).catch(() => {
    throw migrationError("MIGRATION_STAGE_INVALID");
  });
  if (
    validated.project.schemaVersion !== 2 ||
    validated.project.projectId !== state.projectId
  )
    throw migrationError("MIGRATION_STAGE_INVALID");
  state.staged = [];
  for (const path of ["format.json", "project.json"] as const)
    state.staged.push({ path, sha256: await hashFile(join(stage, path)) });
  await point("after-validation");
  await verifyOriginal(root, state.snapshot!);
  state.phase = "validated";
  await writeState(root, state);
  await point("after-validation-journal");
}

async function verifyCommitInputs(
  root: string,
  state: MigrationState,
): Promise<void> {
  await verifyBackup(root, state);
  const stage = join(root, MIGRATION_DIRECTORY, state.stage);
  await assertRegularPath(stage, "project.json");
  for (const file of state.staged) {
    await assertRegularPath(stage, file.path);
    if ((await hashFile(join(stage, file.path))) !== file.sha256)
      throw migrationError("MIGRATION_STAGE_INVALID");
  }
  const loaded = await validateProjectFiles(stage).catch(() => {
    throw migrationError("MIGRATION_STAGE_INVALID");
  });
  if (
    loaded.project.schemaVersion !== 2 ||
    loaded.project.projectId !== state.projectId
  )
    throw migrationError("MIGRATION_STAGE_INVALID");
  try {
    await verifyRevision(stage, state, false);
  } catch {
    throw migrationError("MIGRATION_STAGE_INVALID");
  }
  await verifyRevision(root, state, true);
}

async function verifyRevision(
  root: string,
  state: MigrationState,
  allowOriginal: boolean,
): Promise<void> {
  // Every unchanged file must still equal the captured original, including prose,
  // unknown author files, recovery temporaries and history. Changed targets may
  // be only the journaled original or staged bytes, even after a torn state update.
  const current = await inspectSnapshot(root, true);
  const original = state.snapshot!;
  if (
    JSON.stringify(current.directories) !== JSON.stringify(original.directories)
  )
    throw migrationError("MIGRATION_STATE_INVALID");
  const targets = new Map<string, string>(
    state.staged.map((file) => [file.path, file.sha256]),
  );
  const originals = new Map(original.files.map((file) => [file.path, file]));
  for (const file of current.files) {
    const before = originals.get(file.path);
    const target = targets.get(file.path);
    if (
      file.sha256 !== target &&
      !(
        file.sha256 === before?.sha256 &&
        (allowOriginal || target === undefined)
      )
    )
      throw migrationError("MIGRATION_STATE_INVALID");
  }
  for (const file of original.files)
    if (!current.files.some((item) => item.path === file.path))
      throw migrationError("MIGRATION_STATE_INVALID");
  if (!allowOriginal)
    for (const file of state.staged)
      if (
        !current.files.some(
          (item) => item.path === file.path && item.sha256 === file.sha256,
        )
      )
        throw migrationError("MIGRATION_STATE_INVALID");
}

/** A concrete historical V1 -> V2 transaction. Future versions add new steps. */
export async function migrateProject(
  projectPath: string,
  options: MigrationOptions = {},
): Promise<void> {
  const root = await canonicalRoot(projectPath);
  if (active.has(root)) throw migrationError("PROJECT_BUSY");
  active.add(root);
  let owner: string | undefined;
  let code: MigrationErrorCode = "MIGRATION_FAILED";
  const point = async (value: MigrationCheckpoint) => {
    await options.checkpoint?.(value);
  };
  try {
    const version = await inspectCompatibility(root);
    const work = join(root, MIGRATION_DIRECTORY);
    let state: MigrationState | null;
    try {
      state = await readMigrationState(root);
    } catch (error) {
      if (!(
        error instanceof ApplicationError &&
        error.code === "MIGRATION_RECOVERY_REQUIRED"
      ))
        throw error;
      // Missing initial state is safe only before any backup/staging has begun.
      const names = await readdir(work);
      if (
        names.some(
          (name) =>
            !/^((owner|recovery)-[a-f0-9-]+\.json(?:\.tmp)?|journal-[a-f0-9-]+\.tmp)$/.test(
              name,
            ),
        )
      )
        throw migrationError("MIGRATION_STATE_INVALID");
      state = null;
    }
    if (!state && version === 2) {
      await validateProjectFiles(root);
      return;
    }
    if (!state) {
      await validateProjectFiles(root);
      if (
        (await readdir(root)).some(
          (name) => name.toLowerCase() === "format.json",
        )
      )
        throw migrationError("MIGRATION_TARGET_CONFLICT");
      // Validate the exact lossless transformation before creating any artifacts.
      try {
        migrateV1Manifest(await readFile(join(root, "project.json"), "utf8"));
      } catch {
        throw migrationError("MIGRATION_TARGET_CONFLICT");
      }
    } else {
      // Compatibility checks precede any recovery writes, even for stale journals.
      await validateProjectFiles(root);
      const project = (await regularJson(root, "project.json")) as {
        projectId: string;
      };
      if (project.projectId !== state.projectId)
        throw migrationError("MIGRATION_STATE_INVALID");
      if (state.phase === "complete" && version !== 2)
        throw migrationError("MIGRATION_STATE_INVALID");
      if (
        state.phase === "complete" &&
        !(await exists(join(root, ".chapter-create.lock")))
      )
        return;
    }
    await point("before-workspace");
    if (!(await exists(work))) {
      await mkdir(work);
      await syncDirectory(root);
    }
    await point("after-workspace");
    await point("before-lock");
    owner = await acquireLock(root, point);
    await point("after-lock");
    // Another process may have finished while this caller waited for filesystem I/O.
    const latest = await readMigrationState(root).catch((error: unknown) => {
      if (
        error instanceof ApplicationError &&
        error.code === "MIGRATION_RECOVERY_REQUIRED"
      )
        return null;
      throw error;
    });
    state = latest ?? state;
    if (!state) {
      const loaded = await validateProjectFiles(root);
      state = {
        schemaVersion: 1,
        from: 1,
        to: 2,
        projectId: loaded.project.projectId,
        phase: "preparing",
        backup: `backup-${createUuid()}`,
        stage: `stage-${createUuid()}`,
        snapshot: null,
        staged: [],
        committedFiles: 0,
      };
      await writeState(root, state);
      await point("after-initial-journal");
    }
    if (state.phase === "complete") return;
    // A committed-but-unfinalised journal still owns both target files. Replay
    // their recorded replacements if directory-entry durability lagged the journal.
    if (state.phase === "committed") state.phase = "committing";
    if (state.phase === "preparing") {
      code = "MIGRATION_BACKUP_FAILED";
      // A failed partial copy is retained. A retry starts a new independent copy.
      state.backup = `backup-${createUuid()}`;
      await writeState(root, state);
      await point("before-backup");
      const snapshot = await inspectSnapshot(root, true);
      await copySnapshot(root, join(work, state.backup), snapshot, () =>
        point("during-backup"),
      );
      await point("after-backup-copy");
      code = "MIGRATION_BACKUP_INVALID";
      await point("before-backup-verification");
      state.snapshot = snapshot;
      await verifyBackup(root, state);
      await verifyOriginal(root, snapshot);
      await point("after-backup-verification");
      state.phase = "backup-verified";
      await writeState(root, state);
      await point("after-backup-journal");
    }
    if (["backup-verified", "staging"].includes(state.phase)) {
      code = "MIGRATION_STAGE_INVALID";
      await stageMigration(root, state, point);
    }
    if (state.phase === "validated") {
      code = "MIGRATION_STAGE_INVALID";
      await verifyCommitInputs(root, state);
      await point("before-commit");
      state.phase = "committing";
      state.committedFiles = 0;
      await writeState(root, state);
      await point("after-commit-intent");
    }
    if (state.phase === "committing") {
      code = "MIGRATION_COMMIT_FAILED";
      await verifyCommitInputs(root, state);
      for (const [index, file] of state.staged.entries()) {
        await assertOwnedLock(root, owner);
        const label = file.path === "format.json" ? "format" : "project";
        await point(`before-${label}-commit`);
        const destination = join(root, file.path);
        if (
          !(await exists(destination)) ||
          (await hashFile(destination)) !== file.sha256
        ) {
          const temporary = join(work, `commit-${createUuid()}.tmp`);
          await copyFile(
            join(work, state.stage, file.path),
            temporary,
            constants.COPYFILE_EXCL,
          );
          const handle = await open(temporary, "r+");
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
          if ((await hashFile(temporary)) !== file.sha256)
            throw migrationError("MIGRATION_STAGE_INVALID");
          if (file.path === "format.json") {
            // New descriptors must never overwrite an unrelated file appearing
            // after validation. This is the existing exclusive-publication pattern.
            await link(temporary, destination);
            await unlink(temporary);
          } else await (options.replace ?? rename)(temporary, destination);
          await syncDirectory(root);
        }
        await point(`after-${label}-commit`);
        state.committedFiles = index + 1;
        await writeState(root, state);
        await point(`after-${label}-journal`);
      }
      const loaded = await validateProjectFiles(root);
      if (loaded.project.schemaVersion !== 2)
        throw migrationError("MIGRATION_STATE_INVALID");
      state.phase = "committed";
      await writeState(root, state);
      await point("after-authoritative-commit");
    }
    if (state.phase === "committed") {
      code = "MIGRATION_COMMIT_FAILED";
      await point("before-finalisation");
      await verifyCommitInputs(root, state);
      await verifyRevision(root, state, false);
      await validateProjectFiles(root);
      state.phase = "complete";
      await writeState(root, state);
      await point("after-finalisation");
    }
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      (Object.hasOwn(MIGRATION_ERRORS, error.code) ||
        [
          "PROJECT_SCHEMA_INVALID",
          "PROJECT_ORDER_INVALID",
          "PROJECT_PATH_INVALID",
          "PROJECT_FILE_MISSING",
        ].includes(error.code))
    )
      throw error;
    throw migrationError(code);
  } finally {
    try {
      if (owner)
        await releaseMigrationLock(
          root,
          owner,
          point,
          options.releaseLock ?? unlink,
        );
    } finally {
      active.delete(root);
    }
  }
}

async function releaseMigrationLock(
  root: string,
  owner: string,
  point: (p: MigrationCheckpoint) => Promise<void>,
  remove: typeof unlink,
): Promise<void> {
  try {
    try {
      await point("before-lock-release");
    } finally {
      await assertOwnedLock(root, owner);
      await remove(join(root, ".chapter-create.lock"));
      await syncDirectory(root);
    }
    await point("after-lock-release");
  } catch {
    abandonedOwners.add(owner);
    throw migrationError("MIGRATION_RECOVERY_REQUIRED");
  }
}
