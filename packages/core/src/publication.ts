import { createHash } from "node:crypto";
import { join } from "node:path";
import { lstat, mkdir, rmdir, open, link, unlink } from "node:fs/promises";
import { PublicationSchema } from "@drelwick/project-model";
import {
  ApplicationError,
  createUuid,
  PUBLICATION_INCLUSION,
  type PublicationData,
  type PublicationState,
} from "@drelwick/shared";
import {
  CHAPTER_CREATION_LOCK,
  openProject,
  openProjectForEditing,
  writeJsonAtomically,
  type OpenedProject,
} from "./index.js";
import {
  boundedRead,
  regularPath,
  importImageAsset,
  readImageAsset,
} from "./image-assets.js";
import {
  copySnapshot,
  inspectSnapshot,
  sameSnapshot,
} from "./project-snapshot.js";

export const PUBLICATION_FILE = "publication.json";
export const PUBLICATION_MIGRATION_DIRECTORY =
  ".drelwick-publication-migration";
const failed = (code = "PUBLICATION_FAILED") =>
  new ApplicationError(
    code,
    "Publication changes could not be saved. Existing publication and manuscript data were preserved. Check project access or recovery files and retry.",
  );
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const revision = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function initialPublication(session: OpenedProject): PublicationData {
  return PublicationSchema.parse({
    schemaVersion: 1,
    projectId: session.project.projectId,
    metadata: {
      title: session.book.title,
      author: session.book.author,
      language: session.book.language,
      description: session.book.description ?? "",
      identifiers: session.book.isbn
        ? [{ scheme: "isbn", value: session.book.isbn }]
        : [],
    },
    pages: [],
    body: session.project.manuscript.order.map((id) => ({
      id,
      inclusion: { ...PUBLICATION_INCLUSION },
    })),
  });
}
/** Read-only compatibility for legacy snapshots. Writers/assembly own the project lock. */
export async function readPublication(
  projectPath: string,
  session: OpenedProject,
): Promise<PublicationState & { bytes?: Buffer }> {
  const path = join(projectPath, PUBLICATION_FILE);
  try {
    await lstat(`${path}.tmp`);
    throw failed("PUBLICATION_RECOVERY_REQUIRED");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  try {
    const bytes = await boundedRead(path, 64 * 1024 * 1024);
    const parsed = PublicationSchema.safeParse(
      JSON.parse(bytes.toString("utf8")),
    );
    if (
      !parsed.success ||
      parsed.data.projectId !== session.project.projectId ||
      parsed.data.pages.some((page) =>
        session.project.manuscript.order.some(
          (id) => id.toLowerCase() === page.id.toLowerCase(),
        ),
      )
    )
      throw failed("PUBLICATION_INVALID");
    return { data: parsed.data, revision: revision(bytes), bytes };
  } catch (error) {
    if (!missing(error)) throw failed("PUBLICATION_INVALID");
    const data = initialPublication(session);
    return { data, revision: revision(JSON.stringify(data)) };
  }
}
async function locked(
  root: string,
  action: () => Promise<PublicationState>,
): Promise<PublicationState> {
  await regularPath(root, true);
  const lock = join(root, CHAPTER_CREATION_LOCK);
  try {
    await mkdir(lock);
  } catch {
    throw failed("PROJECT_BUSY");
  }
  let result: PublicationState | undefined;
  try {
    result = await action();
    return result;
  } finally {
    try {
      await rmdir(lock);
    } catch {
      if (result)
        result.warning =
          "Publication is saved, but the project lock could not be released. Resolve the retained lock before further changes.";
    }
  }
}

/** Additive one-file migration: use #111's verified complete snapshots, then one atomic commit.
 * No chapter/manifest transformation is necessary. Retained temp/lock evidence is never stolen.
 */
export async function loadPublication(
  projectPath: string,
  projectId: string,
  options: {
    checkpoint?: (
      point: "after-backup" | "before-commit" | "after-commit",
    ) => Promise<void>;
    write?: typeof writeJsonAtomically;
  } = {},
): Promise<PublicationState> {
  await regularPath(projectPath, true);
  await openProjectForEditing(projectPath);
  return locked(projectPath, async () => {
    const session = await openProject(projectPath);
    if (session.project.projectId !== projectId)
      throw failed("PROJECT_NOT_OPEN");
    const current = await readPublication(projectPath, session);
    if (!current.bytes) {
      const snapshot = await inspectSnapshot(projectPath, true);
      const work = join(projectPath, PUBLICATION_MIGRATION_DIRECTORY);
      await mkdir(work, { recursive: true });
      await regularPath(work, true);
      const backup = join(work, `backup-${createUuid()}`);
      await copySnapshot(projectPath, backup, snapshot, async () => undefined);
      if (
        !sameSnapshot(snapshot, await inspectSnapshot(backup)) ||
        !sameSnapshot(snapshot, await inspectSnapshot(projectPath, true))
      )
        throw failed("PUBLICATION_MIGRATION_FAILED");
      await options.checkpoint?.("after-backup");
      await options.checkpoint?.("before-commit");
      const publish =
        options.write ??
        ((path: string, value: unknown) =>
          writeJsonAtomically(path, value, {
            open,
            unlink,
            rename: async (source, destination) => {
              await link(source, destination);
              await unlink(source);
            },
          }));
      await publish(join(projectPath, PUBLICATION_FILE), current.data);
      await options.checkpoint?.("after-commit");
    }
    const { data, revision } = await readPublication(projectPath, session);
    return { data, revision };
  });
}

export async function savePublication(
  input: {
    projectPath: string;
    projectId: string;
    expectedRevision: string;
    data: PublicationData;
  },
  options: {
    write?: typeof writeJsonAtomically;
    allowCoverChange?: boolean;
  } = {},
): Promise<PublicationState> {
  const parsed = PublicationSchema.safeParse(input.data);
  if (!parsed.success || parsed.data.projectId !== input.projectId)
    throw failed("PUBLICATION_INVALID");
  if (
    Buffer.byteLength(JSON.stringify(parsed.data, null, 2)) + 1 >
    64 * 1024 * 1024
  )
    throw failed("PUBLICATION_INVALID");
  return locked(input.projectPath, async () => {
    const session = await openProject(input.projectPath);
    if (session.project.projectId !== input.projectId)
      throw failed("PROJECT_NOT_OPEN");
    const current = await readPublication(input.projectPath, session);
    if (current.revision !== input.expectedRevision)
      throw failed("PUBLICATION_CONFLICT");
    // This workflow has no delete operation. Visibility/type changes cannot remove a page.
    if (
      current.data.pages.some(
        (page) => !parsed.data.pages.some((next) => next.id === page.id),
      ) ||
      (!options.allowCoverChange &&
        parsed.data.coverAssetId !== current.data.coverAssetId)
    )
      throw failed("PUBLICATION_INVALID");
    if (
      parsed.data.pages.some((page) =>
        session.project.manuscript.order.some(
          (id) => id.toLowerCase() === page.id.toLowerCase(),
        ),
      )
    )
      throw failed("PUBLICATION_INVALID");
    if (parsed.data.coverAssetId)
      await readImageAsset(input.projectPath, parsed.data.coverAssetId);
    try {
      await (options.write ?? writeJsonAtomically)(
        join(input.projectPath, PUBLICATION_FILE),
        parsed.data,
      );
    } catch {
      throw failed();
    }
    const { data, revision } = await readPublication(
      input.projectPath,
      session,
    );
    return { data, revision };
  });
}

/** The immutable asset is committed first; a failed reference commit leaves the previous cover.
 * Orphaned managed assets are retained, never source files modified or deleted.
 */
export async function replacePublicationCover(
  input: {
    projectPath: string;
    projectId: string;
    expectedRevision: string;
    sourcePath: string;
  },
  options: { write?: typeof writeJsonAtomically } = {},
): Promise<PublicationState> {
  const session = await openProject(input.projectPath);
  if (session.project.projectId !== input.projectId)
    throw failed("PROJECT_NOT_OPEN");
  const current = await readPublication(input.projectPath, session);
  if (current.revision !== input.expectedRevision)
    throw failed("PUBLICATION_CONFLICT");
  const asset = await importImageAsset({
    projectPath: input.projectPath,
    sourcePath: input.sourcePath,
  });
  return savePublication(
    { ...input, data: { ...current.data, coverAssetId: asset.id } },
    { ...options, allowCoverChange: true },
  );
}
