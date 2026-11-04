// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { expect, it } from "vitest";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";
import { revisionKey } from "../src/renderer/components/RevisionTracking.js";
import { RevisionStateStep } from "@drelwick/core/revisions";
import {
  readRevisionChapter,
  saveChapter,
  reviewRevisions,
} from "../../../packages/core/src/index.js";
import { decodeEditorialDocument } from "@drelwick/project-model";
import { EditorialHistoryStep } from "@drelwick/core/editorial-history";
import { closeHistory } from "@tiptap/pm/history";
import { editorialProject } from "../../../tests/helpers/editorial-project.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { revisionDocumentHash } from "@drelwick/project-model";
import { normalizeRevision } from "@drelwick/core/revisions";
import {
  documentReducer,
  isDocumentDirty,
  type DocumentState,
} from "../src/renderer/document-state.js";
import { recoverEditorialTransactions } from "../../../packages/core/src/index.js";

it.each(["accept", "reject"] as const)(
  "R05 saves format %s, companion undo and redo with advancing counters",
  async (action) => {
    const f = await editorialProject();
    let editor: Editor | undefined;
    try {
      const projectId = JSON.parse(
        await readFile(join(f.projectPath, "project.json"), "utf8"),
      ).projectId as string;
      const initial = await readRevisionChapter(
        f.projectPath,
        projectId,
        f.chapterId,
      );
      let transactions: {
        before: Record<string, unknown>;
        steps: Record<string, unknown>[];
      }[] = [];
      editor = new Editor({
        extensions: createManuscriptExtensions(projectId, initial.state),
        content: initial.state.review.proposed,
        onUpdate: ({ transaction, appendedTransactions }) =>
          transactions.push({
            before: transaction.before.toJSON(),
            steps: [transaction, ...appendedTransactions].flatMap((tx) =>
              tx.steps.map((step) => step.toJSON() as Record<string, unknown>),
            ),
          }),
      });
      const before = revisionKey.getState(editor.state)!;
      editor.view.dispatch(
        editor.state.tr.step(
          new RevisionStateStep(
            crypto.randomUUID(),
            before,
            { ...before, review: { ...before.review, mode: "track" } },
            { kind: "mode" },
          ),
        ),
      );
      editor.commands.setTextSelection({ from: 1, to: 12 });
      editor.commands.toggleBold();
      const save = async () => {
        await saveChapter({
          projectPath: f.projectPath,
          chapterId: f.chapterId,
          operationId: crypto.randomUUID(),
          document: editor!.getJSON(),
          transactions,
        });
        transactions = [];
        return readRevisionChapter(f.projectPath, projectId, f.chapterId);
      };
      const pending = await save();
      expect(pending.state.review.pending[0]!.kind).toBe("format");
      const reviewed = await reviewRevisions({
        projectPath: f.projectPath,
        projectId,
        chapterId: f.chapterId,
        operationId: crypto.randomUUID(),
        expected: pending.expected,
        ids: pending.state.review.pending.map((g) => g.id),
        action,
      });
      editor.view.dispatch(
        closeHistory(editor.state.tr)
          .replaceWith(
            0,
            editor.state.doc.content.size,
            editor.schema.nodeFromJSON(reviewed.state.review.proposed).content,
          )
          .step(new EditorialHistoryStep(reviewed.historyEventId, "recorded"))
          .step(
            new RevisionStateStep(
              reviewed.historyEventId,
              pending.state,
              reviewed.state,
              { kind: "recorded" },
            ),
          )
          .setMeta("preventUpdate", true),
      );
      editor.commands.undo();
      const undone = await save();
      expect(undone.state).toEqual(pending.state);
      expect(undone.expected.revision).toBe(pending.expected.revision + 2);
      editor.commands.redo();
      const redone = await save();
      expect(redone.state).toEqual(reviewed.state);
      expect(redone.expected.revision).toBe(undone.expected.revision + 1);
    } finally {
      editor?.destroy();
      await f.cleanup();
    }
  },
);

it("R01 persists tracking on a portable empty document presented as an empty editor paragraph", async () => {
  const f = await editorialProject();
  let editor: Editor | undefined;
  try {
    const projectId = JSON.parse(
      await readFile(join(f.projectPath, "project.json"), "utf8"),
    ).projectId as string;
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      document: { type: "doc", content: [] },
    });
    const loaded = await readRevisionChapter(
        f.projectPath,
        projectId,
        f.chapterId,
      ),
      transactions: {
        before: Record<string, unknown>;
        steps: Record<string, unknown>[];
      }[] = [];
    editor = new Editor({
      extensions: createManuscriptExtensions(projectId, loaded.state),
      content: loaded.state.review.proposed,
      onUpdate: ({ transaction, appendedTransactions }) =>
        transactions.push({
          before: transaction.before.toJSON(),
          steps: [transaction, ...appendedTransactions].flatMap((tx) =>
            tx.steps.map((step) => step.toJSON() as Record<string, unknown>),
          ),
        }),
    });
    const before = revisionKey.getState(editor.state)!;
    editor.view.dispatch(
      editor.state.tr.step(
        new RevisionStateStep(
          crypto.randomUUID(),
          before,
          { ...before, review: { ...before.review, mode: "track" } },
          { kind: "mode" },
        ),
      ),
    );
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      operationId: crypto.randomUUID(),
      document: editor.getJSON(),
      transactions,
    });
    expect(
      (await readRevisionChapter(f.projectPath, projectId, f.chapterId)).state
        .review.mode,
    ).toBe("track");
  } finally {
    editor?.destroy();
    await f.cleanup();
  }
});

it.each([false, true])(
  "F06 a revision edit arriving during save A remains dirty after success/failure (failure=%s)",
  async (failure) => {
    const f = await editorialProject();
    let editor: Editor | undefined;
    try {
      const projectId = JSON.parse(
        await readFile(join(f.projectPath, "project.json"), "utf8"),
      ).projectId as string;
      const loaded = await readRevisionChapter(
        f.projectPath,
        projectId,
        f.chapterId,
      );
      let state: DocumentState | null = documentReducer(null, {
        type: "loaded",
        key: "session",
        chapterId: f.chapterId,
        content: loaded.state.review.proposed,
        revisionState: loaded.state,
      });
      editor = new Editor({
        extensions: createManuscriptExtensions(projectId, loaded.state),
        content: loaded.state.review.proposed,
        onUpdate: ({ transaction, appendedTransactions }) => {
          state = documentReducer(state, {
            type: "edited",
            key: "session",
            content: editor!.getJSON(),
            transaction: {
              before: transaction.before.toJSON(),
              steps: [transaction, ...appendedTransactions].flatMap((tx) =>
                tx.steps.map(
                  (step) => step.toJSON() as Record<string, unknown>,
                ),
              ),
            },
          });
        },
      });
      const before = revisionKey.getState(editor.state)!;
      editor.view.dispatch(
        editor.state.tr.step(
          new RevisionStateStep(
            crypto.randomUUID(),
            before,
            { ...before, review: { ...before.review, mode: "track" } },
            { kind: "mode" },
          ),
        ),
      );
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.insertContent("A");
      const captured = structuredClone(state!);
      let release!: () => void, ready!: () => void;
      const paused = new Promise<void>((resolve) => (ready = resolve)),
        resume = new Promise<void>((resolve) => (release = resolve));
      state = documentReducer(state, {
        type: "saving",
        key: "session",
        requestId: 1,
        revision: captured.editorRevision,
      });
      const save = saveChapter({
        projectPath: f.projectPath,
        chapterId: f.chapterId,
        operationId: crypto.randomUUID(),
        document: captured.content,
        transactions: captured.transactions.flatMap((item) =>
          item.transaction ? [item.transaction] : [],
        ),
        checkpoint: async (point) => {
          if (point === "prepared") {
            ready();
            await resume;
            if (failure) throw new Error("Synthetic interrupted A");
          }
        },
      });
      await paused;
      editor.commands.insertContent("B");
      const live = editor.getJSON();
      release();
      if (failure) {
        await expect(save).rejects.toThrow();
        state = documentReducer(state, {
          type: "failed",
          key: "session",
          requestId: 1,
          message: "Synthetic failure",
        });
        await recoverEditorialTransactions(f.projectPath);
      } else {
        await save;
        state = documentReducer(state, {
          type: "saved",
          key: "session",
          requestId: 1,
        });
      }
      expect(isDocumentDirty(state)).toBe(true);
      expect(state!.content).toEqual(live);
      await saveChapter({
        projectPath: f.projectPath,
        chapterId: f.chapterId,
        operationId: crypto.randomUUID(),
        document: state!.content,
        transactions: state!.transactions.flatMap((item) =>
          item.transaction ? [item.transaction] : [],
        ),
      });
      const saved = await readRevisionChapter(
        f.projectPath,
        projectId,
        f.chapterId,
      );
      expect(saved.state.review.proposed).toEqual(live);
      expect(saved.state.review.pending).toHaveLength(1);
    } finally {
      editor?.destroy();
      await f.cleanup();
    }
  },
  20000,
);

it("R01/R02/R05 preserves IME units, graphemes, paste and format commands with explicit collision cancellation", () => {
  const content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "red fox 👩🏽‍💻 e\u0301" }],
      },
    ],
  };
  const initial = {
    content,
    review: {
      schemaVersion: 1 as const,
      mode: "track" as const,
      proposed: content,
      pending: [],
    },
  };
  const editor = new Editor({
    extensions: createManuscriptExtensions(crypto.randomUUID(), initial),
    content,
  });
  const blocked: Event[] = [];
  const capture = (event: Event) => blocked.push(event);
  window.addEventListener("drelwick:revision-combine", capture);
  try {
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(
      editor.state.tr.insertText("に", end).setMeta("composition", 42),
    );
    const first = revisionKey.getState(editor.state)!.review.pending[0]!.id;
    editor.view.dispatch(
      editor.state.tr.insertText("ほん", end + 1).setMeta("composition", 42),
    );
    expect(
      revisionKey.getState(editor.state)!.review.pending.map((g) => g.id),
    ).toEqual([first]);
    const before = editor.getJSON();
    editor.view.dispatch(
      editor.state.tr.insertText("X", end + 1).setMeta("uiEvent", "paste"),
    );
    expect(blocked).toHaveLength(1);
    expect(editor.getJSON()).toEqual(before);
    editor.commands.setTextSelection({ from: 1, to: 4 });
    editor.commands.toggleBold();
    const formatted = revisionKey.getState(editor.state)!;
    expect(formatted.review.pending.some((g) => g.kind === "format")).toBe(
      true,
    );
    editor.commands.undo();
    expect(
      revisionKey
        .getState(editor.state)!
        .review.pending.some((g) => g.kind === "format"),
    ).toBe(false);
    editor.commands.redo();
    expect(
      revisionKey
        .getState(editor.state)!
        .review.pending.some((g) => g.kind === "format"),
    ).toBe(true);
    const unicode = normalizeRevision(
      initial,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "red fox 👩🏽‍🔬 e\u0301" }],
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        created: new Date().toISOString(),
        authorLabel: null,
      },
    );
    expect(unicode.state.review.pending[0]!.before.content).toEqual([
      { type: "text", text: "👩🏽‍💻" },
    ]);
  } finally {
    editor.destroy();
    window.removeEventListener("drelwick:revision-combine", capture);
  }
});

it("R01/R05 saves real editor typing and its native companion markers without silently combining independent actions", async () => {
  const f = await editorialProject();
  let editor: Editor | undefined;
  try {
    const projectId = JSON.parse(
      await readFile(join(f.projectPath, "project.json"), "utf8"),
    ).projectId as string;
    const loaded = await readRevisionChapter(
      f.projectPath,
      projectId,
      f.chapterId,
    );
    let transactions: {
      before: Record<string, unknown>;
      steps: Record<string, unknown>[];
    }[] = [];
    editor = new Editor({
      extensions: createManuscriptExtensions(projectId, loaded.state),
      content: loaded.state.review.proposed,
      onUpdate: ({ transaction, appendedTransactions }) => {
        transactions.push({
          before: transaction.before.toJSON() as Record<string, unknown>,
          steps: [transaction, ...appendedTransactions].flatMap((tx) =>
            tx.steps.map((step) => step.toJSON() as Record<string, unknown>),
          ),
        });
      },
    });
    const before = revisionKey.getState(editor.state)!;
    editor.view.dispatch(
      editor.state.tr.step(
        new RevisionStateStep(
          crypto.randomUUID(),
          before,
          { ...before, review: { ...before.review, mode: "track" } },
          { kind: "mode" },
        ),
      ),
    );
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      document: editor.getJSON(),
      transactions,
      operationId: crypto.randomUUID(),
    });
    transactions = [];
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    for (const character of "quick") editor.commands.insertContent(character);
    expect(editor.getText()).toContain("quick");
    expect(revisionKey.getState(editor.state)!.review.pending).toHaveLength(1);
    let expected = (
      await readRevisionChapter(f.projectPath, projectId, f.chapterId)
    ).state;
    const seen = new Set<string>();
    for (const tx of transactions)
      for (const step of tx.steps)
        if (step["stepType"] === "drelwickRevisionState") {
          expect(
            seen.has(String(step["eventId"])),
            "each native revision marker occurs once",
          ).toBe(false);
          seen.add(String(step["eventId"]));
          const predecessor = step["beforeState"] as typeof expected;
          expect(
            {
              content:
                revisionDocumentHash(predecessor.content) ===
                revisionDocumentHash(expected.content),
              proposed:
                revisionDocumentHash(predecessor.review.proposed) ===
                revisionDocumentHash(expected.review.proposed),
              mode: predecessor.review.mode,
              pending: predecessor.review.pending.length,
            },
            `revision predecessor ${seen.size}`,
          ).toEqual({
            content: true,
            proposed: true,
            mode: expected.review.mode,
            pending: expected.review.pending.length,
          });
          expected = step["afterState"] as typeof expected;
        }
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      document: editor.getJSON(),
      transactions,
      operationId: crypto.randomUUID(),
    });
    expect(
      (await readRevisionChapter(f.projectPath, projectId, f.chapterId)).state
        .review.pending,
    ).toHaveLength(1);
    const source = await readRevisionChapter(
      f.projectPath,
      projectId,
      f.chapterId,
    );
    const reviewed = await reviewRevisions({
      projectPath: f.projectPath,
      projectId,
      chapterId: f.chapterId,
      operationId: crypto.randomUUID(),
      expected: source.expected,
      ids: source.state.review.pending.map((group) => group.id),
      action: "reject",
    });
    transactions = [];
    editor.view.dispatch(
      closeHistory(editor.state.tr)
        .replaceWith(
          0,
          editor.state.doc.content.size,
          editor.schema.nodeFromJSON(reviewed.state.review.proposed).content,
        )
        .step(new EditorialHistoryStep(reviewed.historyEventId, "recorded"))
        .step(
          new RevisionStateStep(
            reviewed.historyEventId,
            source.state,
            reviewed.state,
            { kind: "recorded" },
          ),
        )
        .setMeta("preventUpdate", true),
    );
    expect(transactions).toHaveLength(0);
    editor.commands.undo();
    expect(revisionKey.getState(editor.state)!.review.pending).toHaveLength(1);
    expect(transactions).toHaveLength(1);
    const savedDocument = decodeEditorialDocument(
        (await readRevisionChapter(f.projectPath, projectId, f.chapterId)).state
          .review.proposed,
      ),
      capturedBefore = decodeEditorialDocument(transactions[0]!.before);
    expect({
      size: capturedBefore.content.size,
      steps: transactions[0]!.steps.map((step) => step["stepType"]),
    }).toEqual({
      size: savedDocument.content.size,
      steps: transactions[0]!.steps.map((step) => step["stepType"]),
    });
    expect(savedDocument.eq(capturedBefore)).toBe(true);
    await saveChapter({
      projectPath: f.projectPath,
      chapterId: f.chapterId,
      document: editor.getJSON(),
      transactions,
      operationId: crypto.randomUUID(),
    });
  } finally {
    editor?.destroy();
    await f.cleanup();
  }
});
