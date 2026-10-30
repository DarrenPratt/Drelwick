import {
  link,
  open,
  lstat,
  mkdir,
  readFile,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  ChapterFileSchema,
  ChapterFileV2Schema,
  EditorialStateSchema,
  ManuscriptDocumentSchema,
  ProjectConfigV3Schema,
  ReplacementJournalSchema,
  type ReplacementJournal,
} from "@drelwick/project-model";
import { ApplicationError, createUuid } from "@drelwick/shared";
import {
  CHAPTER_CREATION_LOCK,
  createHistorySnapshot,
  openProject,
  validateProjectFiles,
  writeJsonAtomicallyAt,
} from "./index.js";
import { assertRegularPath, syncDirectory } from "./project-snapshot.js";
import { isMissing } from "./migration-state.js";
import {
  replaceMatches,
  searchChapter,
  type SearchOptions,
} from "./manuscript-search.js";
import { commitEditorialTransaction } from "./editorial-transactions.js";

export const REPLACEMENT_JOURNAL = ".manuscript-replace.json";
const finished = new Set<string>();
const active = new Set<string>();
const equal = isDeepStrictEqual;
export const replacementError = () =>
  new ApplicationError(
    "REPLACEMENT_RECOVERY_REQUIRED",
    "Replacement recovery could not finish. Editing is blocked. Preserve the entire project and reopen after resolving disk access or conflicting external changes.",
  );

async function journal(root: string): Promise<ReplacementJournal | null> {
  try {
    await assertRegularPath(root, REPLACEMENT_JOURNAL);
    const parsed = ReplacementJournalSchema.safeParse(
      JSON.parse(await readFile(join(root, REPLACEMENT_JOURNAL), "utf8")),
    );
    if (!parsed.success) throw replacementError();
    return parsed.data;
  } catch (error) {
    if (isMissing(error)) return null;
    throw replacementError();
  }
}

export async function assertReplacementReadable(root: string): Promise<void> {
  const state = await journal(root);
  if (state?.phase === "pending") throw replacementError();
}

async function publish(
  root: string,
  relative: string,
  value: unknown,
): Promise<void> {
  const path = join(root, relative);
  await writeJsonAtomicallyAt(path, `${path}.${createUuid()}.tmp`, value);
  await syncDirectory(dirname(path));
}

interface Target {
  path: string;
  before: unknown;
  after: unknown;
}
function targets(state: ReplacementJournal): Target[] {
  return [
    ...state.entries.map((entry) => ({
      path: `manuscript/${entry.before.id}.json`,
      before: entry.before,
      after: entry.after,
    })),
    ...(state.structure?.created ?? []).map((after) => ({
      path: `manuscript/${after.id}.json`,
      before: null,
      after,
    })),
    ...(state.structure?.removed ?? []).map((before) => ({
      path: `manuscript/${before.id}.json`,
      before,
      after: null,
    })),
    ...(state.structure
      ? [
          {
            path: "project.json",
            before: state.structure.beforeManifest,
            after: state.structure.afterManifest,
          },
        ]
      : []),
  ];
}
async function readTarget(root: string, path: string): Promise<unknown> {
  try {
    await assertRegularPath(root, path);
    return JSON.parse(await readFile(join(root, path), "utf8"));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function writeTarget(
  root: string,
  path: string,
  value: unknown,
  exclusive = false,
): Promise<void> {
  if (value === null) {
    if ((await readTarget(root, path)) !== null) await unlink(join(root, path));
    await syncDirectory(dirname(join(root, path)));
  } else if (exclusive) {
    const destination = join(root, path);
    await writeJsonAtomicallyAt(
      destination,
      `${destination}.${createUuid()}.tmp`,
      value,
      {
        open,
        unlink,
        rename: async (temporary, target) => {
          await link(temporary, target);
          await unlink(temporary);
        },
      },
    );
    await syncDirectory(dirname(destination));
  } else await publish(root, path, value);
}
async function restore(root: string, state: ReplacementJournal): Promise<void> {
  const changes = targets(state);
  // Validate all revisions before rollback; never overwrite unexpected external work.
  for (const target of changes) {
    const current = await readTarget(root, target.path);
    if (!equal(current, target.before) && !equal(current, target.after))
      throw replacementError();
  }
  for (const target of changes)
    await writeTarget(root, target.path, target.before);
  if (state.structure) await validateProjectFiles(root);
  await publish(root, REPLACEMENT_JOURNAL, { ...state, phase: "complete" });
}

async function release(root: string, token: string): Promise<void> {
  const lock = join(root, CHAPTER_CREATION_LOCK);
  const owner = join(lock, "replacement-owner.json");
  await assertRegularPath(
    root,
    `${CHAPTER_CREATION_LOCK}/replacement-owner.json`,
  );
  if (
    (JSON.parse(await readFile(owner, "utf8")) as { token?: unknown }).token !==
    token
  )
    throw replacementError();
  await unlink(owner);
  await rmdir(lock);
}

/** Reopen rolls back an interrupted operation, never replays replacements. */
export async function recoverManuscriptReplacement(
  projectPath: string,
): Promise<void> {
  const root = await realpath(projectPath);
  const state = await journal(root);
  if (!state) return;
  const lock = join(root, CHAPTER_CREATION_LOCK);
  let locked = true;
  try {
    await lstat(lock);
  } catch (error) {
    if (isMissing(error)) locked = false;
    else throw replacementError();
  }
  if (state.phase === "complete" && !locked) return;
  if (active.has(root) || state.host !== hostname()) throw replacementError();
  if (!finished.has(state.token)) {
    try {
      process.kill(state.pid, 0);
      throw replacementError();
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      ))
        throw replacementError();
    }
  }
  // The original operation's owned directory lock remains held throughout
  // recovery. An exclusive claim prevents two reopeners from restoring at once.
  const claim = join(lock, "replacement-recovery");
  if (!locked) throw replacementError();
  await assertRegularPath(
    root,
    `${CHAPTER_CREATION_LOCK}/replacement-owner.json`,
  );
  if (
    (
      JSON.parse(
        await readFile(join(lock, "replacement-owner.json"), "utf8"),
      ) as { token?: unknown }
    ).token !== state.token
  )
    throw replacementError();
  try {
    await mkdir(claim);
  } catch {
    throw replacementError();
  }
  try {
    if (state.phase === "pending") await restore(root, state);
  } catch {
    throw replacementError();
  } finally {
    await rmdir(claim);
  }
  await release(root, state.token);
}

export interface ReplacementInput {
  projectPath: string;
  options: SearchOptions;
  replacement: string;
  chapterId?: string | undefined;
  /** Documents shown in review, checked after the renderer flushes. */
  expected: { id: string; content: Record<string, unknown> }[];
}

export interface ChapterTransactionPlan<T> {
  entries: ReplacementJournal["entries"];
  structure?: ReplacementJournal["structure"];
  result: T;
  reason?: "before-replace" | "before-restructure";
}
export interface ChapterTransactionHooks {
  cancelled?: () => boolean;
  beforeWrite?: (index: number) => Promise<void>;
  snapshot?: typeof createHistorySnapshot;
  writeManifest?: typeof writeJsonAtomicallyAt;
  afterWrite?: (index: number) => Promise<void>;
}
export async function replaceManuscript(
  input: ReplacementInput,
  hooks: ChapterTransactionHooks = {},
): Promise<{ matches: number; chapters: number }> {
  const initial = await openProject(input.projectPath, {
    rebuildSummaries: true,
  });
  if (initial.project.schemaVersion === 3)
    return replaceEditorialManuscript(input, hooks);
  return commitChapterTransaction(
    input.projectPath,
    async (root, cancelled) => {
      const opened = await openProject(root);
      const ids = input.chapterId
        ? [input.chapterId]
        : opened.project.manuscript.order;
      if (
        !ids.every((id) => opened.project.manuscript.order.includes(id)) ||
        !equal(
          ids,
          input.expected.map((chapter) => chapter.id),
        )
      )
        throw new Error("Stale review.");
      const entries: ReplacementJournal["entries"] = [];
      let matches = 0;
      for (const id of ids) {
        cancelled();
        const path = `manuscript/${id}.json`;
        await assertRegularPath(root, path);
        try {
          await lstat(join(root, `${path}.tmp`));
          throw new Error("A chapter has pending recovery data.");
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        const before = ChapterFileSchema.extend({
          content: ManuscriptDocumentSchema,
        })
          .passthrough()
          .parse(JSON.parse(await readFile(join(root, path), "utf8")));
        if (
          !equal(
            before.content,
            input.expected.find((chapter) => chapter.id === id)?.content,
          )
        )
          throw new Error("Stale review.");
        const found = searchChapter(id, before.content, input.options);
        matches += found.length;
        if (!found.length) continue;
        const content = replaceMatches(
          id,
          before.content,
          input.options,
          found,
          input.replacement,
        );
        if (equal(content, before.content)) continue;
        entries.push({
          before,
          after: ChapterFileSchema.extend({ content: ManuscriptDocumentSchema })
            .passthrough()
            .parse({
              ...before,
              content,
              modified: new Date().toISOString(),
            }),
        });
      }

      return { entries, result: { matches, chapters: entries.length } };
    },
    hooks,
  );
}

async function replaceEditorialManuscript(
  input: ReplacementInput,
  hooks: ChapterTransactionHooks,
): Promise<{ matches: number; chapters: number }> {
  const session = await openProject(input.projectPath, {
    rebuildSummaries: true,
  });
  if (session.project.schemaVersion !== 3)
    throw new ApplicationError(
      "REPLACEMENT_STALE",
      "The project changed. Refresh the replacement review.",
    );
  const ids = input.chapterId
    ? [input.chapterId]
    : session.project.manuscript.order;
  if (
    !ids.every((id) => session.project.manuscript.order.includes(id)) ||
    !equal(
      ids,
      input.expected.map((chapter) => chapter.id),
    )
  )
    throw new ApplicationError(
      "REPLACEMENT_STALE",
      "The manuscript changed. Refresh the replacement review.",
    );
  let matches = 0;
  const nextChapters: {
    id: string;
    path: string;
    beforeHash: string;
    chapter: import("@drelwick/project-model").ChapterFileV2;
  }[] = [];
  for (const id of ids) {
    if (hooks.cancelled?.())
      throw new ApplicationError(
        "REPLACEMENT_CANCELLED",
        "Replacement cancelled. Original content was preserved.",
      );
    const path = join(input.projectPath, "manuscript", `${id}.json`);
    const bytes = await readFile(path);
    const before = ChapterFileV2Schema.parse(
      JSON.parse(bytes.toString("utf8")) as unknown,
    );
    const expected = input.expected.find(
      (chapter) => chapter.id === id,
    )?.content;
    if (!equal(before.content, expected))
      throw new ApplicationError(
        "REPLACEMENT_STALE",
        "The manuscript changed. Refresh the replacement review.",
      );
    const found = searchChapter(id, before.content, input.options);
    matches += found.length;
    if (!found.length) continue;
    const content = replaceMatches(
      id,
      before.content,
      input.options,
      found,
      input.replacement,
    );
    if (equal(content, before.content)) continue;
    const chapter = ChapterFileV2Schema.parse({
      ...before,
      modified: new Date().toISOString(),
      revision: before.revision + 1,
      content,
      review: { schemaVersion: 1, mode: "off", proposed: content, pending: [] },
    });
    const safety = await (hooks.snapshot ?? createHistorySnapshot)({
      projectPath: input.projectPath,
      chapterId: id,
      document: before.content,
      reason: "before-replace",
    });
    if (!safety)
      throw new ApplicationError(
        "HISTORY_SNAPSHOT_WRITE_FAILED",
        "Unable to preserve a chapter before replacement.",
      );
    nextChapters.push({
      id,
      path: `manuscript/${id}.json`,
      beforeHash: createHash("sha256").update(bytes).digest("hex"),
      chapter,
    });
  }
  if (!nextChapters.length) return { matches, chapters: 0 };
  const modified = new Date().toISOString();
  const editorialPath = session.project.editorialFile;
  const state = EditorialStateSchema.parse(
    JSON.parse(
      await readFile(join(input.projectPath, editorialPath), "utf8"),
    ) as unknown,
  );
  const changedIds = new Set(nextChapters.map(({ id }) => id));
  const nextState = EditorialStateSchema.parse({
    ...state,
    generation: state.generation + 1,
    anchors: state.anchors.map((anchor) =>
      anchor.segments.some((segment) => changedIds.has(segment.chapterId))
        ? { ...anchor, modified, status: "unverified" as const }
        : anchor,
    ),
  });
  const nextProject = ProjectConfigV3Schema.parse({
    ...session.project,
    modified,
    generation: session.project.generation + 1,
  });
  await commitEditorialTransaction({
    projectPath: input.projectPath,
    projectId: session.project.projectId,
    kind: "edit",
    expectedGeneration: session.project.generation,
    expectedBefore: Object.fromEntries(
      nextChapters.map((chapter) => [chapter.path, chapter.beforeHash]),
    ),
    changes: [
      ...nextChapters.map((item) => ({
        path: item.path,
        after: Buffer.from(`${JSON.stringify(item.chapter, null, 2)}\n`),
      })),
      {
        path: editorialPath,
        after: Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`),
      },
      {
        path: "project.json",
        after: Buffer.from(`${JSON.stringify(nextProject, null, 2)}\n`),
      },
    ],
  });
  return { matches, chapters: nextChapters.length };
}

/** Shared owned-lock/journal protocol for semantic replacement and chapter organisation. */
export async function commitChapterTransaction<T>(
  projectPath: string,
  prepare: (
    root: string,
    cancelled: () => void,
  ) => Promise<ChapterTransactionPlan<T>>,
  hooks: ChapterTransactionHooks = {},
): Promise<T> {
  const root = await realpath(projectPath);
  await assertReplacementReadable(root);
  const lock = join(root, CHAPTER_CREATION_LOCK);
  try {
    await mkdir(lock);
  } catch {
    throw new ApplicationError(
      "PROJECT_BUSY",
      "Another project operation holds the lock.",
    );
  }
  const token = createUuid();
  let state: ReplacementJournal | undefined;
  let keepLock = false;
  active.add(root);
  const cancelled = () => {
    if (hooks.cancelled?.())
      throw new ApplicationError(
        "REPLACEMENT_CANCELLED",
        "Replacement cancelled. Original content was preserved.",
      );
  };
  const execute = async (): Promise<T> => {
    try {
      await publish(root, `${CHAPTER_CREATION_LOCK}/replacement-owner.json`, {
        token,
      });
      const plan = await prepare(root, cancelled);
      const { entries, structure } = plan;
      if (!entries.length && !structure) return plan.result;
      const snapshots = [
        ...entries.map((entry) => entry.before),
        ...(structure?.removed ?? []),
      ];
      for (const before of snapshots) {
        cancelled();
        await (hooks.snapshot ?? createHistorySnapshot)({
          projectPath: root,
          chapterId: before.id,
          document: before.content,
          reason: plan.reason ?? "before-replace",
        });
      }
      cancelled();
      state = {
        schemaVersion: 1,
        token,
        pid: process.pid,
        host: hostname(),
        phase: "pending",
        entries,
        ...(structure ? { structure } : {}),
      };
      state = ReplacementJournalSchema.parse(state);
      await publish(root, REPLACEMENT_JOURNAL, state);
      for (const [index, target] of targets(state).entries()) {
        cancelled();
        await hooks.beforeWrite?.(index);
        cancelled();
        if (!equal(await readTarget(root, target.path), target.before))
          throw replacementError();
        if (target.path === "project.json" && hooks.writeManifest) {
          const path = join(root, target.path);
          await hooks.writeManifest(
            path,
            `${path}.${createUuid()}.tmp`,
            target.after,
          );
          await syncDirectory(root);
        } else
          await writeTarget(
            root,
            target.path,
            target.after,
            target.before === null,
          );
        await hooks.afterWrite?.(index);
      }
      if (structure) await validateProjectFiles(root);
      cancelled();
      await publish(root, REPLACEMENT_JOURNAL, { ...state, phase: "complete" });
      return plan.result;
    } catch (error) {
      if (state) {
        try {
          await restore(root, state);
        } catch {
          keepLock = true;
          throw replacementError();
        }
      }
      if (
        error instanceof ApplicationError &&
        error.code === "REPLACEMENT_CANCELLED"
      )
        throw error;
      throw new ApplicationError(
        "REPLACEMENT_FAILED",
        "Replacement failed or its review became stale. Original content was preserved; refresh the search before retrying.",
      );
    }
  };
  let result: T | undefined;
  let failure: unknown;
  try {
    result = await execute();
  } catch (error) {
    failure = error;
  } finally {
    active.delete(root);
    finished.add(token);
    if (!keepLock) {
      try {
        await release(root, token);
      } catch {
        // Do not report success with an uncertain lock/operation outcome.
        failure = replacementError();
      }
    }
  }
  if (failure) throw failure;
  return result!;
}
