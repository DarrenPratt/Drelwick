import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  commitEditorialTransaction,
  migrateProjectToEditorialV3,
  recoverEditorialTransactions,
  readEditorialTransactionDraft,
  listEditorialTransactionDrafts,
} from "../src/editorial-transactions.js";
import { openProject } from "../src/index.js";
import { saveChapter } from "../src/chapter-saving.js";
import { editorialDocumentHash } from "../src/editorial-bundle.js";
import {
  createEditorialAnnotation,
  reattachEditorialAnchor,
  replyToEditorialThread,
  updateEditorialComment,
  setEditorialThreadResolved,
  tombstoneEditorialAnnotation,
} from "../src/editorial-service.js";
import { createHistorySnapshot, readHistorySnapshot } from "../src/history.js";
import { assembleBook } from "../src/book-assembly.js";
import { renameChapter } from "../src/chapter-rename.js";
import { organiseChapter } from "../src/chapter-organisation.js";
import { deleteChapter } from "../src/chapter-deletion.js";
import { createChapter } from "../src/chapter-creation.js";
import { replaceManuscript } from "../src/manuscript-replacement.js";
import { loadChapter } from "../src/chapter-loading.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "editorial-tx-"));
  roots.push(root);
  await mkdir(join(root, "editorial"), { recursive: true });
  await writeFile(
    join(root, "project.json"),
    JSON.stringify({
      schemaVersion: 3,
      projectId: "00000000-0000-4000-8000-000000000001",
      generation: 7,
    }),
  );
  await writeFile(
    join(root, "editorial/state.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectId: "00000000-0000-4000-8000-000000000001",
      generation: 7,
    }),
  );
  return root;
}
function changes(generation: number) {
  return [
    {
      path: "project.json",
      after: Buffer.from(
        JSON.stringify({
          schemaVersion: 3,
          projectId: "00000000-0000-4000-8000-000000000001",
          generation,
        }),
      ),
    },
    {
      path: "editorial/state.json",
      after: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          projectId: "00000000-0000-4000-8000-000000000001",
          generation,
        }),
      ),
    },
  ] as const;
}

it("commits both generation-bound files and retries idempotently", async () => {
  const root = await fixture();
  const operationId = "00000000-0000-4000-8000-000000000010";
  const input = {
    projectPath: root,
    projectId: "00000000-0000-4000-8000-000000000001",
    operationId,
    kind: "annotation" as const,
    expectedGeneration: 7,
    changes: changes(8),
  };
  expect(await commitEditorialTransaction(input)).toEqual({
    operationId,
    generation: 8,
  });
  expect(await commitEditorialTransaction(input)).toEqual({
    operationId,
    generation: 8,
  });
  await expect(
    commitEditorialTransaction({ ...input, changes: changes(9) }),
  ).rejects.toMatchObject({ code: "EDITORIAL_RECOVERY_REQUIRED" });
  await expect(
    commitEditorialTransaction({ ...input, kind: "edit" }),
  ).rejects.toMatchObject({ code: "EDITORIAL_RECOVERY_REQUIRED" });
  expect(
    JSON.parse(await readFile(join(root, "project.json"), "utf8")).generation,
  ).toBe(8);
});

it("publishes the project generation after every dependent file", async () => {
  const root = await fixture();
  const generations: number[] = [];
  await commitEditorialTransaction({
    projectPath: root,
    projectId: "00000000-0000-4000-8000-000000000001",
    kind: "structure",
    expectedGeneration: 7,
    changes: [
      ...changes(8),
      { path: "trash/retained.json", after: Buffer.from("retained evidence") },
    ],
    checkpoint: async (point) => {
      if (point === "after-publication")
        generations.push(
          JSON.parse(await readFile(join(root, "project.json"), "utf8"))
            .generation,
        );
    },
  });
  expect(generations).toEqual([7, 7, 8]);
  expect(await readFile(join(root, "trash/retained.json"), "utf8")).toBe(
    "retained evidence",
  );
});

it("recovers a partially published prepared transaction to its before images", async () => {
  const root = await fixture();
  let published = 0;
  await expect(
    commitEditorialTransaction({
      projectPath: root,
      projectId: "00000000-0000-4000-8000-000000000001",
      operationId: "00000000-0000-4000-8000-000000000011",
      kind: "annotation",
      expectedGeneration: 7,
      changes: changes(8),
      checkpoint: async (point) => {
        if (point === "after-publication" && ++published === 1)
          throw new Error("crash");
      },
    }),
  ).rejects.toThrow();
  await recoverEditorialTransactions(root);
  const draft = await readEditorialTransactionDraft({
    projectPath: root,
    projectId: "00000000-0000-4000-8000-000000000001",
    operationId: "00000000-0000-4000-8000-000000000011",
  });
  expect(draft.baseGeneration).toBe(7);
  expect(
    await listEditorialTransactionDrafts({
      projectPath: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    }),
  ).toEqual({
    candidates: [{ operationId: draft.operationId, baseGeneration: 7 }],
    diagnostics: [],
  });
  const staged = join(
    root,
    ".editorial",
    "transactions",
    draft.operationId,
    "after",
    "editorial",
    "state.json",
  );
  const savedEvidence = await readFile(staged);
  await writeFile(staged, "corrupt evidence");
  expect(
    (
      await listEditorialTransactionDrafts({
        projectPath: root,
        projectId: "00000000-0000-4000-8000-000000000001",
      })
    ).diagnostics,
  ).toEqual([
    { operationId: draft.operationId, code: "EDITORIAL_RECOVERY_REQUIRED" },
  ]);
  expect(await readFile(staged, "utf8")).toBe("corrupt evidence");
  await writeFile(staged, savedEvidence);
  expect(draft.changes).toEqual(
    [...changes(8)].sort((a, b) => a.path.localeCompare(b.path)),
  );
  expect(
    JSON.parse(await readFile(join(root, "project.json"), "utf8")).generation,
  ).toBe(7);
  expect(
    JSON.parse(await readFile(join(root, "editorial/state.json"), "utf8"))
      .generation,
  ).toBe(7);
});

it("refuses recovery conflicts before changing any live file", async () => {
  const root = await fixture();
  let publications = 0;
  await expect(
    commitEditorialTransaction({
      projectPath: root,
      projectId: "00000000-0000-4000-8000-000000000001",
      kind: "annotation",
      expectedGeneration: 7,
      changes: changes(8),
      checkpoint: async (point) => {
        if (point === "after-publication" && ++publications === 2)
          throw new Error("interrupted before commit marker");
      },
    }),
  ).rejects.toThrow();
  const projectBefore = await readFile(join(root, "project.json"));
  const external = Buffer.from("external editorial evidence");
  await writeFile(join(root, "editorial/state.json"), external);
  await expect(recoverEditorialTransactions(root)).rejects.toMatchObject({
    code: "EDITORIAL_RECOVERY_REQUIRED",
  });
  expect(await readFile(join(root, "project.json"))).toEqual(projectBefore);
  expect(await readFile(join(root, "editorial/state.json"))).toEqual(external);
});

it("rolls a committed transaction forward after interruption before acknowledgement", async () => {
  const root = await fixture();
  await expect(
    commitEditorialTransaction({
      projectPath: root,
      projectId: "00000000-0000-4000-8000-000000000001",
      operationId: "00000000-0000-4000-8000-000000000012",
      kind: "annotation",
      expectedGeneration: 7,
      changes: changes(8),
      checkpoint: async (point) => {
        if (point === "committed") throw new Error("process stopped");
      },
    }),
  ).rejects.toThrow();
  await recoverEditorialTransactions(root);
  expect(
    JSON.parse(await readFile(join(root, "project.json"), "utf8")).generation,
  ).toBe(8);
  expect(
    JSON.parse(await readFile(join(root, "editorial/state.json"), "utf8"))
      .generation,
  ).toBe(8);
});

it("migrates a complete v2 fixture with a verified backup and reopens as v3", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-migrate-"));
  roots.push(root);
  await cp(
    new URL("../../../docs/examples/editorial-v1/project/", import.meta.url),
    root,
    { recursive: true },
  );
  const projectV3 = JSON.parse(
    await readFile(join(root, "project.json"), "utf8"),
  ) as Record<string, unknown>;
  const oldProject = Object.fromEntries(
    Object.entries(projectV3).filter(
      ([key]) => key !== "generation" && key !== "editorialFile",
    ),
  );
  oldProject.schemaVersion = 2;
  await writeFile(
    join(root, "project.json"),
    `${JSON.stringify(oldProject, null, 2)}\n`,
  );
  const chapterPath = join(
    root,
    "manuscript",
    "00000000-0000-4000-8000-000000000002.json",
  );
  const chapterV2 = JSON.parse(await readFile(chapterPath, "utf8")) as Record<
    string,
    unknown
  >;
  const oldChapter = Object.fromEntries(
    Object.entries(chapterV2).filter(
      ([key]) => key !== "revision" && key !== "review",
    ),
  );
  oldChapter.schemaVersion = 1;
  await writeFile(chapterPath, `${JSON.stringify(oldChapter, null, 2)}\n`);
  await writeFile(
    join(root, "format.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        projectId: oldProject.projectId,
        bookSchemaVersion: 1,
        chapterSchemaVersion: 1,
      },
      null,
      2,
    ) + "\n",
  );
  await rm(join(root, "editorial"), { recursive: true, force: true });
  const result = await migrateProjectToEditorialV3(root, {
    operationId: "00000000-0000-4000-8000-000000000020",
  });
  expect(
    await readFile(join(root, result.backupPath, "project.json"), "utf8"),
  ).toContain('"schemaVersion": 2');
  const opened = await openProject(root, { rebuildSummaries: true });
  expect(opened.project.schemaVersion).toBe(3);
  const editorialPath = join(root, "editorial/state.json");
  const editorialFixture = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/examples/editorial-v1/project/editorial/state.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const migratedChapter = JSON.parse(
    await readFile(
      join(root, "manuscript/00000000-0000-4000-8000-000000000002.json"),
      "utf8",
    ),
  );
  editorialFixture.anchors[0].segments = [
    {
      chapterId: migratedChapter.id,
      chapterRevision: 1,
      documentHash: editorialDocumentHash(migratedChapter.content),
      from: 5,
      to: 8,
      pointAffinity: "right",
    },
  ];
  editorialFixture.generation = 1;
  await writeFile(
    editorialPath,
    `${JSON.stringify(editorialFixture, null, 2)}\n`,
  );
  await saveChapter({
    projectPath: root,
    chapterId: "00000000-0000-4000-8000-000000000002",
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "new prose" }] },
      ],
    },
  });
  const edited = await openProject(root, { rebuildSummaries: true });
  expect(edited.project.schemaVersion).toBe(3);
  let editorial = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(editorial.generation).toBe(2);
  expect(editorial.anchors[0].status).toBe("unverified");
  expect(
    JSON.parse(
      await readFile(
        join(root, "manuscript", "00000000-0000-4000-8000-000000000002.json"),
        "utf8",
      ),
    ).review.pending,
  ).toEqual([]);
  const currentContent = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "new prose" }] },
    ],
  };
  const restoredContent = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "old prose" }] },
    ],
  };
  const currentChapter = JSON.parse(
    await readFile(
      join(root, "manuscript/00000000-0000-4000-8000-000000000002.json"),
      "utf8",
    ),
  );
  editorial = JSON.parse(await readFile(editorialPath, "utf8"));
  editorial.anchors[0] = {
    ...editorial.anchors[0],
    status: "attached",
    lost: [],
    segments: [
      {
        chapterId: currentChapter.id,
        chapterRevision: currentChapter.revision,
        documentHash: editorialDocumentHash(currentContent),
        from: 1,
        to: 4,
        pointAffinity: "right",
      },
    ],
  };
  await writeFile(editorialPath, `${JSON.stringify(editorial, null, 2)}\n`);
  const history = await createHistorySnapshot({
    projectPath: root,
    chapterId: currentChapter.id,
    document: restoredContent,
    reason: "before-replace",
  });
  expect(history).not.toBeNull();
  const selectedHistory = await readHistorySnapshot(
    root,
    currentChapter.id,
    history!.id,
  );
  const restored = await saveChapter({
    projectPath: root,
    chapterId: currentChapter.id,
    document: currentContent,
    restore: {
      snapshotId: history!.id,
      fingerprint: selectedHistory.fingerprint,
    },
  });
  expect(restored.restoredContent).toEqual(restoredContent);
  editorial = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(editorial.anchors[0].status).toBe("orphaned");
  expect(editorial.anchors[0].segments).toEqual([]);
  expect(editorial.anchors[0].lost.at(-1).reason).toBe("history-restore");
  const createdAnnotation = await createEditorialAnnotation({
    projectPath: root,
    chapterId: currentChapter.id,
    from: 1,
    to: 4,
    kind: "comment",
    body: "Synthetic private comment",
    evidence: {
      slice: {
        content: [{ type: "text", text: "old" }],
        openStart: 0,
        openEnd: 0,
      },
      prefix: "",
      suffix: " prose",
    },
  });
  expect(createdAnnotation.generation).toBe(4);
  const createdState = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(createdState.annotations).toHaveLength(2);
  expect(createdState.threads.at(-1).comments[0].body).toBe(
    "Synthetic private comment",
  );
  await replyToEditorialThread({
    projectPath: root,
    threadId: createdAnnotation.thread.id,
    body: "Synthetic reply",
  });
  const commentId = createdAnnotation.thread.comments[0]!.id;
  await updateEditorialComment({
    projectPath: root,
    threadId: createdAnnotation.thread.id,
    commentId,
    body: "",
  });
  let editedState = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(editedState.threads.at(-1).comments[0]).toMatchObject({
    body: "",
    deletedAt: null,
  });
  await updateEditorialComment({
    projectPath: root,
    threadId: createdAnnotation.thread.id,
    commentId,
    body: "Retained deleted evidence",
  });
  await updateEditorialComment({
    projectPath: root,
    threadId: createdAnnotation.thread.id,
    commentId,
    body: null,
  });
  editedState = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(editedState.threads.at(-1).comments[0].body).toBe(
    "Retained deleted evidence",
  );
  expect(editedState.threads.at(-1).comments[0].deletedAt).toBeTruthy();
  await setEditorialThreadResolved({
    projectPath: root,
    threadId: createdAnnotation.thread.id,
    resolved: true,
  });
  await reattachEditorialAnchor({
    projectPath: root,
    anchorId: createdAnnotation.anchor.id,
    chapterId: currentChapter.id,
    from: 1,
    to: 4,
  });
  await tombstoneEditorialAnnotation({
    projectPath: root,
    annotationId: createdAnnotation.annotation.id,
  });
  const finalState = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(finalState.annotations.at(-1).deletedAt).toBeTruthy();
  expect(finalState.anchors.at(-1).deletedAt).toBeTruthy();
  expect(finalState.threads.at(-1).deletedAt).toBeTruthy();
  expect(
    finalState.threads
      .at(-1)
      .comments.map((item: { body: string }) => item.body),
  ).toEqual(["Retained deleted evidence", "Synthetic reply"]);
  const publication = await assembleBook(root);
  const publishedText = JSON.stringify(publication.book);
  expect(publishedText).toContain("old prose");
  expect(publishedText).not.toContain("Synthetic private comment");
  expect(publishedText).not.toContain("Synthetic reply");
  const renamed = await renameChapter({
    projectPath: root,
    chapterId: currentChapter.id,
    title: "Renamed chapter",
  });
  expect(renamed.chapter.title).toBe("Renamed chapter");
  const currentV2 = JSON.parse(
    await readFile(join(root, `manuscript/${currentChapter.id}.json`), "utf8"),
  );
  await createEditorialAnnotation({
    projectPath: root,
    chapterId: currentChapter.id,
    from: 1,
    to: 10,
    kind: "note",
    body: "Split and merge annotation",
    evidence: {
      slice: {
        content: [{ type: "text", text: "old prose" }],
        openStart: 0,
        openEnd: 0,
      },
      prefix: "",
      suffix: "",
    },
  });
  const beforeSplit = await openProject(root, { rebuildSummaries: true });
  const split = await organiseChapter({
    projectPath: root,
    projectId: beforeSplit.project.projectId,
    expectedOrder: beforeSplit.project.manuscript.order,
    operation: "split",
    chapterId: currentChapter.id,
    position: 6,
    expectedContent: currentV2.content,
  });
  let stateAfterStructure = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(stateAfterStructure.anchors.at(-1).segments).toHaveLength(2);
  const merged = await organiseChapter({
    projectPath: root,
    projectId: split.session.project.projectId,
    expectedOrder: split.session.project.manuscript.order,
    operation: "merge",
    chapterIds: [currentChapter.id, split.chapterId],
    confirmed: true,
  });
  stateAfterStructure = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(stateAfterStructure.anchors.at(-1).segments).toHaveLength(2);
  expect(
    stateAfterStructure.anchors
      .at(-1)
      .segments.every(
        (segment: { chapterId: string }) =>
          segment.chapterId === currentChapter.id,
      ),
  ).toBe(true);
  expect(stateAfterStructure.anchors.at(-1).segments[1].from).toBeGreaterThan(
    stateAfterStructure.anchors.at(-1).segments[0].to,
  );
  expect(merged.session.project.manuscript.order).toEqual([currentChapter.id]);
  const deleted = await deleteChapter({
    projectPath: root,
    chapterId: currentChapter.id,
  });
  expect(deleted.session.project.manuscript.order).toEqual([]);
  stateAfterStructure = JSON.parse(await readFile(editorialPath, "utf8"));
  expect(stateAfterStructure.anchors.at(-1).status).toBe("orphaned");
  expect(stateAfterStructure.anchors.at(-1).lost.at(-1).reason).toBe(
    "deleted-chapter",
  );
  const createdChapter = await createChapter({
    projectPath: root,
    title: "After deletion",
  });
  expect(createdChapter.chapter.schemaVersion).toBe(2);
  expect(createdChapter.session.project.manuscript.order).toEqual([
    createdChapter.chapter.id,
  ]);
  const searchable = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Find moon" }] },
    ],
  };
  await saveChapter({
    projectPath: root,
    chapterId: createdChapter.chapter.id,
    document: searchable,
  });
  await expect(
    replaceManuscript({
      projectPath: root,
      options: { query: "moon", matchCase: false, wholeWord: true },
      replacement: "star",
      chapterId: createdChapter.chapter.id,
      expected: [{ id: createdChapter.chapter.id, content: searchable }],
    }),
  ).resolves.toEqual({ matches: 1, chapters: 1 });
  expect(
    (
      await loadChapter({
        projectPath: root,
        chapterId: createdChapter.chapter.id,
      })
    ).content,
  ).toEqual({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Find " },
          { type: "text", text: "star" },
        ],
      },
    ],
  });
  const finalProject = (await openProject(root, { rebuildSummaries: true }))
    .project;
  if (finalProject.schemaVersion !== 3) throw new Error("Expected v3 project");
  expect(finalProject.generation).toBe(19);
});

it("rolls back an interrupted v2 to v3 migration before its commit marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-migrate-recovery-"));
  roots.push(root);
  await cp(
    new URL("../../../docs/examples/editorial-v1/project/", import.meta.url),
    root,
    { recursive: true },
  );
  const projectV3 = JSON.parse(
    await readFile(join(root, "project.json"), "utf8"),
  ) as Record<string, unknown>;
  const oldProject = Object.fromEntries(
    Object.entries(projectV3).filter(
      ([key]) => key !== "generation" && key !== "editorialFile",
    ),
  );
  oldProject.schemaVersion = 2;
  await writeFile(
    join(root, "project.json"),
    `${JSON.stringify(oldProject, null, 2)}\n`,
  );
  const chapterPath = join(
    root,
    "manuscript",
    "00000000-0000-4000-8000-000000000002.json",
  );
  const chapterV2 = JSON.parse(await readFile(chapterPath, "utf8")) as Record<
    string,
    unknown
  >;
  const oldChapter = Object.fromEntries(
    Object.entries(chapterV2).filter(
      ([key]) => key !== "revision" && key !== "review",
    ),
  );
  oldChapter.schemaVersion = 1;
  await writeFile(chapterPath, `${JSON.stringify(oldChapter, null, 2)}\n`);
  await writeFile(
    join(root, "format.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectId: oldProject.projectId,
      bookSchemaVersion: 1,
      chapterSchemaVersion: 1,
    }),
  );
  await rm(join(root, "editorial"), { recursive: true, force: true });
  let publications = 0;
  await expect(
    migrateProjectToEditorialV3(root, {
      operationId: "00000000-0000-4000-8000-000000000021",
      checkpoint: async (point) => {
        if (point === "after-publication" && ++publications === 1)
          throw new Error("interrupted");
      },
    }),
  ).rejects.toThrow();
  await recoverEditorialTransactions(root);
  expect(
    JSON.parse(await readFile(join(root, "project.json"), "utf8"))
      .schemaVersion,
  ).toBe(2);
  expect(JSON.parse(await readFile(chapterPath, "utf8")).schemaVersion).toBe(1);
  expect(
    JSON.parse(await readFile(join(root, "format.json"), "utf8")).schemaVersion,
  ).toBe(1);
});
