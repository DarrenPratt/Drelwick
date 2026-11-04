import { afterEach, expect, it } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "@tiptap/pm/transform";
import { decodeEditorialDocument } from "@drelwick/project-model";
import { createUuid } from "@drelwick/shared";
import { copyFixture } from "../../../tests/helpers/fixture-projects.js";
import {
  openProjectForEditing,
  openProject,
  migrateProjectToEditorialV3,
  saveChapter,
  readRevisionChapter,
  reviewRevisions,
  assembleBook,
  createProjectArchive,
  restoreProjectArchive,
  captureNamedSnapshot,
  listManuscriptSnapshots,
  captureComparisonSource,
  replaceManuscript,
  previewSnapshotRestore,
  restoreNamedSnapshot,
} from "../src/index.js";
import {
  normalizeRevision,
  RevisionStateStep,
  type RevisionState,
} from "../src/revisions.js";
import { EditorialHistoryStep } from "../src/editorial-history.js";
import {
  createEditorialAnnotation,
  readEditorialChapter,
} from "../src/index.js";
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

it("R01/R04 scoped replacement preserves pending state and requires explicit combine consent", async () => {
  const f = await fixture();
  await edit(
    f,
    (await readRevisionChapter(f.root, f.projectId, f.chapterId)).state,
    doc("red quick fox"),
  );
  const source = await readRevisionChapter(f.root, f.projectId, f.chapterId),
    before = await readFile(join(f.root, "manuscript", `${f.chapterId}.json`));
  const input = {
    projectPath: f.root,
    chapterId: f.chapterId,
    options: { query: "quick", matchCase: true, wholeWord: true },
    replacement: "swift",
    expected: [{ id: f.chapterId, content: source.state.review.proposed }],
  };
  await expect(replaceManuscript(input)).rejects.toMatchObject({
    code: "REPLACEMENT_CANCELLED",
  });
  expect(
    await readFile(join(f.root, "manuscript", `${f.chapterId}.json`)),
  ).toEqual(before);
  const result = await replaceManuscript(input, {
    confirmRevisions: async (preview) => {
      expect(preview.chapters[0]!.groupIds).toEqual(
        source.state.review.pending.map((g) => g.id),
      );
      expect(
        decodeEditorialDocument(preview.chapters[0]!.proposed).eq(
          decodeEditorialDocument(doc("red swift fox")),
        ),
      ).toBe(true);
      return true;
    },
  });
  expect(result).toEqual({ matches: 1, chapters: 1 });
  const after = await readRevisionChapter(f.root, f.projectId, f.chapterId);
  expect(after.state.content).toEqual(doc("red fox"));
  expect(after.state.review.pending[0]!.supersedes).toContain(
    source.state.review.pending[0]!.id,
  );
  expect(after.state.review.proposed).toEqual(doc("red swift fox"));
  await replaceManuscript({
    ...input,
    options: { ...input.options, query: "red" },
    replacement: "RED",
    expected: [{ id: f.chapterId, content: after.state.review.proposed }],
  });
  expect(
    (await readRevisionChapter(f.root, f.projectId, f.chapterId)).state.review
      .pending,
  ).toHaveLength(2);
});

it("R02 Replace All treats adjacent matches as one confirmed action without inventing superseded evidence", async () => {
  const f = await fixture();
  await saveChapter({
    projectPath: f.root,
    chapterId: f.chapterId,
    document: doc("aaaa"),
  });
  let view = await readRevisionChapter(f.root, f.projectId, f.chapterId);
  await edit(f, view.state, doc("aaaa!"));
  view = await readRevisionChapter(f.root, f.projectId, f.chapterId);
  // Two adjacent matches are disjoint from the retained insertion at the end
  // only after explicit consent to the touching boundary.
  await replaceManuscript(
    {
      projectPath: f.root,
      chapterId: f.chapterId,
      options: { query: "aa", matchCase: true, wholeWord: false },
      replacement: "x",
      expected: [{ id: f.chapterId, content: view.state.review.proposed }],
    },
    { confirmRevisions: async () => true },
  );
  const after = await readRevisionChapter(f.root, f.projectId, f.chapterId);
  expect(decodeEditorialDocument(after.state.review.proposed).textContent).toBe(
    "xx!",
  );
  expect(after.state.review.pending[0]!.supersedes).toEqual(
    view.state.review.pending.map((g) => g.id),
  );
});

it("R06 bounds large replacement work before publishing any chapter", async () => {
  const f = await fixture();
  await saveChapter({
    projectPath: f.root,
    chapterId: f.chapterId,
    document: doc("a".repeat(1001)),
  });
  const source = await readRevisionChapter(f.root, f.projectId, f.chapterId),
    path = join(f.root, "manuscript", `${f.chapterId}.json`),
    before = await readFile(path);
  await expect(
    replaceManuscript({
      projectPath: f.root,
      chapterId: f.chapterId,
      options: { query: "a", matchCase: true, wholeWord: false },
      replacement: "b",
      expected: [{ id: f.chapterId, content: source.state.review.proposed }],
    }),
  ).rejects.toMatchObject({ code: "EDITORIAL_LIMIT" });
  expect(await readFile(path)).toEqual(before);
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});
async function fixture() {
  const f = await copyFixture("minimal-book");
  cleanups.push(f.cleanup);
  await openProjectForEditing(f.projectPath);
  await migrateProjectToEditorialV3(f.projectPath);
  const p = await openProject(f.projectPath);
  const chapterId = p.chapters[0]!.id,
    projectId = p.project.projectId;
  await saveChapter({
    projectPath: f.projectPath,
    chapterId,
    document: doc("red fox"),
  });
  return { root: f.projectPath, chapterId, projectId };
}
async function edit(
  f: Awaited<ReturnType<typeof fixture>>,
  current: RevisionState,
  next: Record<string, unknown>,
) {
  const options = {
    id: createUuid(),
    created: new Date().toISOString(),
    authorLabel: "PRIVATE_AUTHOR_CANARY",
    tracking: true,
  };
  const plan = normalizeRevision(current, next, options);
  const before = decodeEditorialDocument(current.review.proposed),
    tr = new Transform(before).replaceWith(
      0,
      before.content.size,
      decodeEditorialDocument(next).content,
    );
  tr.step(
    new RevisionStateStep(options.id, current, plan.state, {
      kind: "edit",
      options,
    }),
  );
  tr.step(new EditorialHistoryStep(createUuid()));
  await saveChapter({
    projectPath: f.root,
    chapterId: f.chapterId,
    operationId: createUuid(),
    editorGeneration: 1,
    document: next,
    transactions: [
      {
        before: before.toJSON() as Record<string, unknown>,
        steps: tr.steps.map((step) => step.toJSON() as Record<string, unknown>),
      },
    ],
  });
  return plan.state;
}
it("R03/R06 saves/reopens pending changes, rejects stale review and commits an exact decision with before-review safety", async () => {
  const f = await fixture();
  const initial = await readRevisionChapter(f.root, f.projectId, f.chapterId);
  const state = await edit(f, initial.state, doc("red quick fox"));
  const pending = await readRevisionChapter(f.root, f.projectId, f.chapterId);
  expect(pending.state).toEqual(state);
  expect((await openProject(f.root)).project.schemaVersion).toBe(3);
  const before = await readFile(
    join(f.root, "manuscript", `${f.chapterId}.json`),
  );
  await expect(
    reviewRevisions({
      projectPath: f.root,
      projectId: f.projectId,
      chapterId: f.chapterId,
      operationId: createUuid(),
      expected: initial.expected,
      ids: [state.review.pending[0]!.id],
      action: "accept",
    }),
  ).rejects.toMatchObject({ code: "EDITORIAL_STALE" });
  expect(
    await readFile(join(f.root, "manuscript", `${f.chapterId}.json`)),
  ).toEqual(before);
  const input = {
    projectPath: f.root,
    projectId: f.projectId,
    chapterId: f.chapterId,
    operationId: createUuid(),
    expected: pending.expected,
    ids: [state.review.pending[0]!.id],
    action: "accept" as const,
  };
  const accepted = await reviewRevisions(input);
  expect(accepted.state.content).toEqual(doc("red quick fox"));
  expect(accepted.state.review.pending).toEqual([]);
  expect(
    (await listManuscriptSnapshots(f.root, f.projectId)).snapshots[0]!.reason,
  ).toBe("before-review");
  expect((await reviewRevisions(input)).operationId).toBe(input.operationId);
});
it("E01/E02/E03 demands explicit projection/cancel, keeps pending envelopes private and immutable, and captures both snapshot projections", async () => {
  const f = await fixture();
  await edit(
    f,
    (await readRevisionChapter(f.root, f.projectId, f.chapterId)).state,
    doc("red quick fox"),
  );
  const path = join(f.root, "manuscript", `${f.chapterId}.json`),
    before = await readFile(path);
  await expect(assembleBook(f.root)).rejects.toMatchObject({
    code: "REVISION_PROJECTION_REQUIRED",
  });
  await expect(
    assembleBook(f.root, { chooseProjection: async () => null }),
  ).rejects.toMatchObject({ code: "REVISION_PROJECTION_CANCELLED" });
  const accepted = await assembleBook(f.root, { projection: "accepted" }),
    proposed = await assembleBook(f.root, { projection: "proposed" });
  expect(JSON.stringify(accepted.book.chapters)).toContain("red fox");
  expect(JSON.stringify(proposed.book.chapters)).toContain("red quick fox");
  expect(JSON.stringify(proposed.book)).not.toContain("PRIVATE_AUTHOR_CANARY");
  expect(await readFile(path)).toEqual(before);
  const snapshot = await captureNamedSnapshot({
    projectPath: f.root,
    projectId: f.projectId,
    operationId: createUuid(),
    label: "Pending",
    expected: (await listManuscriptSnapshots(f.root, f.projectId)).source,
  });
  expect(
    JSON.stringify(
      (
        await captureComparisonSource(f.root, f.projectId, {
          kind: "snapshot",
          ...snapshot,
          projection: "accepted",
        })
      ).chapters,
    ),
  ).toContain("red fox");
  expect(
    JSON.stringify(
      (
        await captureComparisonSource(f.root, f.projectId, {
          kind: "snapshot",
          ...snapshot,
          projection: "proposed",
        })
      ).chapters,
    ),
  ).toContain("red quick fox");
  const pending = (await readRevisionChapter(f.root, f.projectId, f.chapterId))
    .state;
  const view = await readRevisionChapter(f.root, f.projectId, f.chapterId);
  await reviewRevisions({
    projectPath: f.root,
    projectId: f.projectId,
    chapterId: f.chapterId,
    operationId: createUuid(),
    expected: view.expected,
    ids: view.state.review.pending.map((g) => g.id),
    action: "accept",
  });
  const restore = await previewSnapshotRestore(f.root, f.projectId, snapshot);
  await restoreNamedSnapshot({
    projectPath: f.root,
    projectId: f.projectId,
    operationId: createUuid(),
    selection: snapshot,
    expected: restore.current,
  });
  expect(
    (await readRevisionChapter(f.root, f.projectId, f.chapterId)).state,
  ).toEqual(pending);
});

it("R03/R05 restores exact deleted-text annotation targets after backup/reopen while preserving private discussions", async () => {
  const f = await fixture();
  await createEditorialAnnotation({
    projectPath: f.root,
    chapterId: f.chapterId,
    from: 5,
    to: 8,
    kind: "comment",
    body: "PRIVATE_DISCUSSION",
    evidence: {
      slice: {
        content: [{ type: "text", text: "fox" }],
        openStart: 0,
        openEnd: 0,
      },
      prefix: "red ",
      suffix: "",
    },
  });
  await edit(
    f,
    (await readRevisionChapter(f.root, f.projectId, f.chapterId)).state,
    doc("red "),
  );
  const retainedView = await readRevisionChapter(
    f.root,
    f.projectId,
    f.chapterId,
  );
  const group = retainedView.state.review.pending[0]!;
  await createEditorialAnnotation({
    projectPath: f.root,
    chapterId: f.chapterId,
    from: group.from,
    to: group.to,
    revisionGroupId: group.id,
    kind: "comment",
    body: "PRIVATE_REVIEW_COMMENT",
    evidence: { slice: group.before, prefix: "red ", suffix: "" },
  });
  const before = await readEditorialChapter({
    projectPath: f.root,
    chapterId: f.chapterId,
  });
  expect(before.anchors[0]!.status).toBe("orphaned");
  expect(before.anchors[0]!.lost[0]!.reviewTarget).toMatchObject({
    from: 5,
    to: 8,
  });
  const scratch = await mkdtemp(join(tmpdir(), "revision-backup-"));
  cleanups.push(() => rm(scratch, { recursive: true, force: true }));
  const archivePath = join(scratch, "pending.zip");
  await createProjectArchive({
    projectPath: f.root,
    archivePath,
    includeHistory: false,
  });
  const restored = await restoreProjectArchive({
    archivePath,
    destinationParent: scratch,
  });
  const state = await readRevisionChapter(
    restored.projectPath,
    f.projectId,
    f.chapterId,
  );
  expect(state.state.review.pending).toHaveLength(1);
  await reviewRevisions({
    projectPath: restored.projectPath,
    projectId: f.projectId,
    chapterId: f.chapterId,
    operationId: createUuid(),
    expected: state.expected,
    ids: state.state.review.pending.map((group) => group.id),
    action: "reject",
  });
  const after = await readEditorialChapter({
    projectPath: restored.projectPath,
    chapterId: f.chapterId,
  });
  expect(after.anchors[0]!.status).toBe("attached");
  expect(after.anchors[0]!.segments[0]).toMatchObject({ from: 5, to: 8 });
  expect(after.anchors[0]!.lost).toEqual([]);
  expect(after.threads[0]!.comments[0]!.body).toBe("PRIVATE_DISCUSSION");
});
