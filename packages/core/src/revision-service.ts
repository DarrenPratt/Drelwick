import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ChapterFileV2Schema,
  ProjectConfigV3Schema,
  EditorialStateSchema,
  parseEditorialJson,
  type ChapterFileV2,
  EditorialTransactionSchema,
} from "@drelwick/project-model";
import { ApplicationError } from "@drelwick/shared";
import { withReferenceLock } from "./reference-files.js";
import {
  assertEditorialReadable,
  commitPreparedEditorialTransaction,
  readEditorialRequestReceipt,
  type CommitEditorialInput,
} from "./editorial-transactions.js";
import { captureRevisionReviewSafetyLocked } from "./manuscript-snapshots.js";
import { planRevisionReview, type RevisionState } from "./revisions.js";
import {
  captureEditorialReplaySession,
  acknowledgeEditorialReplaySession,
  registerEditorialMetadataEvent,
  replayEditorialEdits,
} from "./editorial-editing.js";
import { editorialDocumentHash } from "./editorial-bundle.js";
import {
  advanceRevisionAnchorTargets,
  restoreRejectedRevisionAnchors,
} from "./revision-anchors.js";
import { regularPath, boundedRead } from "./image-assets.js";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const fail = () =>
  new ApplicationError(
    "EDITORIAL_STALE",
    "The captured revision decision is stale. Refresh review before deciding again.",
  );
export interface RevisionExpected {
  generation: number;
  revision: number;
  projectHash: string;
  chapterHash: string;
  editorialHash: string;
}
async function read(root: string, projectId: string, chapterId: string) {
  if (!/^[a-fA-F0-9-]{36}$/.test(chapterId)) throw fail();
  await assertEditorialReadable(root);
  const safeRead = async (path: string) => {
    await regularPath(join(root, path));
    return boundedRead(join(root, path), 8 * 1024 ** 2);
  };
  const projectBytes = await safeRead("project.json");
  const project = ProjectConfigV3Schema.parse(parseEditorialJson(projectBytes));
  if (
    project.projectId !== projectId ||
    !project.manuscript.order.includes(chapterId)
  )
    throw fail();
  const path = `manuscript/${chapterId}.json`,
    chapterBytes = await safeRead(path),
    editorialBytes = await safeRead(project.editorialFile);
  const chapter = ChapterFileV2Schema.parse(parseEditorialJson(chapterBytes)),
    editorial = EditorialStateSchema.parse(parseEditorialJson(editorialBytes));
  if (
    chapter.id !== chapterId ||
    editorial.projectId !== projectId ||
    editorial.generation !== project.generation
  )
    throw fail();
  return {
    project,
    chapter,
    editorial,
    path,
    expected: {
      generation: project.generation,
      revision: chapter.revision,
      projectHash: hash(projectBytes),
      chapterHash: hash(chapterBytes),
      editorialHash: hash(editorialBytes),
    },
  };
}
export async function readRevisionChapter(
  projectPath: string,
  projectId: string,
  chapterId: string,
) {
  return withReferenceLock(projectPath, async (root) => {
    const source = await read(root, projectId, chapterId);
    return {
      state: {
        content: source.chapter.content,
        review: source.chapter.review,
      } as RevisionState,
      expected: source.expected,
      title: source.chapter.title,
    };
  });
}
export interface ReviewRevisionInput {
  projectPath: string;
  projectId: string;
  chapterId: string;
  operationId: string;
  expected: RevisionExpected;
  ids: string[];
  action: "accept" | "reject";
}
export async function reviewRevisions(
  input: ReviewRevisionInput,
  options: {
    authorized?: () => boolean;
    checkpoint?: NonNullable<CommitEditorialInput["checkpoint"]>;
  } = {},
): Promise<{
  state: RevisionState;
  historyEventId: string;
  operationId: string;
  safetySnapshotId?: string;
  expected?: RevisionExpected;
  title?: string;
}> {
  const requestHash = editorialDocumentHash({
    ...input,
    projectPath: undefined,
  });
  const root = await realpath(input.projectPath);
  const prior = await readEditorialRequestReceipt({
    projectPath: root,
    projectId: input.projectId,
    operationId: input.operationId,
    requestHash,
    chapterId: input.chapterId,
  });
  if (prior) {
    return withReferenceLock(root, async (locked) => {
      const current = await read(locked, input.projectId, input.chapterId),
        directory = join(
          locked,
          ".editorial",
          "transactions",
          input.operationId,
        );
      const journalRead = async (path: string) => {
        await regularPath(path);
        return boundedRead(path, 8 * 1024 ** 2);
      };
      const journal = EditorialTransactionSchema.parse(
        parseEditorialJson(
          await journalRead(join(directory, "transaction.json")),
        ),
      );
      const images = async (path: string) => {
        const ref = journal.files.find((file) => file.path === path);
        const pair = [];
        for (const side of ["before", "after"] as const) {
          const bytes = await journalRead(join(directory, side, path));
          if (
            !ref?.[side] ||
            hash(bytes) !== ref[side].sha256 ||
            bytes.length !== ref[side].size
          )
            throw fail();
          pair.push(bytes);
        }
        return pair as [Buffer, Buffer];
      };
      const chapters = await images(current.path),
        states = await images(current.project.editorialFile),
        projects = await images("project.json");
      if (
        current.expected.generation !== prior.generation ||
        current.expected.chapterHash !== hash(chapters[1]) ||
        current.expected.editorialHash !== hash(states[1]) ||
        current.expected.projectHash !== hash(projects[1]) ||
        options.authorized?.() === false
      )
        throw fail();
      const before = ChapterFileV2Schema.parse(parseEditorialJson(chapters[0])),
        after = ChapterFileV2Schema.parse(parseEditorialJson(chapters[1]));
      const key = `${locked}\0${input.chapterId}`;
      registerEditorialMetadataEvent(
        key,
        input.operationId,
        after.review.proposed,
        EditorialStateSchema.parse(parseEditorialJson(states[0])),
        EditorialStateSchema.parse(parseEditorialJson(states[1])),
        before.review.proposed,
      );
      const session = captureEditorialReplaySession(key);
      (session.revisionEvents ??= new Map()).set(input.operationId, {
        before: { content: before.content, review: before.review },
        after: { content: after.content, review: after.review },
      });
      acknowledgeEditorialReplaySession(key, session);
      return {
        state: {
          content: current.chapter.content,
          review: current.chapter.review,
        },
        expected: current.expected,
        title: current.chapter.title,
        historyEventId: input.operationId,
        operationId: input.operationId,
      };
    });
  }
  let event:
    | {
        before: RevisionState;
        after: RevisionState;
        source: Awaited<ReturnType<typeof read>>;
        nextEditorial: Awaited<ReturnType<typeof read>>["editorial"];
      }
    | undefined;
  const committed = await commitPreparedEditorialTransaction(
    root,
    async (locked) => {
      const source = await read(locked, input.projectId, input.chapterId);
      if (
        options.authorized?.() === false ||
        editorialDocumentHash(source.expected) !==
          editorialDocumentHash(input.expected)
      )
        throw fail();
      const before: RevisionState = {
        content: source.chapter.content,
        review: source.chapter.review,
      };
      const plan = planRevisionReview(before, input.ids, input.action);
      const safety = await captureRevisionReviewSafetyLocked(
        locked,
        input.projectId,
        input.operationId,
        options,
      );
      const modified = new Date().toISOString();
      const chapter: ChapterFileV2 = ChapterFileV2Schema.parse({
        ...source.chapter,
        ...plan.state,
        revision: source.chapter.revision + 1,
        modified,
      });
      const editorial = {
        ...source.editorial,
        generation: source.editorial.generation + 1,
        anchors: replayEditorialEdits({
          chapterId: input.chapterId,
          revision: chapter.revision,
          before: before.review.proposed,
          after: plan.state.review.proposed,
          anchors: source.editorial.anchors,
          state: source.editorial,
          transactions: [{ before: before.review.proposed, steps: plan.steps }],
        }),
      };
      if (input.action === "reject")
        editorial.anchors = restoreRejectedRevisionAnchors(
          editorial.anchors,
          input.chapterId,
          chapter.revision,
          plan.state,
          input.ids,
          source.project.manuscript.order,
        );
      editorial.anchors = advanceRevisionAnchorTargets(
        editorial.anchors,
        source.editorial.anchors,
        input.chapterId,
        before,
        plan.state,
        new Map(),
      );
      const project = {
        ...source.project,
        generation: source.project.generation + 1,
        modified,
      };
      event = { before, after: plan.state, source, nextEditorial: editorial };
      const bytes = (value: unknown) =>
        Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      return {
        result: {
          state: plan.state,
          historyEventId: input.operationId,
          operationId: input.operationId,
          safetySnapshotId: safety.snapshotId,
        },
        transaction: {
          projectId: input.projectId,
          kind: "review" as const,
          operationId: input.operationId,
          requestHash,
          expectedGeneration: input.expected.generation,
          expectedBefore: {
            "project.json": input.expected.projectHash,
            [source.path]: input.expected.chapterHash,
            [source.project.editorialFile]: input.expected.editorialHash,
          },
          decisions: input.ids.map((groupId) => ({
            chapterId: input.chapterId,
            groupId,
            action: input.action,
            replacementGroupId: null,
          })),
          changes: [
            { path: source.path, after: bytes(chapter) },
            { path: source.project.editorialFile, after: bytes(editorial) },
            { path: "project.json", after: bytes(project) },
          ],
          ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}),
          validateInventory: async () => {
            if (options.authorized?.() === false) throw fail();
          },
        },
      };
    },
  );
  if (event) {
    const key = `${root}\0${input.chapterId}`;
    registerEditorialMetadataEvent(
      key,
      input.operationId,
      event.after.review.proposed,
      event.source.editorial,
      event.nextEditorial,
      event.before.review.proposed,
    );
    const session = captureEditorialReplaySession(key);
    (session.revisionEvents ??= new Map()).set(input.operationId, {
      before: event.before,
      after: event.after,
    });
    acknowledgeEditorialReplaySession(key, session);
  }
  return committed.result;
}
