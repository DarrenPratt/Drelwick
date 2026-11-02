import { expect, it } from "vitest";
import { Transform } from "@tiptap/pm/transform";
import { readFile } from "node:fs/promises";
import {
  EditorialStateSchema,
  decodeEditorialDocument,
} from "@drelwick/project-model";
import { replayEditorialEdits } from "../src/editorial-editing.js";
import { editorialDocumentHash } from "../src/editorial-bundle.js";

const state = EditorialStateSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        "../../../docs/examples/editorial-v1/project/editorial/state.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
const chapterId = "00000000-0000-4000-8000-000000000002";
const before = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "red fox" }] },
  ],
};
const anchor = {
  ...state.anchors[0]!,
  lost: [],
  status: "attached" as const,
  segments: [
    {
      ...state.anchors[0]!.segments[0]!,
      from: 5,
      to: 8,
      chapterRevision: 1,
      documentHash: editorialDocumentHash(before),
    },
  ],
};
function replay(transform: Transform) {
  return replayEditorialEdits({
    chapterId,
    revision: 2,
    before,
    after: transform.doc.toJSON() as Record<string, unknown>,
    anchors: [anchor],
    transactions: [
      {
        before,
        steps: transform.steps.map(
          (step) => step.toJSON() as Record<string, unknown>,
        ),
      },
    ],
  })[0]!;
}
it("A01-A03 replays actual insertion maps, preserving boundary affinity and original evidence", () => {
  for (const [at, text, from, to] of [
    [5, "quick ", 11, 14],
    [6, "!", 5, 9],
    [8, "!", 5, 8],
  ] as const) {
    const transform = new Transform(decodeEditorialDocument(before)).insert(
      at,
      decodeEditorialDocument(before).type.schema.text(text),
    );
    const result = replay(transform);
    expect(result.segments).toMatchObject([{ from, to, chapterRevision: 2 }]);
    expect(result.original).toEqual(anchor.original);
    expect(result.lost).toEqual([]);
  }
});
it("A04 retains only the exact deleted target slice", () => {
  const result = replay(
    new Transform(decodeEditorialDocument(before)).delete(6, 7),
  );
  expect(result.status).toBe("partial");
  expect(result.lost).toMatchObject([
    {
      evidence: {
        from: 6,
        to: 7,
        slice: { content: [{ type: "text", text: "o" }] },
      },
      reason: "deleted-text",
    },
  ]);
  expect(result.segments.map((segment) => [segment.from, segment.to])).toEqual([
    [5, 7],
  ]);
});
it("A05 identical replacement orphans the original target without text matching", () => {
  const doc = decodeEditorialDocument(before);
  const result = replay(
    new Transform(doc).replaceWith(5, 8, doc.type.schema.text("fox")),
  );
  expect(result.status).toBe("orphaned");
  expect(result.segments).toEqual([]);
  expect(result.lost[0]!.evidence.slice.content).toEqual([
    { type: "text", text: "fox" },
  ]);
});
it("A06 format-only steps preserve ranges and mismatched replay fails without mutating inputs", () => {
  const doc = decodeEditorialDocument(before);
  const result = replay(
    new Transform(doc).addMark(5, 8, doc.type.schema.marks["bold"]!.create()),
  );
  expect(result.status).toBe("attached");
  expect(result.segments[0]).toMatchObject({ from: 5, to: 8 });
  expect(() =>
    replayEditorialEdits({
      chapterId,
      revision: 2,
      before,
      after: { type: "doc" },
      anchors: [anchor],
      transactions: [],
    }),
  ).toThrow("do not match");
  expect(anchor.segments[0]!.chapterRevision).toBe(1);
});

it("refuses stale companion history after reattachment without changing the supplied records", async () => {
  const { captureEditorialReplaySession } =
    await import("../src/editorial-editing.js");
  const { EditorialHistoryStep } = await import("../src/editorial-history.js");
  const session = captureEditorialReplaySession("stale-synthetic");
  const doc = decodeEditorialDocument(before);
  const transform = new Transform(doc).delete(6, 7);
  const marker = new EditorialHistoryStep(
    "00000000-0000-4000-8000-000000000051",
  );
  const after = transform.doc.toJSON() as Record<string, unknown>;
  const mapped = replayEditorialEdits({
    chapterId,
    revision: 2,
    before,
    after,
    anchors: [anchor],
    session,
    transactions: [
      {
        before,
        steps: [
          ...transform.steps.map(
            (step) => step.toJSON() as Record<string, unknown>,
          ),
          marker.toJSON(),
        ],
      },
    ],
  });
  const reattached = mapped.map((item) => ({
    ...item,
    modified: "2099-01-01T00:00:00.000Z",
  }));
  const preserved = structuredClone(reattached);
  expect(() =>
    replayEditorialEdits({
      chapterId,
      revision: 3,
      before: after,
      after: before,
      anchors: reattached,
      session,
      transactions: [
        {
          before: after,
          steps: [
            marker.invert().toJSON() as Record<string, unknown>,
            transform.steps[0]!.invert(doc).toJSON() as Record<string, unknown>,
          ],
        },
      ],
    }),
  ).toThrow("undo event is unavailable");
  expect(reattached).toEqual(preserved);
});
it("A07 overlaps independently retain only their own deleted evidence", () => {
  const doc = decodeEditorialDocument(before);
  const transform = new Transform(doc).delete(4, 7);
  const other = {
    ...anchor,
    id: "00000000-0000-4000-8000-000000000052",
    segments: [{ ...anchor.segments[0]!, from: 1, to: 6 }],
  };
  const result = replayEditorialEdits({
    chapterId,
    revision: 2,
    before,
    after: transform.doc.toJSON() as Record<string, unknown>,
    anchors: [other, anchor],
    transactions: [
      {
        before,
        steps: transform.steps.map(
          (step) => step.toJSON() as Record<string, unknown>,
        ),
      },
    ],
  });
  expect(result[0]!.lost[0]!.evidence.slice.content).toEqual([
    { type: "text", text: " f" },
  ]);
  expect(result[1]!.lost[0]!.evidence.slice.content).toEqual([
    { type: "text", text: "fo" },
  ]);
  expect(result.map((item) => item.id)).toEqual([other.id, anchor.id]);
});

it("preserves the established editor initialization for historical empty documents", () => {
  const empty = { type: "doc", content: [{ type: "paragraph" }] };
  expect(
    replayEditorialEdits({
      chapterId,
      revision: 2,
      before: { type: "doc" },
      after: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "New prose" }] },
        ],
      },
      anchors: [],
      transactions: [
        {
          before: empty,
          steps: [
            {
              stepType: "replace",
              from: 1,
              to: 1,
              slice: { content: [{ type: "text", text: "New prose" }] },
            },
          ],
        },
      ],
    }),
  ).toEqual([]);
});

it("keeps companion events bounded by changed fields while undoing a continuous edit group", async () => {
  const { EditorialHistoryStep } = await import("../src/editorial-history.js");
  const { captureEditorialReplaySession } =
    await import("../src/editorial-editing.js");
  const session = captureEditorialReplaySession("bounded-history");
  let document = before as Record<string, unknown>;
  let anchors = [
    {
      ...anchor,
      original: {
        ...anchor.original,
        from: 1,
        to: 50_001,
        slice: {
          content: [{ type: "text", text: "q".repeat(50_000) }],
          openStart: 0,
          openEnd: 0,
        },
      },
    },
  ];
  const undo: Record<string, unknown>[][] = [];
  for (let index = 0; index < 64; index++) {
    const doc = decodeEditorialDocument(document);
    const transform = new Transform(doc).insert(1, doc.type.schema.text("a"));
    const marker = new EditorialHistoryStep(
      `00000000-0000-4000-8000-${(100 + index).toString(16).padStart(12, "0")}`,
    );
    const after = transform.doc.toJSON() as Record<string, unknown>;
    anchors = replayEditorialEdits({
      chapterId,
      revision: index + 2,
      before: document,
      after,
      anchors,
      session,
      transactions: [
        {
          before: document,
          steps: [
            ...transform.steps.map(
              (step) => step.toJSON() as Record<string, unknown>,
            ),
            marker.toJSON(),
          ],
        },
      ],
    }) as typeof anchors;
    undo.unshift([
      marker.invert().toJSON() as Record<string, unknown>,
      transform.steps[0]!.invert(doc).toJSON() as Record<string, unknown>,
    ]);
    document = after;
  }
  expect(JSON.stringify([...session.events.values()]).length).toBeLessThan(
    100_000,
  );
  const restored = replayEditorialEdits({
    chapterId,
    revision: 66,
    before: document,
    after: before,
    anchors,
    session,
    transactions: [{ before: document, steps: undo.flat() }],
  });
  expect(restored[0]!.segments[0]).toMatchObject({
    from: 5,
    to: 8,
    chapterRevision: 66,
  });
  expect(restored[0]!.original.slice.content[0]).toEqual({
    type: "text",
    text: "q".repeat(50_000),
  });
});
