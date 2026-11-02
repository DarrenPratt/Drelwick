import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  statfs,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ChapterFileV2Schema,
  decodeEditorialDocument,
  isEditorialDocumentBoundary,
  EditorialStateSchema,
  ProjectConfigV3Schema,
  ProjectConfigSchema,
  ManuscriptSnapshotSchema,
  SnapshotDeletionSchema,
  SnapshotLabelSchema,
  RestoreConflictSchema,
  MANUSCRIPT_SNAPSHOT_LIMITS,
  SNAPSHOT_OPTIONAL_FILES,
  SNAPSHOT_EXCLUSIONS,
  parseEditorialJson,
  ImageAttributesSchema,
  type ManuscriptSnapshot,
  type RestoreConflict,
  type EditorialState,
  type ChapterFileV2,
} from "@drelwick/project-model";
import {
  ApplicationError,
  createUuid,
  type SnapshotSource,
  type SnapshotSelection,
  type SnapshotSummary,
  type SnapshotListing,
  type SnapshotInspection,
  type SnapshotRestorePreview,
} from "@drelwick/shared";
import { openProject } from "./index.js";
import { boundedRead, readImageAsset, regularPath } from "./image-assets.js";
import {
  withReferenceLock,
  referenceDirectory,
  referenceExclusive,
  referenceFingerprint,
} from "./reference-files.js";
import {
  copySnapshot,
  syncDirectory,
  inspectSnapshot,
} from "./project-snapshot.js";
import {
  assertEditorialReadable,
  commitPreparedEditorialTransaction,
  readEditorialRequestReceipt,
  type EditorialChange,
} from "./editorial-transactions.js";
import {
  editorialDocumentHash,
  validateEditorialBundle,
} from "./editorial-bundle.js";
import { readBookPresentation } from "./book-presentation.js";
import { readPrintConfiguration } from "./print-configuration.js";
import { readPublication } from "./publication.js";

const fail = (code = "SNAPSHOT_INCOMPLETE") =>
  new ApplicationError(
    code,
    "The snapshot operation could not finish safely. Saved manuscript data and recovery evidence were preserved. Refresh or reopen the project before retrying.",
  );
const bytes = (value: unknown) =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
const strictId = (id: string) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id,
    )
  )
    throw fail("EDITORIAL_INVALID");
};
type Scope = {
  project: ReturnType<typeof ProjectConfigV3Schema.parse>;
  state: EditorialState;
  chapters: ChapterFileV2[];
  files: ManuscriptSnapshot["files"];
  absent: ManuscriptSnapshot["absent"];
  source: SnapshotSource;
  conflicts: RestoreConflict[];
  context: Record<string, unknown>;
};
export class ManuscriptSnapshotError extends ApplicationError {
  constructor(readonly component: string) {
    super(
      "SNAPSHOT_INCOMPLETE",
      "A required snapshot component is unavailable or unsupported.",
    );
  }
}
export interface SnapshotOptions {
  authorized?: () => boolean;
  checkpoint?: (point: string) => Promise<void>;
}

async function snapshotCheckpoint(options: SnapshotOptions, point: string) {
  if (options.authorized?.() === false) throw fail("PROJECT_ACCESS_DENIED");
  await options.checkpoint?.(point);
  if (options.authorized?.() === false) throw fail("PROJECT_ACCESS_DENIED");
}

function conflictBytes(value: unknown) {
  const raw = bytes(value);
  if (raw.length > MANUSCRIPT_SNAPSHOT_LIMITS.componentBytes)
    throw fail("EDITORIAL_LIMIT");
  RestoreConflictSchema.parse(value);
  return raw;
}

async function optional(root: string, path: string): Promise<Buffer | null> {
  try {
    return await boundedRead(join(root, path), 64 * 1024 ** 2);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
async function childNames(root: string, path: string): Promise<string[]> {
  try {
    await regularPath(join(root, path), true);
    return (await readdir(join(root, path))).sort();
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}
function imageIds(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const child of value) imageIds(child, result);
    return result;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.coverAssetId === "string") result.add(record.coverAssetId);
  if (record.type === "image")
    result.add(ImageAttributesSchema.parse(record.attrs).assetId);
  for (const child of Object.values(record)) imageIds(child, result);
  return result;
}
async function readScope(root: string, projectId: string): Promise<Scope> {
  await assertEditorialReadable(root);
  const opened = await openProject(
    root,
    {},
    {
      readFile,
      lstat,
      realpath: (await import("node:fs/promises")).realpath,
      writeJson: async () => undefined,
    },
  );
  if (opened.project.schemaVersion !== 3) throw fail("EDITORIAL_UNSUPPORTED");
  const project = ProjectConfigV3Schema.parse(opened.project);
  if (project.projectId !== projectId) throw fail("EDITORIAL_STALE");
  const files: ManuscriptSnapshot["files"] = [];
  const absent: Scope["absent"] = [];
  let total = 0,
    semantic = 0;
  const capture = async (path: string, component = false): Promise<unknown> => {
    const raw = await boundedRead(
      join(root, path),
      component ? MANUSCRIPT_SNAPSHOT_LIMITS.componentBytes : 64 * 1024 ** 2,
    );
    total += raw.length;
    semantic += raw.length;
    if (
      semantic > MANUSCRIPT_SNAPSHOT_LIMITS.semanticBytes ||
      files.length >= MANUSCRIPT_SNAPSHOT_LIMITS.files
    )
      throw fail("EDITORIAL_LIMIT");
    files.push({ path, size: raw.length, sha256: digest(raw) });
    return parseEditorialJson(raw);
  };
  const capturedProject = ProjectConfigV3Schema.parse(
    await capture("project.json"),
  );
  if (JSON.stringify(project) !== JSON.stringify(capturedProject))
    throw fail("EDITORIAL_STALE");
  await capture("format.json");
  const context: Record<string, unknown> = { book: await capture("book.json") };
  const state = EditorialStateSchema.parse(
    await capture("editorial/state.json", true),
  );
  const chapters = [] as ChapterFileV2[];
  for (const id of project.manuscript.order)
    chapters.push(
      ChapterFileV2Schema.parse(await capture(`manuscript/${id}.json`, true)),
    );
  validateEditorialBundle({
    projectId,
    generation: project.generation,
    chapterOrder: project.manuscript.order,
    chapters,
    state,
  });
  const assetIds = imageIds([state, ...chapters]);
  await readBookPresentation(root, projectId);
  await readPrintConfiguration(root, projectId);
  await readPublication(root, opened);
  for (const path of SNAPSHOT_OPTIONAL_FILES) {
    const raw = await optional(root, path);
    if (!raw) absent.push(path);
    else {
      const value = await capture(path);
      context[path] = value;
      imageIds(value, assetIds);
    }
  }
  const conflicts: RestoreConflict[] = [];
  const editorialNames = await childNames(root, "editorial");
  if (
    editorialNames.some(
      (name) => !["state.json", "restore-conflicts"].includes(name),
    )
  )
    throw fail("EDITORIAL_UNSUPPORTED");
  for (const name of await childNames(root, "editorial/restore-conflicts")) {
    strictId(name.replace(/\.json$/, ""));
    if (!name.endsWith(".json")) throw fail();
    const conflict = RestoreConflictSchema.parse(
      await capture(`editorial/restore-conflicts/${name}`, true),
    );
    if (conflict.projectId !== projectId || `${conflict.id}.json` !== name)
      throw fail();
    conflicts.push(conflict);
    imageIds(conflict, assetIds);
  }
  for (const id of [...assetIds].sort()) {
    const { asset } = await readImageAsset(root, id, {
      projectValidated: true,
    }).catch(() => {
      throw new ManuscriptSnapshotError(`managed image ${id}`);
    });
    for (const name of [
      "asset.json",
      `original.${asset.mediaType === "image/png" ? "png" : "jpg"}`,
    ]) {
      const path = `assets/images/${id}/${name}`;
      const info = await lstat(join(root, path));
      if (info.size > MANUSCRIPT_SNAPSHOT_LIMITS.assetBytes)
        throw fail("EDITORIAL_LIMIT");
      files.push({
        path,
        size: info.size,
        sha256: await referenceFingerprint(
          join(root, path),
          MANUSCRIPT_SNAPSHOT_LIMITS.assetBytes,
        ),
      });
      total += info.size;
      if (
        files.length > MANUSCRIPT_SNAPSHOT_LIMITS.files ||
        total > MANUSCRIPT_SNAPSHOT_LIMITS.totalBytes
      )
        throw fail("EDITORIAL_LIMIT");
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  absent.sort();
  return {
    project,
    state,
    chapters,
    files,
    absent,
    conflicts,
    context,
    source: {
      generation: project.generation,
      inventoryHash: editorialDocumentHash({ files, absent }),
    },
  };
}
function assertSource(actual: SnapshotSource, expected: SnapshotSource) {
  if (
    actual.generation !== expected.generation ||
    actual.inventoryHash !== expected.inventoryHash
  )
    throw fail("EDITORIAL_STALE");
}
async function verifyFiles(
  root: string,
  files: ManuscriptSnapshot["files"],
  absent: string[],
) {
  for (const file of files) {
    await regularPath(join(root, file.path));
    if (
      (await lstat(join(root, file.path))).size !== file.size ||
      (await referenceFingerprint(
        join(root, file.path),
        MANUSCRIPT_SNAPSHOT_LIMITS.assetBytes,
      )) !== file.sha256
    )
      throw fail("EDITORIAL_STALE");
  }
  for (const path of absent)
    if (await optional(root, path)) throw fail("EDITORIAL_STALE");
}
export async function validateSnapshotCollectionInventory(
  root: string,
  allowedPaths: readonly string[],
) {
  if (
    (await childNames(root, "editorial")).some(
      (name) => !["state.json", "restore-conflicts"].includes(name),
    )
  )
    throw fail("EDITORIAL_UNSUPPORTED");
  const allowed = new Set(
    allowedPaths
      .filter((path) => path.startsWith("editorial/restore-conflicts/"))
      .map((path) => path.split("/").at(-1)!),
  );
  if (
    (await childNames(root, "editorial/restore-conflicts")).some(
      (name) => !allowed.has(name),
    )
  )
    throw fail("EDITORIAL_STALE");
}

function summary(
  snapshot: ManuscriptSnapshot,
  manifestHash: string,
  deleted: boolean,
): SnapshotSummary {
  return {
    snapshotId: snapshot.id,
    manifestHash,
    label: snapshot.label,
    created: snapshot.created,
    generation: snapshot.generation,
    reason: snapshot.reason,
    chapters: snapshot.chapterOrder.length,
    bytes: snapshot.files.reduce((sum, file) => sum + file.size, 0),
    deleted,
  };
}
async function readSelected(
  root: string,
  projectId: string,
  selection: SnapshotSelection,
  allowDeleted = false,
) {
  strictId(selection.snapshotId);
  const directory = join(root, "snapshots/manuscript", selection.snapshotId);
  await regularPath(directory, true);
  const raw = await boundedRead(
    join(directory, "snapshot.json"),
    8 * 1024 ** 2,
  );
  if (digest(raw) !== selection.manifestHash) throw fail("EDITORIAL_STALE");
  const snapshot = ManuscriptSnapshotSchema.parse(parseEditorialJson(raw));
  if (snapshot.id !== selection.snapshotId || snapshot.projectId !== projectId)
    throw fail("EDITORIAL_STALE");
  const marker = await optional(directory, "deleted.json");
  if (marker) {
    const deletion = SnapshotDeletionSchema.parse(parseEditorialJson(marker));
    if (
      deletion.snapshotId !== snapshot.id ||
      deletion.manifestHash !== selection.manifestHash
    )
      throw fail();
    if (!allowDeleted) throw fail("EDITORIAL_STALE");
  }
  await verifyFiles(join(directory, "files"), snapshot.files, snapshot.absent);
  const actual = await inspectSnapshot(join(directory, "files"));
  actual.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (JSON.stringify(actual.files) !== JSON.stringify(snapshot.files))
    throw fail();
  const scope = await readScope(join(directory, "files"), projectId);
  if (
    scope.project.generation !== snapshot.generation ||
    JSON.stringify(scope.project.manuscript.order) !==
      JSON.stringify(snapshot.chapterOrder) ||
    JSON.stringify(scope.files) !== JSON.stringify(snapshot.files) ||
    JSON.stringify(scope.absent) !== JSON.stringify(snapshot.absent)
  )
    throw fail();
  return {
    snapshot,
    scope,
    directory,
    deleted: marker !== null,
    summary: summary(snapshot, selection.manifestHash, marker !== null),
  };
}
async function captureLocked(
  root: string,
  scope: Scope,
  input: { id: string; label: string; reason: ManuscriptSnapshot["reason"] },
  options: SnapshotOptions = {},
) {
  strictId(input.id);
  SnapshotLabelSchema.parse(input.label);
  await snapshotCheckpoint(options, "capture-start");
  const parent = await referenceDirectory(root, ["snapshots", "manuscript"]);
  const directory = join(parent, input.id);
  try {
    await lstat(directory);
    const raw = await boundedRead(
      join(directory, "snapshot.json"),
      8 * 1024 ** 2,
    );
    const selected = await readSelected(
      root,
      scope.project.projectId,
      { snapshotId: input.id, manifestHash: digest(raw) },
      true,
    );
    if (
      selected.snapshot.label !== input.label ||
      selected.snapshot.reason !== input.reason ||
      selected.snapshot.generation !== scope.project.generation ||
      selected.scope.source.inventoryHash !== scope.source.inventoryHash
    )
      throw fail("EDITORIAL_STALE");
    return selected.summary;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const space = await statfs(root);
  const needed = scope.files.reduce((sum, file) => sum + file.size, 0);
  if (space.bavail * space.bsize < needed + 1024 ** 2)
    throw fail("EDITORIAL_LIMIT");
  await mkdir(directory);
  const directories = new Set<string>();
  for (const file of scope.files) {
    let path = dirname(file.path).replaceAll("\\", "/");
    while (path !== ".") {
      directories.add(path);
      const parentPath = dirname(path).replaceAll("\\", "/");
      if (parentPath === path) break;
      path = parentPath;
    }
  }
  await snapshotCheckpoint(options, "before-copy");
  await copySnapshot(
    root,
    join(directory, "files"),
    {
      files: scope.files,
      directories: [...directories].sort(
        (a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1),
      ),
    },
    async () => snapshotCheckpoint(options, "after-copy"),
  );
  await verifyFiles(join(directory, "files"), scope.files, scope.absent);
  assertSource(
    (await readScope(root, scope.project.projectId)).source,
    scope.source,
  );
  const snapshot = ManuscriptSnapshotSchema.parse({
    schemaVersion: 1,
    kind: "manuscript-snapshot",
    id: input.id,
    projectId: scope.project.projectId,
    created: new Date().toISOString(),
    label: input.label,
    reason: input.reason,
    generation: scope.project.generation,
    chapterOrder: scope.project.manuscript.order,
    files: scope.files,
    absent: scope.absent,
    exclusions: [...SNAPSHOT_EXCLUSIONS],
  });
  const raw = bytes(snapshot);
  await snapshotCheckpoint(options, "before-manifest");
  await referenceExclusive(join(directory, "manifest.tmp"), raw);
  await snapshotCheckpoint(options, "manifest-staged");
  assertSource(
    (await readScope(root, scope.project.projectId)).source,
    scope.source,
  );
  await verifyFiles(join(directory, "files"), scope.files, scope.absent);
  await link(join(directory, "manifest.tmp"), join(directory, "snapshot.json"));
  await unlink(join(directory, "manifest.tmp"));
  await syncDirectory(directory);
  return summary(snapshot, digest(raw), false);
}

export async function listManuscriptSnapshots(
  projectPath: string,
  projectId: string,
): Promise<SnapshotListing> {
  return withReferenceLock(projectPath, async (root) => {
    const scope = await readScope(root, projectId);
    const snapshots: SnapshotSummary[] = [],
      diagnostics: SnapshotListing["diagnostics"] = [];
    for (const id of await childNames(root, "snapshots/manuscript")) {
      try {
        strictId(id);
        const raw = await boundedRead(
          join(root, "snapshots/manuscript", id, "snapshot.json"),
          8 * 1024 ** 2,
        );
        snapshots.push(
          (
            await readSelected(
              root,
              projectId,
              { snapshotId: id, manifestHash: digest(raw) },
              true,
            )
          ).summary,
        );
      } catch {
        diagnostics.push({ snapshotId: id, code: "SNAPSHOT_INCOMPLETE" });
      }
    }
    return {
      source: scope.source,
      snapshots: snapshots.sort(
        (a, b) =>
          b.created.localeCompare(a.created) ||
          a.snapshotId.localeCompare(b.snapshotId),
      ),
      diagnostics,
      conflicts: scope.conflicts.reduce(
        (sum, collection) =>
          sum +
          collection.entries.filter(
            (entry) => entry.disposition === "unresolved",
          ).length,
        0,
      ),
    };
  });
}
export async function captureNamedSnapshot(
  input: {
    projectPath: string;
    projectId: string;
    operationId: string;
    label: string;
    expected: SnapshotSource;
  },
  options: SnapshotOptions = {},
) {
  return withReferenceLock(input.projectPath, async (root) => {
    strictId(input.operationId);
    const previous = await optional(
      root,
      `snapshots/manuscript/${input.operationId}/snapshot.json`,
    );
    if (previous) {
      const selected = await readSelected(
        root,
        input.projectId,
        { snapshotId: input.operationId, manifestHash: digest(previous) },
        true,
      );
      assertSource(selected.scope.source, input.expected);
      if (
        selected.snapshot.label !== input.label ||
        selected.snapshot.reason !== "named"
      )
        throw fail("EDITORIAL_STALE");
      return selected.summary;
    }
    const scope = await readScope(root, input.projectId);
    assertSource(scope.source, input.expected);
    return captureLocked(
      root,
      scope,
      { id: input.operationId, label: input.label, reason: "named" },
      options,
    );
  });
}
export async function setManuscriptSnapshotDeleted(
  input: {
    projectPath: string;
    projectId: string;
    operationId: string;
    expected: SnapshotSource;
    selection: SnapshotSelection;
    deleted: boolean;
  },
  options: SnapshotOptions = {},
) {
  strictId(input.operationId);
  const requestHash = editorialDocumentHash({
    expected: input.expected,
    selection: input.selection,
    deleted: input.deleted,
  });
  const prior = await readEditorialRequestReceipt({
    projectPath: input.projectPath,
    projectId: input.projectId,
    operationId: input.operationId,
    expectedGeneration: input.expected.generation,
    requestHash,
  });
  if (prior) return { ...prior, ...input.selection, deleted: input.deleted };
  const committed = await commitPreparedEditorialTransaction(
    input.projectPath,
    async (root) => {
      const scope = await readScope(root, input.projectId);
      assertSource(scope.source, input.expected);
      const selected = await readSelected(
        root,
        input.projectId,
        input.selection,
        true,
      );
      const path = `snapshots/manuscript/${input.selection.snapshotId}/deleted.json`;
      const previous = await optional(root, path);
      const marker = input.deleted
        ? bytes(
            SnapshotDeletionSchema.parse({
              schemaVersion: 1,
              snapshotId: input.selection.snapshotId,
              manifestHash: input.selection.manifestHash,
              deletedAt: new Date().toISOString(),
            }),
          )
        : null;
      const generation = scope.project.generation + 1;
      return {
        result: {
          snapshotId: selected.snapshot.id,
          manifestHash: input.selection.manifestHash,
          deleted: input.deleted,
        },
        transaction: {
          projectId: input.projectId,
          operationId: input.operationId,
          kind: "edit" as const,
          expectedGeneration: scope.project.generation,
          requestHash,
          validateInventory: async () => {
            await snapshotCheckpoint(options, "deletion-validation");
            await validateSnapshotCollectionInventory(
              root,
              scope.files.map((file) => file.path),
            );
            await readSelected(root, input.projectId, input.selection, true);
          },
          expectedBefore: {
            ...Object.fromEntries([
              ...scope.files.map((file) => [file.path, file.sha256]),
              ...scope.absent.map((path) => [path, null]),
            ]),
            ...Object.fromEntries(
              selected.snapshot.files.map((file) => [
                `snapshots/manuscript/${selected.snapshot.id}/files/${file.path}`,
                file.sha256,
              ]),
            ),
            "project.json": scope.files.find(
              (file) => file.path === "project.json",
            )!.sha256,
            "editorial/state.json": scope.files.find(
              (file) => file.path === "editorial/state.json",
            )!.sha256,
            [path]: previous ? digest(previous) : null,
            [`snapshots/manuscript/${input.selection.snapshotId}/snapshot.json`]:
              input.selection.manifestHash,
          },
          changes: [
            { path, after: marker },
            {
              path: "project.json",
              after: bytes({
                ...scope.project,
                generation,
                modified: new Date().toISOString(),
              }),
            },
            {
              path: "editorial/state.json",
              after: bytes({ ...scope.state, generation }),
            },
          ],
        },
      };
    },
  );
  return {
    ...committed.result,
    ...committed.receipt,
    ...(committed.warning ? { warning: committed.warning } : {}),
  };
}

function inspection(
  selected: Awaited<ReturnType<typeof readSelected>>,
): SnapshotInspection {
  return {
    snapshot: selected.summary,
    chapters: selected.scope.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      document: chapter.review.proposed,
    })),
    editorial: selected.scope.state,
    publication: selected.scope.context,
    files: selected.snapshot.files,
    absent: selected.snapshot.absent,
    exclusions: selected.snapshot.exclusions,
  };
}
export async function inspectManuscriptSnapshot(
  projectPath: string,
  projectId: string,
  selection: SnapshotSelection,
): Promise<SnapshotInspection> {
  return withReferenceLock(projectPath, async (root) => {
    await assertEditorialReadable(root);
    const selected = await readSelected(root, projectId, selection, true);
    return inspection(selected);
  });
}
function conflictEntries(
  current: EditorialState,
  restored: EditorialState,
): RestoreConflict["entries"] {
  return current.annotations.flatMap((annotation) => {
    const anchor = current.anchors.find(
      (item) => item.id === annotation.anchorId,
    )!;
    const thread = current.threads.find(
      (item) => item.id === annotation.threadId,
    )!;
    const selected = restored.annotations.find(
      (item) => item.id === annotation.id,
    );
    if (
      selected &&
      editorialDocumentHash({ annotation, anchor, thread }) ===
        editorialDocumentHash({
          annotation: selected,
          anchor: restored.anchors.find(
            (item) => item.id === selected.anchorId,
          ),
          thread: restored.threads.find(
            (item) => item.id === selected.threadId,
          ),
        })
    )
      return [];
    return [
      {
        annotation,
        anchor,
        thread,
        reason: selected
          ? ("different-version" as const)
          : ("current-only" as const),
        disposition: "unresolved" as const,
      },
    ];
  });
}
export async function previewSnapshotRestore(
  projectPath: string,
  projectId: string,
  selection: SnapshotSelection,
): Promise<SnapshotRestorePreview> {
  return withReferenceLock(projectPath, async (root) => {
    const scope = await readScope(root, projectId),
      selected = await readSelected(root, projectId, selection);
    return {
      snapshot: inspection(selected),
      current: scope.source,
      currentChapters: scope.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        document: chapter.review.proposed,
      })),
      currentContext: scope.context,
      conflicts: conflictEntries(scope.state, selected.scope.state).length,
    };
  });
}

export async function restoreNamedSnapshot(
  input: {
    projectPath: string;
    projectId: string;
    operationId: string;
    selection: SnapshotSelection;
    expected: SnapshotSource;
  },
  options: SnapshotOptions = {},
) {
  strictId(input.operationId);
  const requestHash = editorialDocumentHash({
    expected: input.expected,
    selection: input.selection,
  });
  const prior = await readEditorialRequestReceipt({
    projectPath: input.projectPath,
    projectId: input.projectId,
    operationId: input.operationId,
    expectedGeneration: input.expected.generation,
    requestHash,
  });
  if (prior) {
    const raw = await boundedRead(
      join(
        input.projectPath,
        "snapshots/manuscript",
        input.operationId,
        "snapshot.json",
      ),
      8 * 1024 ** 2,
    );
    const safety = await readSelected(
      input.projectPath,
      input.projectId,
      { snapshotId: input.operationId, manifestHash: digest(raw) },
      true,
    );
    const conflict = await optional(
      input.projectPath,
      `.editorial/transactions/${input.operationId}/after/editorial/restore-conflicts/${input.operationId}.json`,
    );
    return {
      ...prior,
      safety: safety.summary,
      conflicts: conflict
        ? RestoreConflictSchema.parse(parseEditorialJson(conflict)).entries
            .length
        : 0,
    };
  }
  const prepared = await commitPreparedEditorialTransaction(
    input.projectPath,
    async (root) => {
      const current = await readScope(root, input.projectId);
      assertSource(current.source, input.expected);
      const selected = await readSelected(
        root,
        input.projectId,
        input.selection,
      );
      if (
        [...current.conflicts, ...selected.scope.conflicts].some(
          (collection) => collection.id === input.operationId,
        )
      )
        throw fail("EDITORIAL_STALE");
      const safety = await captureLocked(
        root,
        current,
        {
          id: input.operationId,
          label: [...`Before restoring ${selected.snapshot.label}`]
            .slice(0, 500)
            .join(""),
          reason: "before-restore",
        },
        options,
      );
      await snapshotCheckpoint(options, "after-safety");
      assertSource(
        (await readScope(root, input.projectId)).source,
        current.source,
      );
      await readSelected(root, input.projectId, input.selection);
      const now = new Date().toISOString(),
        generation = current.project.generation + 1;
      const revisions = new Map<string, number>();
      const restoredChapters = selected.scope.chapters.map((chapter) => {
        const existing = current.chapters.find(
          (item) => item.id === chapter.id,
        );
        if (existing && existing.created !== chapter.created)
          throw fail("EDITORIAL_STALE");
        const revision =
          Math.max(
            current.project.generation,
            chapter.revision,
            current.chapters.find((item) => item.id === chapter.id)?.revision ??
              0,
          ) + 1;
        revisions.set(chapter.id, revision);
        return ChapterFileV2Schema.parse({
          ...chapter,
          revision,
          modified: now,
        });
      });
      const state = EditorialStateSchema.parse({
        ...selected.scope.state,
        generation,
        anchors: selected.scope.state.anchors.map((anchor) => ({
          ...anchor,
          segments: anchor.segments.map((segment) => ({
            ...segment,
            chapterRevision:
              revisions.get(segment.chapterId) ?? segment.chapterRevision,
          })),
        })),
      });
      const project = ProjectConfigV3Schema.parse({
        ...selected.scope.project,
        projectId: current.project.projectId,
        created: current.project.created,
        modified: now,
        generation,
      });
      const changes: EditorialChange[] = [];
      for (const file of selected.snapshot.files) {
        if (file.path.startsWith("assets/")) continue;
        if (
          file.path === "project.json" ||
          file.path === "editorial/state.json" ||
          file.path.startsWith("manuscript/")
        )
          continue;
        const previous = current.files.find((item) => item.path === file.path);
        if (
          file.path.startsWith("editorial/restore-conflicts/") &&
          previous &&
          previous.sha256 !== file.sha256
        )
          throw fail("EDITORIAL_STALE");
        changes.push({
          path: file.path,
          after: await boundedRead(
            join(selected.directory, "files", file.path),
            MANUSCRIPT_SNAPSHOT_LIMITS.semanticBytes,
          ),
        });
      }
      for (const path of selected.snapshot.absent)
        if (current.files.some((item) => item.path === path))
          changes.push({ path, after: null });
      for (const id of current.project.manuscript.order)
        if (!project.manuscript.order.includes(id))
          changes.push({ path: `manuscript/${id}.json`, after: null });
      changes.push(
        { path: "project.json", after: bytes(project) },
        { path: "editorial/state.json", after: bytes(state) },
        ...restoredChapters.map((chapter) => ({
          path: `manuscript/${chapter.id}.json`,
          after: bytes(chapter),
        })),
      );
      const entries = conflictEntries(current.state, selected.scope.state);
      if (entries.length)
        changes.push({
          path: `editorial/restore-conflicts/${input.operationId}.json`,
          after: conflictBytes({
            schemaVersion: 1,
            id: input.operationId,
            projectId: input.projectId,
            sourceGeneration: current.project.generation,
            restoredSnapshotId: selected.snapshot.id,
            created: now,
            entries,
          }),
        });
      // Existing asset identities are immutable; missing files join the same journal.
      const ids = new Set(
        selected.snapshot.files
          .filter((file) => file.path.startsWith("assets/"))
          .map((file) => file.path.split("/")[2]!),
      );
      for (const id of ids) {
        const files = selected.snapshot.files.filter((file) =>
          file.path.startsWith(`assets/images/${id}/`),
        );
        try {
          await regularPath(join(root, "assets/images", id), true);
          await verifyFiles(root, files, []);
        } catch (error) {
          if (!missing(error)) throw error;
          if ((await childNames(root, `assets/images/${id}`)).length)
            throw fail("EDITORIAL_STALE");
          for (const file of files)
            changes.push({
              path: file.path,
              after: null,
              afterSource: {
                path: `snapshots/manuscript/${selected.snapshot.id}/files/${file.path}`,
                size: file.size,
                sha256: file.sha256,
              },
            });
        }
      }
      const resulting = new Map<string, ManuscriptSnapshot["files"][number]>();
      for (const file of [
        ...selected.snapshot.files.filter(
          (file) => !file.path.startsWith("assets/"),
        ),
        ...current.files.filter((file) =>
          file.path.startsWith("editorial/restore-conflicts/"),
        ),
      ])
        resulting.set(file.path, file);
      for (const change of changes)
        if (!change.path.startsWith("assets/")) {
          if (change.after === null) resulting.delete(change.path);
          else
            resulting.set(change.path, {
              path: change.path,
              size: change.after.byteLength,
              sha256: digest(change.after),
            });
        }
      const requiredAssets = imageIds([
        restoredChapters,
        state,
        selected.scope.context,
        current.conflicts,
        selected.scope.conflicts,
        entries,
      ]);
      for (const file of [...current.files, ...selected.snapshot.files])
        if (
          file.path.startsWith("assets/") &&
          requiredAssets.has(file.path.split("/")[2]!)
        )
          resulting.set(file.path, file);
      const resultFiles = [...resulting.values()].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      );
      if (
        !ManuscriptSnapshotSchema.safeParse({
          schemaVersion: 1,
          kind: "manuscript-snapshot",
          id: input.operationId,
          projectId: input.projectId,
          created: now,
          label: "Restore resource validation",
          reason: "before-restore",
          generation,
          chapterOrder: project.manuscript.order,
          files: resultFiles,
          absent: selected.snapshot.absent,
          exclusions: [...SNAPSHOT_EXCLUSIONS],
        }).success
      )
        throw fail("EDITORIAL_LIMIT");
      const expectedBefore: Record<string, string | null> = Object.fromEntries([
        ...current.files.map((file) => [file.path, file.sha256]),
        ...current.absent.map((path) => [path, null]),
      ]);
      for (const file of selected.snapshot.files.filter((file) =>
        file.path.startsWith("assets/"),
      ))
        expectedBefore[file.path] = changes.some(
          (change) => change.path === file.path && change.afterSource,
        )
          ? null
          : file.sha256;
      expectedBefore[
        `snapshots/manuscript/${selected.snapshot.id}/snapshot.json`
      ] = input.selection.manifestHash;
      expectedBefore[
        `snapshots/manuscript/${selected.snapshot.id}/deleted.json`
      ] = null;
      expectedBefore[
        `snapshots/manuscript/${safety.snapshotId}/snapshot.json`
      ] = safety.manifestHash;
      for (const file of selected.snapshot.files)
        expectedBefore[
          `snapshots/manuscript/${selected.snapshot.id}/files/${file.path}`
        ] = file.sha256;
      for (const file of current.files)
        expectedBefore[
          `snapshots/manuscript/${safety.snapshotId}/files/${file.path}`
        ] = file.sha256;
      for (const path of selected.snapshot.absent)
        expectedBefore[
          `snapshots/manuscript/${selected.snapshot.id}/files/${path}`
        ] = null;
      for (const path of current.absent)
        expectedBefore[
          `snapshots/manuscript/${safety.snapshotId}/files/${path}`
        ] = null;
      for (const change of changes)
        if (!(change.path in expectedBefore))
          expectedBefore[change.path] = null;
      return {
        result: { safety, conflicts: entries.length },
        transaction: {
          projectId: input.projectId,
          operationId: input.operationId,
          expectedGeneration: current.project.generation,
          expectedBefore,
          changes,
          kind: "restore" as const,
          validateInventory: async () => {
            await readSelected(root, input.projectId, input.selection);
            await readSelected(root, input.projectId, safety, true);
            await validateSnapshotCollectionInventory(root, [
              ...current.files.map((file) => file.path),
              ...changes.map((change) => change.path),
            ]);
          },
          requestHash,
          checkpoint: (point: string) => snapshotCheckpoint(options, point),
        },
      };
    },
  );
  return {
    ...prepared.result,
    ...prepared.receipt,
    ...(prepared.warning ? { warning: prepared.warning } : {}),
  };
}

export async function listSnapshotRestoreConflicts(
  projectPath: string,
  projectId: string,
) {
  // This lightweight notice reader never acquires a writer lock or writes caches.
  // Foreground authoring stays available; generation/journal checks reject a mixed read.
  await regularPath(projectPath, true);
  await assertEditorialReadable(projectPath);
  const before = await boundedRead(
    join(projectPath, "project.json"),
    8 * 1024 ** 2,
  );
  const project = ProjectConfigSchema.parse(parseEditorialJson(before));
  if (project.projectId !== projectId) throw fail("EDITORIAL_STALE");
  if (project.schemaVersion !== 3) return [];
  const state = EditorialStateSchema.parse(
    parseEditorialJson(
      await boundedRead(
        join(projectPath, "editorial/state.json"),
        8 * 1024 ** 2,
      ),
    ),
  );
  if (state.projectId !== projectId || state.generation !== project.generation)
    throw fail("PROJECT_BUSY");
  const collections: RestoreConflict[] = [];
  let total = 0;
  for (const name of await childNames(
    projectPath,
    "editorial/restore-conflicts",
  )) {
    strictId(name.replace(/\.json$/, ""));
    if (!name.endsWith(".json")) throw fail();
    const raw = await boundedRead(
      join(projectPath, "editorial/restore-conflicts", name),
      8 * 1024 ** 2,
    );
    total += raw.length;
    if (
      total > MANUSCRIPT_SNAPSHOT_LIMITS.semanticBytes ||
      collections.length >= MANUSCRIPT_SNAPSHOT_LIMITS.files
    )
      throw fail("EDITORIAL_LIMIT");
    const collection = RestoreConflictSchema.parse(parseEditorialJson(raw));
    if (collection.projectId !== projectId || `${collection.id}.json` !== name)
      throw fail();
    collections.push(collection);
  }
  await assertEditorialReadable(projectPath);
  if (
    !(
      await boundedRead(join(projectPath, "project.json"), 8 * 1024 ** 2)
    ).equals(before)
  )
    throw fail("PROJECT_BUSY");
  return collections;
}

/** Reuse a named restore's retained safety inventory when explicitly recovering its draft. */
export async function validateNamedSnapshotDraft(
  projectPath: string,
  projectId: string,
  operationId: string,
  changes: readonly EditorialChange[],
): Promise<Record<string, string | null>> {
  return withReferenceLock(projectPath, async (root) => {
    const safetyPath = `snapshots/manuscript/${operationId}/snapshot.json`;
    const raw = await optional(root, safetyPath);
    if (!raw) return {}; // Historical text-only chapter restore uses its existing safety service.
    const safety = await readSelected(
      root,
      projectId,
      { snapshotId: operationId, manifestHash: digest(raw) },
      true,
    );
    if (safety.snapshot.reason !== "before-restore")
      throw fail("EDITORIAL_STALE");
    const current = await readScope(root, projectId);
    assertSource(current.source, safety.scope.source);
    const expected: Record<string, string | null> = Object.fromEntries([
      ...current.files.map((file) => [file.path, file.sha256]),
      ...current.absent.map((path) => [path, null]),
    ]);
    expected[safetyPath] = digest(raw);
    for (const file of safety.snapshot.files)
      expected[`snapshots/manuscript/${operationId}/files/${file.path}`] =
        file.sha256;
    const documents = changes.flatMap((change) =>
      change.after && !change.path.startsWith("assets/")
        ? [parseEditorialJson(Buffer.from(change.after))]
        : [],
    );
    for (const id of imageIds(documents)) {
      const prefix = `assets/images/${id}/`;
      if (
        changes.some(
          (change) =>
            change.path.startsWith(prefix) &&
            (change.after || change.afterSource),
        )
      ) {
        await readImageAsset(
          join(root, `.editorial/transactions/${operationId}/after`),
          id,
          { projectValidated: true },
        );
      } else {
        const { asset } = await readImageAsset(root, id, {
          projectValidated: true,
        });
        for (const name of [
          "asset.json",
          `original.${asset.mediaType === "image/png" ? "png" : "jpg"}`,
        ])
          expected[`${prefix}${name}`] = await referenceFingerprint(
            join(root, prefix, name),
          );
      }
    }
    return expected;
  });
}

/** Explicitly copy retained discussions with new identities; original evidence stays intact. */
export async function resolveSnapshotRestoreConflict(
  input: {
    projectPath: string;
    projectId: string;
    operationId: string;
    expected: SnapshotSource;
    collectionId: string;
    annotationId: string;
    action: "copy" | "reattach" | "discard";
    target?: { chapterId: string; from: number; to: number } | undefined;
  },
  options: SnapshotOptions = {},
) {
  strictId(input.operationId);
  strictId(input.collectionId);
  strictId(input.annotationId);
  const requestHash = editorialDocumentHash({
    expected: input.expected,
    collectionId: input.collectionId,
    annotationId: input.annotationId,
    action: input.action,
    target: input.target ?? null,
  });
  const prior = await readEditorialRequestReceipt({
    projectPath: input.projectPath,
    projectId: input.projectId,
    operationId: input.operationId,
    expectedGeneration: input.expected.generation,
    requestHash,
  });
  if (prior) return prior;
  const committed = await commitPreparedEditorialTransaction(
    input.projectPath,
    async (root) => {
      const scope = await readScope(root, input.projectId);
      assertSource(scope.source, input.expected);
      const collection = scope.conflicts.find(
        (item) => item.id === input.collectionId,
      );
      const entry = collection?.entries.find(
        (item) => item.annotation.id === input.annotationId,
      );
      if (!collection || !entry || entry.disposition !== "unresolved")
        throw fail("EDITORIAL_STALE");
      const now = new Date().toISOString(),
        generation = scope.project.generation + 1;
      const state = structuredClone(scope.state);
      state.generation = generation;
      if (input.action !== "discard") {
        const anchorId = createUuid(),
          threadId = createUuid();
        const anchor = {
          ...structuredClone(entry.anchor),
          id: anchorId,
          created: now,
          modified: now,
          deletedAt: null,
          status: "orphaned" as const,
          segments: [] as EditorialState["anchors"][number]["segments"],
          lost: [
            ...entry.anchor.lost,
            {
              evidence: entry.anchor.original,
              reason: "snapshot-restore" as const,
              revisionGroupId: null,
            },
          ],
        };
        if (input.action === "reattach") {
          if (!input.target) throw fail("EDITORIAL_INVALID");
          const { chapterId, from, to } = input.target;
          const chapter = scope.chapters.find((item) => item.id === chapterId);
          if (
            !chapter ||
            !Number.isSafeInteger(from) ||
            !Number.isSafeInteger(to) ||
            from > to
          )
            throw fail("EDITORIAL_STALE");
          const document = decodeEditorialDocument(chapter.review.proposed);
          if (
            !isEditorialDocumentBoundary(document, from) ||
            !isEditorialDocumentBoundary(document, to)
          )
            throw fail("EDITORIAL_INVALID");
          anchor.segments.push({
            chapterId,
            from,
            to,
            chapterRevision: chapter.revision,
            documentHash: editorialDocumentHash(chapter.review.proposed),
            pointAffinity: "right",
          });
        }
        state.anchors.push({
          ...anchor,
          status: anchor.segments.length ? "partial" : "orphaned",
        });
        state.annotations.push({
          ...entry.annotation,
          id: createUuid(),
          anchorId,
          threadId,
          created: now,
          modified: now,
          deletedAt: null,
        });
        state.threads.push({
          ...entry.thread,
          id: threadId,
          created: now,
          modified: now,
          deletedAt: null,
          state: "open",
          resolvedAt: null,
          comments: entry.thread.comments
            .map((comment) => ({
              ...comment,
              id: createUuid(),
              created: now,
              modified: now,
              deletedAt: null,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        });
      }
      const path = `editorial/restore-conflicts/${collection.id}.json`;
      const updated = RestoreConflictSchema.parse({
        ...collection,
        entries: collection.entries.map((item) =>
          item.annotation.id === input.annotationId
            ? {
                ...item,
                disposition:
                  input.action === "discard"
                    ? "discarded"
                    : input.action === "copy"
                      ? "copied"
                      : "reattached",
              }
            : item,
        ),
      });
      const changes = [
        { path, after: bytes(updated) },
        {
          path: "project.json",
          after: bytes({ ...scope.project, generation, modified: now }),
        },
        {
          path: "editorial/state.json",
          after: bytes(EditorialStateSchema.parse(state)),
        },
      ];
      return {
        result: null,
        transaction: {
          projectId: input.projectId,
          operationId: input.operationId,
          expectedGeneration: scope.project.generation,
          requestHash,
          kind: "annotation" as const,
          validateInventory: async () => {
            await snapshotCheckpoint(options, "conflict-validation");
            await validateSnapshotCollectionInventory(
              root,
              scope.files.map((file) => file.path),
            );
          },
          expectedBefore: Object.fromEntries([
            ...scope.files.map((file) => [file.path, file.sha256]),
            ...scope.absent.map((path) => [path, null]),
          ]),
          changes,
        },
      };
    },
  );
  return committed.receipt!;
}
