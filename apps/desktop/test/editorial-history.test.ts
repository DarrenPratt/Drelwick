// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { EditorialStateSchema } from "@drelwick/project-model";
import { createManuscriptExtensions } from "../src/renderer/components/manuscript-extensions.js";
import {
  replayEditorialEdits,
  captureEditorialReplaySession,
  type EditorialEditorTransaction,
} from "../../../packages/core/src/editorial-editing.js";
import { editorialDocumentHash } from "../../../packages/core/src/editorial-bundle.js";
import { EditorialHistoryStep } from "@drelwick/core/editorial-history";
import { closeHistory } from "@tiptap/pm/history";

it("captures metadata-only undo and redo exactly once without recording an already saved annotation twice", () => {
  const updates: Record<string, unknown>[][] = [];
  const editor = new Editor({
    extensions: createManuscriptExtensions(),
    content: "<p>red fox</p>",
    onUpdate: ({ transaction, appendedTransactions }) => {
      updates.push(
        [transaction, ...appendedTransactions].flatMap((item) =>
          item.steps.map((step) => step.toJSON() as Record<string, unknown>),
        ),
      );
    },
  });
  try {
    editor.view.dispatch(
      closeHistory(editor.state.tr).step(
        new EditorialHistoryStep(
          "00000000-0000-4000-8000-000000000071",
          "recorded",
        ),
      ),
    );
    expect(updates).toEqual([]);
    editor.commands.undo();
    expect(updates).toEqual([[expect.objectContaining({ direction: "undo" })]]);
    editor.commands.redo();
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual([
      expect.objectContaining({ direction: "redo" }),
    ]);
  } finally {
    editor.destroy();
  }
});

it("A04/A06 real ProseMirror undo and redo restore exact lost evidence through saved generations", async () => {
  const initial = EditorialStateSchema.parse(
    JSON.parse(
      await readFile(
        resolve(
          process.cwd(),
          "docs/examples/editorial-v1/project/editorial/state.json",
        ),
        "utf8",
      ),
    ),
  );
  let transactions: EditorialEditorTransaction[] = [];
  const editor = new Editor({
    extensions: createManuscriptExtensions(),
    content: "<p>red fox</p>",
    onUpdate: ({ transaction, appendedTransactions }) => {
      transactions.push({
        before: transaction.before.toJSON() as Record<string, unknown>,
        steps: [transaction, ...appendedTransactions].flatMap((item) =>
          item.steps.map((step) => step.toJSON() as Record<string, unknown>),
        ),
      });
    },
  });
  let content = editor.getJSON();
  let revision = 1;
  const chapterId = "00000000-0000-4000-8000-000000000002";
  let anchors = [
    {
      ...initial.anchors[0]!,
      lost: [],
      status: "attached" as const,
      segments: [
        {
          ...initial.anchors[0]!.segments[0]!,
          from: 5,
          to: 8,
          chapterRevision: revision,
          documentHash: editorialDocumentHash(content),
        },
      ],
    },
  ];
  const session = captureEditorialReplaySession("synthetic-test");
  const persist = () => {
    anchors = replayEditorialEdits({
      chapterId,
      revision: ++revision,
      before: content,
      after: editor.getJSON(),
      anchors,
      transactions,
      session,
    }) as typeof anchors;
    content = editor.getJSON();
    transactions = [];
  };
  try {
    editor.commands.deleteRange({ from: 6, to: 7 });
    persist();
    expect(anchors[0]!.status).toBe("partial");
    expect(anchors[0]!.lost).toMatchObject([
      { evidence: { slice: { content: [{ type: "text", text: "o" }] } } },
    ]);
    editor.commands.undo();
    persist();
    expect(editor.getText()).toBe("red fox");
    expect(anchors[0]!.status).toBe("attached");
    expect(anchors[0]!.lost).toEqual([]);
    expect(anchors[0]!.segments[0]).toMatchObject({
      from: 5,
      to: 8,
      chapterRevision: 3,
    });
    editor.commands.redo();
    persist();
    expect(editor.getText()).toBe("red fx");
    expect(anchors[0]!.status).toBe("partial");
    expect(anchors[0]!.lost).toHaveLength(1);
    editor.commands.undo();
    persist();
    editor.commands.setTextSelection({ from: 5, to: 8 });
    editor.commands.toggleBold();
    persist();
    expect(anchors[0]!.status).toBe("attached");
    editor.commands.undo();
    persist();
    expect(anchors[0]!.segments[0]).toMatchObject({ from: 5, to: 8 });
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "red fox" }] },
      ],
    });
    editor.commands.setTextSelection({ from: 5, to: 8 });
    editor.commands.insertContent("fox");
    persist();
    expect(anchors[0]!.status).toBe("orphaned");
    editor.commands.undo();
    persist();
    expect(anchors[0]!.status).toBe("attached");
  } finally {
    editor.destroy();
  }
});
