import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  EditorialTransactionSchema,
  EditorialStateSchema,
  ChapterFileSchema,
  ProjectConfigV2Schema,
  ProjectFormatSchema,
  ProjectFormatV2Schema,
  migrateChapterV1ToEditorialV2,
  migrateProjectV2ToEditorialV3,
  createEmptyEditorialState,
  type EditorialTransaction,
} from "@drelwick/project-model";
import {
  ApplicationError,
  createUuid,
  isSafeRelativePath,
} from "@drelwick/shared";
import { withReferenceLock } from "./reference-files.js";
import {
  copySnapshot,
  hashFile,
  inspectSnapshot,
  sameSnapshot,
  syncDirectory,
} from "./project-snapshot.js";

const fail = (code: string): ApplicationError =>
  new ApplicationError(
    code,
    "Editorial save could not be completed. Preserve the project and retry after recovery.",
  );
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const safe = (path: string) =>
  isSafeRelativePath(path) &&
  !path.includes("\\") &&
  !path.split(/[\\/]/).some((part) => part === "." || part === "..");

async function ensureSafeParent(
  root: string,
  relative: string,
): Promise<string> {
  if (!safe(relative)) throw fail("EDITORIAL_INVALID");
  const target = resolve(root, ...relative.split(/[\\/]/));
  if (!target.startsWith(root + sep)) throw fail("EDITORIAL_INVALID");
  let current = root;
  const parts = relative.split(/[\\/]/);
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw fail("EDITORIAL_INVALID");
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  return target;
}
async function readOptional(path: string): Promise<Buffer | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw fail("EDITORIAL_INVALID");
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const temp = `${path}.${createUuid()}.tmp`;
  const handle = await open(
    temp,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  await syncDirectory(dirname(path));
}
async function persistManifest(
  root: string,
  dir: string,
  tx: EditorialTransaction,
): Promise<void> {
  const path = join(dir, "transaction.json");
  await writeAtomic(path, Buffer.from(JSON.stringify(tx, null, 2) + "\n"));
}
async function publishImage(
  root: string,
  dir: string,
  path: string,
  ref: EditorialTransaction["files"][number]["after"],
): Promise<void> {
  const target = await ensureSafeParent(root, path);
  if (ref === null) {
    await unlink(target).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await syncDirectory(dirname(target));
    return;
  }
  const image = join(dir, "after", ...path.split("/"));
  const bytes = await readFile(image);
  if (bytes.length !== ref.size || digest(bytes) !== ref.sha256)
    throw fail("EDITORIAL_RECOVERY_REQUIRED");
  await writeAtomic(target, bytes);
}
async function recoverOne(
  root: string,
  dir: string,
  tx: EditorialTransaction,
): Promise<void> {
  const forward = tx.phase === "committed" || tx.phase === "rolling-forward";
  // Validate the entire recovery set before changing any authoritative bytes.
  // A conflict in a later file must not leave an earlier file rolled back.
  for (const file of tx.files) {
    const live = await readOptional(await ensureSafeParent(root, file.path));
    const matches = (ref: typeof file.before) =>
      ref === null
        ? live === null
        : live !== null &&
          live.length === ref.size &&
          digest(live) === ref.sha256;
    if (!matches(file.before) && !matches(file.after))
      throw fail("EDITORIAL_RECOVERY_REQUIRED");
    for (const [side, ref] of [
      ["before", file.before],
      ["after", file.after],
    ] as const) {
      if (ref === null) continue;
      const image = await readOptional(
        await ensureSafeParent(dir, `${side}/${file.path}`),
      );
      if (
        image === null ||
        image.length !== ref.size ||
        digest(image) !== ref.sha256
      )
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
    }
  }
  tx.phase = forward ? "rolling-forward" : "rolling-back";
  await persistManifest(root, dir, tx);
  for (const file of forward ? tx.files : [...tx.files].reverse()) {
    const expected = forward ? file.after : file.before;
    const other = forward ? file.before : file.after;
    const target = await ensureSafeParent(root, file.path);
    const live = await readOptional(target);
    const known =
      (expected === null && live === null) ||
      (expected !== null &&
        live !== null &&
        live.length === expected.size &&
        digest(live) === expected.sha256) ||
      (other === null && live === null) ||
      (other !== null &&
        live !== null &&
        live.length === other.size &&
        digest(live) === other.sha256);
    if (!known) throw fail("EDITORIAL_RECOVERY_REQUIRED");
    if (expected === null) {
      if (live !== null) await unlink(target);
    } else if (
      live === null ||
      live.length !== expected.size ||
      digest(live) !== expected.sha256
    ) {
      const image = join(
        dir,
        forward ? "after" : "before",
        ...file.path.split("/"),
      );
      const bytes = await readFile(image);
      if (bytes.length !== expected.size || digest(bytes) !== expected.sha256)
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
      await writeAtomic(target, bytes);
    }
  }
  tx.phase = forward ? "complete" : "rolled-back";
  await persistManifest(root, dir, tx);
}

export interface EditorialChange {
  path: string;
  after: Uint8Array | null;
}

/** Discover recoverable operations in stable ID order; invalid evidence stays on disk. */
export async function listEditorialTransactionDrafts(input: {
  projectPath: string;
  projectId: string;
}): Promise<{
  candidates: { operationId: string; baseGeneration: number }[];
  diagnostics: { operationId: string; code: "EDITORIAL_RECOVERY_REQUIRED" }[];
}> {
  const root = await realpath(input.projectPath);
  const directory = join(root, ".editorial", "transactions");
  let ids: string[];
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw fail("EDITORIAL_RECOVERY_REQUIRED");
    ids = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { candidates: [], diagnostics: [] };
    throw error;
  }
  const candidates: { operationId: string; baseGeneration: number }[] = [];
  const diagnostics: {
    operationId: string;
    code: "EDITORIAL_RECOVERY_REQUIRED";
  }[] = [];
  for (const id of ids.sort()) {
    try {
      if (!/^[0-9a-f-]{36}$/.test(id))
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
      const path = await ensureSafeParent(
        root,
        `.editorial/transactions/${id}/transaction.json`,
      );
      const bytes = await readOptional(path);
      if (!bytes) throw fail("EDITORIAL_RECOVERY_REQUIRED");
      const tx = EditorialTransactionSchema.parse(
        JSON.parse(bytes.toString("utf8")) as unknown,
      );
      if (tx.id !== id || tx.projectId !== input.projectId)
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
      if (tx.phase !== "rolled-back" || tx.kind === "migration") continue;
      const draft = await readEditorialTransactionDraft({
        ...input,
        operationId: id,
      });
      candidates.push({
        operationId: id,
        baseGeneration: draft.baseGeneration,
      });
    } catch {
      diagnostics.push({
        operationId: id,
        code: "EDITORIAL_RECOVERY_REQUIRED",
      });
    }
  }
  return { candidates, diagnostics };
}

/** Read a rolled-back operation as a complete recovery candidate, including deletions.
 * This never reapplies it: callers must preview and explicitly commit against
 * the current generation. Retained transaction images remain authoritative evidence.
 */
export async function readEditorialTransactionDraft(input: {
  projectPath: string;
  projectId: string;
  operationId: string;
}): Promise<{
  operationId: string;
  baseGeneration: number;
  changes: EditorialChange[];
}> {
  if (!/^[0-9a-f-]{36}$/.test(input.operationId))
    throw fail("EDITORIAL_INVALID");
  return withReferenceLock(input.projectPath, async (root) => {
    const relative = `.editorial/transactions/${input.operationId}`;
    const descriptor = await readOptional(
      await ensureSafeParent(root, `${relative}/transaction.json`),
    );
    if (!descriptor) throw fail("EDITORIAL_RECOVERY_REQUIRED");
    const tx = EditorialTransactionSchema.parse(
      JSON.parse(descriptor.toString("utf8")) as unknown,
    );
    if (
      tx.id !== input.operationId ||
      tx.projectId !== input.projectId ||
      tx.phase !== "rolled-back" ||
      tx.kind === "migration"
    )
      throw fail("EDITORIAL_RECOVERY_REQUIRED");
    const changes: EditorialChange[] = [];
    for (const file of tx.files) {
      if (file.after === null) {
        changes.push({ path: file.path, after: null });
        continue;
      }
      const bytes = await readOptional(
        await ensureSafeParent(root, `${relative}/after/${file.path}`),
      );
      if (
        !bytes ||
        bytes.length !== file.after.size ||
        digest(bytes) !== file.after.sha256
      )
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
      changes.push({ path: file.path, after: bytes });
    }
    return {
      operationId: tx.id,
      baseGeneration: tx.expectedGeneration,
      changes,
    };
  });
}
export interface CommitEditorialInput {
  projectPath: string;
  projectId: string;
  operationId?: string;
  kind: EditorialTransaction["kind"];
  expectedGeneration: number;
  changes: readonly EditorialChange[];
  decisions?: EditorialTransaction["decisions"];
  expectedBefore?: Readonly<Record<string, string | null>>;
  checkpoint?: (name: string) => Promise<void>;
}
export async function commitEditorialTransaction(
  input: CommitEditorialInput,
): Promise<{ operationId: string; generation: number }> {
  const id = input.operationId ?? createUuid();
  if (
    !isAbsolute(input.projectPath) ||
    !input.changes.length ||
    !/^[0-9a-f-]{36}$/.test(id)
  )
    throw fail("EDITORIAL_INVALID");
  return withReferenceLock(input.projectPath, async (root) => {
    const dir = join(root, ".editorial", "transactions", id);
    try {
      const prior = EditorialTransactionSchema.parse(
        JSON.parse(
          await readFile(join(dir, "transaction.json"), "utf8"),
        ) as unknown,
      );
      if (
        prior.id !== id ||
        prior.projectId !== input.projectId ||
        prior.expectedGeneration !== input.expectedGeneration ||
        prior.kind !== input.kind ||
        JSON.stringify(prior.decisions) !==
          JSON.stringify(input.decisions ?? []) ||
        prior.files.length !== input.changes.length ||
        prior.files.some((file) => {
          const changes = input.changes.filter(
            (change) => change.path === file.path,
          );
          if (changes.length !== 1) return true;
          const after = changes[0]!.after;
          return after === null
            ? file.after !== null
            : file.after === null ||
                file.after.size !== after.byteLength ||
                file.after.sha256 !== digest(after);
        }) ||
        prior.phase !== "complete"
      )
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
      return {
        operationId: id,
        generation: prior.kind === "migration" ? 1 : prior.nextGeneration,
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
    }
    const manifest = JSON.parse(
      await readFile(join(root, "project.json"), "utf8"),
    ) as Record<string, unknown>;
    const migrating = input.kind === "migration";
    if (
      (migrating
        ? manifest.schemaVersion !== 2
        : manifest.schemaVersion !== 3 ||
          manifest.generation !== input.expectedGeneration) ||
      manifest.projectId !== input.projectId
    )
      throw fail("EDITORIAL_STALE");
    await mkdir(dir, { recursive: true });
    const files = [] as EditorialTransaction["files"];
    const changes = [...input.changes].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    if (
      !changes.some((change) => change.path === "project.json") ||
      !changes.some((change) => change.path === "editorial/state.json")
    )
      throw fail("EDITORIAL_INVALID");
    for (const change of changes) {
      if (!safe(change.path)) throw fail("EDITORIAL_INVALID");
      const target = await ensureSafeParent(root, change.path);
      const before = await readOptional(target);
      const after = change.after === null ? null : Buffer.from(change.after);
      files.push({
        path: change.path,
        before:
          before === null
            ? null
            : { size: before.length, sha256: digest(before) },
        after:
          after === null ? null : { size: after.length, sha256: digest(after) },
      });
      const expected = input.expectedBefore?.[change.path];
      if (
        input.expectedBefore &&
        expected !== undefined &&
        expected !== (before === null ? null : digest(before))
      )
        throw fail("EDITORIAL_STALE");
    }
    const projectImage = changes.find(
      (change) => change.path === "project.json",
    )!.after;
    const stateImage = changes.find(
      (change) => change.path === "editorial/state.json",
    )!.after;
    if (!projectImage || !stateImage) throw fail("EDITORIAL_INVALID");
    const nextProject = JSON.parse(
      Buffer.from(projectImage).toString("utf8"),
    ) as Record<string, unknown>;
    const nextState = JSON.parse(
      Buffer.from(stateImage).toString("utf8"),
    ) as Record<string, unknown>;
    if (
      nextProject.schemaVersion !== 3 ||
      nextProject.projectId !== input.projectId ||
      nextProject.generation !==
        (migrating ? 1 : input.expectedGeneration + 1) ||
      nextState.schemaVersion !== 1 ||
      nextState.projectId !== input.projectId ||
      nextState.generation !== (migrating ? 1 : input.expectedGeneration + 1)
    )
      throw fail("EDITORIAL_INVALID");
    const tx = EditorialTransactionSchema.parse({
      schemaVersion: 1,
      id,
      projectId: input.projectId,
      kind: input.kind,
      created: new Date().toISOString(),
      owner: {
        host: hostname(),
        processId: process.pid,
        processStarted: new Date().toISOString(),
      },
      phase: "prepared",
      expectedGeneration: input.expectedGeneration,
      nextGeneration: input.expectedGeneration + 1,
      files,
      decisions: input.decisions ?? [],
    });
    await mkdir(join(dir, "before"), { recursive: true });
    await mkdir(join(dir, "after"), { recursive: true });
    for (const [index, file] of files.entries()) {
      const change = changes[index]!;
      for (const [name, ref, bytes] of [
        [
          "before",
          file.before,
          await readOptional(join(root, ...file.path.split("/"))),
        ],
        [
          "after",
          file.after,
          change.after === null ? null : Buffer.from(change.after),
        ],
      ] as const) {
        if (ref === null || bytes === null) continue;
        const image = join(dir, name, ...file.path.split("/"));
        await mkdir(dirname(image), { recursive: true });
        await writeAtomic(image, bytes);
        const verified = await readOptional(image);
        if (
          verified === null ||
          verified.length !== ref.size ||
          digest(verified) !== ref.sha256
        )
          throw fail("EDITORIAL_RECOVERY_REQUIRED");
      }
    }
    await input.checkpoint?.("after-images");
    await persistManifest(root, dir, tx);
    await input.checkpoint?.("prepared");
    // Publish the version/generation gate only after all dependent images.
    const publicationOrder = [
      ...files.filter((file) => file.path !== "project.json"),
      ...files.filter((file) => file.path === "project.json"),
    ];
    for (const file of publicationOrder) {
      const live = await readOptional(await ensureSafeParent(root, file.path));
      const ref = file.before;
      if (!(
        (ref === null && live === null) ||
        (ref !== null &&
          live !== null &&
          live.length === ref.size &&
          digest(live) === ref.sha256)
      ))
        throw fail("EDITORIAL_STALE");
      await publishImage(root, dir, file.path, file.after);
      await input.checkpoint?.("after-publication");
    }
    tx.phase = "committed";
    await persistManifest(root, dir, tx);
    await input.checkpoint?.("committed");
    tx.phase = "complete";
    await persistManifest(root, dir, tx);
    return { operationId: id, generation: migrating ? 1 : tx.nextGeneration };
  });
}

export async function recoverEditorialTransactions(
  projectPath: string,
): Promise<void> {
  const root = await realpath(projectPath);
  const transactions = join(root, ".editorial", "transactions");
  let ids: string[];
  try {
    ids = await readdir(transactions);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw fail("EDITORIAL_RECOVERY_REQUIRED");
  }
  await withReferenceLock(root, async () => {
    for (const id of ids.sort()) {
      if (!/^[0-9a-f-]{36}$/.test(id))
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
      const dir = join(transactions, id);
      const raw = JSON.parse(
        await readFile(join(dir, "transaction.json"), "utf8"),
      ) as unknown;
      const parsed = EditorialTransactionSchema.safeParse(raw);
      if (!parsed.success || parsed.data.id !== id)
        throw fail("EDITORIAL_RECOVERY_REQUIRED");
      if (
        parsed.data.phase === "complete" ||
        parsed.data.phase === "rolled-back"
      )
        continue;
      await recoverOne(root, dir, parsed.data);
    }
  });
}

/** Create a verified complete safety copy, then migrate v2/v1 files as one journaled generation. */
export async function migrateProjectToEditorialV3(
  projectPath: string,
  options: {
    operationId?: string;
    checkpoint?: (point: string) => Promise<void>;
  } = {},
): Promise<{ operationId: string; backupPath: string }> {
  if (!isAbsolute(projectPath)) throw fail("EDITORIAL_INVALID");
  const root = await realpath(projectPath);
  await recoverEditorialTransactions(root);
  const rawProjectBytes = await readFile(join(root, "project.json"));
  const rawProject = JSON.parse(rawProjectBytes.toString("utf8")) as unknown;
  const project = ProjectConfigV2Schema.parse(rawProject);
  const rawFormat = JSON.parse(
    await readFile(join(root, project.formatFile), "utf8"),
  ) as unknown;
  const format = ProjectFormatSchema.parse(rawFormat);
  if (format.projectId !== project.projectId) throw fail("EDITORIAL_INVALID");
  const snapshot = await inspectSnapshot(root, true);
  if (snapshot.files.some((file) => file.path.startsWith(".editorial/")))
    throw fail("EDITORIAL_UNSUPPORTED");
  const operationId = options.operationId ?? createUuid();
  if (!/^[0-9a-f-]{36}$/.test(operationId)) throw fail("EDITORIAL_INVALID");
  const backupPath = `.editorial/migration-backups/${operationId}`;
  const backupAbsolute = join(root, ...backupPath.split("/"));
  try {
    await lstat(backupAbsolute);
    throw fail("EDITORIAL_INVALID");
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(backupAbsolute), { recursive: true });
  await copySnapshot(root, backupAbsolute, snapshot, async () => {
    await options.checkpoint?.("backup-image");
  });
  const copied = await inspectSnapshot(backupAbsolute);
  if (!sameSnapshot(snapshot, copied)) throw fail("EDITORIAL_INVALID");
  await options.checkpoint?.("backup-verified");
  for (const file of snapshot.files) {
    if ((await hashFile(join(root, ...file.path.split("/")))) !== file.sha256)
      throw fail("EDITORIAL_STALE");
  }

  const changes: EditorialChange[] = [];
  const oldFiles = new Map(snapshot.files.map((file) => [file.path, file]));
  for (const chapterId of project.manuscript.order) {
    const path = `manuscript/${chapterId}.json`;
    const bytes = await readFile(join(root, ...path.split("/")));
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    const allowed = new Set([
      "schemaVersion",
      "id",
      "type",
      "title",
      "status",
      "created",
      "modified",
      "content",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
      throw fail("EDITORIAL_UNSUPPORTED");
    const chapter = ChapterFileSchema.parse(value);
    if (chapter.id !== chapterId) throw fail("EDITORIAL_INVALID");
    changes.push({
      path,
      after: Buffer.from(
        `${JSON.stringify(migrateChapterV1ToEditorialV2(chapter), null, 2)}\n`,
      ),
    });
  }
  const migratedProject = migrateProjectV2ToEditorialV3(project);
  const migratedFormat = ProjectFormatV2Schema.parse({
    schemaVersion: 2,
    projectId: project.projectId,
    bookSchemaVersion: 1,
    chapterSchemaVersion: 2,
    editorialSchemaVersion: 1,
    sliceCodec: "semantic-slice-v1",
    hashCodec: "canonical-json-v1",
  });
  const editorialState = EditorialStateSchema.parse(
    createEmptyEditorialState(project.projectId),
  );
  changes.push(
    {
      path: "editorial/state.json",
      after: Buffer.from(`${JSON.stringify(editorialState, null, 2)}\n`),
    },
    {
      path: project.formatFile,
      after: Buffer.from(`${JSON.stringify(migratedFormat, null, 2)}\n`),
    },
    {
      path: "project.json",
      after: Buffer.from(`${JSON.stringify(migratedProject, null, 2)}\n`),
    },
  );
  const expectedBefore: Record<string, string | null> = Object.fromEntries(
    changes.map((change) => [
      change.path,
      oldFiles.get(change.path)?.sha256 ?? null,
    ]),
  );
  const result = await commitEditorialTransaction({
    projectPath: root,
    projectId: project.projectId,
    operationId,
    kind: "migration",
    expectedGeneration: 1,
    changes,
    expectedBefore,
    ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}),
  });
  return { operationId: result.operationId, backupPath };
}
