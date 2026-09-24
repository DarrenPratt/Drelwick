import {
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
import {
  ChapterFileSchema,
  ManuscriptDocumentSchema,
  ReplacementJournalSchema,
  type ReplacementJournal,
} from "@drelwick/project-model";
import { ApplicationError, createUuid } from "@drelwick/shared";
import {
  CHAPTER_CREATION_LOCK,
  createHistorySnapshot,
  openProject,
  writeJsonAtomicallyAt,
} from "./index.js";
import { assertRegularPath, syncDirectory } from "./project-snapshot.js";
import { isMissing } from "./migration-state.js";
import {
  replaceMatches,
  searchChapter,
  type SearchOptions,
} from "./manuscript-search.js";

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

async function restore(root: string, state: ReplacementJournal): Promise<void> {
  // Validate every target before the first rollback write. A third revision is
  // external work: retain the journal and fail closed instead of overwriting it.
  for (const entry of state.entries) {
    const path = `manuscript/${entry.before.id}.json`;
    await assertRegularPath(root, path);
    const current: unknown = JSON.parse(
      await readFile(join(root, path), "utf8"),
    );
    if (!equal(current, entry.before) && !equal(current, entry.after))
      throw replacementError();
  }
  for (const entry of state.entries)
    await publish(root, `manuscript/${entry.before.id}.json`, entry.before);
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

export async function replaceManuscript(
  input: ReplacementInput,
  hooks: {
    cancelled?: () => boolean;
    beforeWrite?: (index: number) => Promise<void>;
    snapshot?: typeof createHistorySnapshot;
  } = {},
): Promise<{ matches: number; chapters: number }> {
  const root = await realpath(input.projectPath);
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
  const execute = async (): Promise<{ matches: number; chapters: number }> => {
    try {
      await publish(root, `${CHAPTER_CREATION_LOCK}/replacement-owner.json`, {
        token,
      });
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
      if (!entries.length) return { matches, chapters: 0 };
      for (const entry of entries) {
        cancelled();
        await (hooks.snapshot ?? createHistorySnapshot)({
          projectPath: root,
          chapterId: entry.before.id,
          document: entry.before.content,
          reason: "before-replace",
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
      };
      await publish(root, REPLACEMENT_JOURNAL, state);
      for (const [index, entry] of entries.entries()) {
        cancelled();
        await hooks.beforeWrite?.(index);
        cancelled();
        const path = `manuscript/${entry.before.id}.json`;
        await assertRegularPath(root, path);
        if (
          !equal(
            JSON.parse(await readFile(join(root, path), "utf8")),
            entry.before,
          )
        )
          throw replacementError();
        await publish(root, `manuscript/${entry.before.id}.json`, entry.after);
      }
      cancelled();
      await publish(root, REPLACEMENT_JOURNAL, { ...state, phase: "complete" });
      return { matches, chapters: entries.length };
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
  let result: { matches: number; chapters: number } | undefined;
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
