import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  EditorialStateSchema,
  ChapterFileV2Schema,
  ProjectConfigV3Schema,
  ProjectFormatV2Schema,
  EditorialTransactionSchema,
  EditorialDraftSchema,
  createEmptyEditorialState,
  migrateChapterV1ToEditorialV2,
  migrateProjectV2ToEditorialV3,
} from "../src/index.js";

const root = new URL("../../../docs/examples/editorial-v1/", import.meta.url);
const read = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));

describe("runtime editorial model", () => {
  it("accepts the approved synthetic project, chapter and editorial state", async () => {
    expect(
      ProjectConfigV3Schema.safeParse(await read("project/project.json"))
        .success,
    ).toBe(true);
    expect(
      ProjectFormatV2Schema.safeParse(await read("project/format.json"))
        .success,
    ).toBe(true);
    const futureChapter = (await read(
      "project/manuscript/00000000-0000-4000-8000-000000000002.json",
    )) as Record<string, unknown>;
    const chapterReview = futureChapter.review as Record<string, unknown>;
    const chapter = {
      ...futureChapter,
      content: chapterReview.proposed,
      review: { ...chapterReview, mode: "off", pending: [] },
    };
    expect(ChapterFileV2Schema.safeParse(chapter).success).toBe(true);
    expect(ChapterFileV2Schema.safeParse(futureChapter).success).toBe(false);
    expect(
      EditorialStateSchema.safeParse(await read("project/editorial/state.json"))
        .success,
    ).toBe(true);
  });
  it("rejects unknown fields, dangling references and malformed lifecycle states", async () => {
    const state = (await read("project/editorial/state.json")) as {
      schemaVersion: number;
      anchors: Array<Record<string, unknown>>;
      annotations: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    expect(
      EditorialStateSchema.safeParse({ ...state, privateUnknown: true })
        .success,
    ).toBe(false);
    expect(
      EditorialStateSchema.safeParse({
        ...state,
        annotations: [
          {
            ...state.annotations[0],
            anchorId: "00000000-0000-4000-8000-000000000099",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      EditorialStateSchema.safeParse({
        ...state,
        anchors: [{ ...state.anchors[0], status: "orphaned" }],
      }).success,
    ).toBe(false);
    expect(
      EditorialStateSchema.safeParse({ ...state, schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it("upgrades a v2 envelope and chapter without changing semantic content", async () => {
    const target = (await read("project/project.json")) as Record<
      string,
      unknown
    >;
    const legacy = Object.fromEntries(
      Object.entries(target).filter(
        ([key]) => key !== "generation" && key !== "editorialFile",
      ),
    );
    const current = { ...legacy, schemaVersion: 2 };
    const project = migrateProjectV2ToEditorialV3(current);
    expect(project.schemaVersion).toBe(3);
    const v3Chapter = await read(
      "project/manuscript/00000000-0000-4000-8000-000000000002.json",
    );
    const legacyChapter = Object.fromEntries(
      Object.entries(v3Chapter as Record<string, unknown>).filter(
        ([key]) => key !== "revision" && key !== "review",
      ),
    );
    const v1Chapter = { ...legacyChapter, schemaVersion: 1 };
    const chapter = migrateChapterV1ToEditorialV2(v1Chapter);
    expect(chapter.content).toEqual(chapter.review.proposed);
    expect(chapter.review.pending).toEqual([]);
    expect(createEmptyEditorialState(project.projectId).generation).toBe(1);
  });

  it("blocks unsupported project extension fields instead of stripping them", async () => {
    const target = (await read("project/project.json")) as Record<
      string,
      unknown
    >;
    expect(() =>
      migrateProjectV2ToEditorialV3({
        ...target,
        schemaVersion: 2,
        generation: undefined,
        editorialFile: undefined,
        extension: { unknown: true },
      }),
    ).toThrow("Unsupported project envelope fields");
  });

  it("validates sorted transaction images, generation steps and drafts", () => {
    const digest = "a".repeat(64);
    const tx = {
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000000010",
      projectId: "00000000-0000-4000-8000-000000000001",
      kind: "annotation",
      created: "2026-10-27T12:00:00.000Z",
      owner: {
        host: "synthetic",
        processId: 1,
        processStarted: "2026-10-27T12:00:00.000Z",
      },
      phase: "prepared",
      expectedGeneration: 7,
      nextGeneration: 8,
      files: [
        {
          path: "editorial/state.json",
          before: { size: 1, sha256: digest },
          after: { size: 2, sha256: digest },
        },
      ],
      decisions: [],
    };
    expect(EditorialTransactionSchema.safeParse(tx).success).toBe(true);
    expect(
      EditorialTransactionSchema.safeParse({ ...tx, nextGeneration: 9 })
        .success,
    ).toBe(false);
    expect(
      EditorialTransactionSchema.safeParse({
        ...tx,
        files: [{ ...tx.files[0], path: "../project.json" }],
      }).success,
    ).toBe(false);
    expect(
      EditorialDraftSchema.safeParse({
        schemaVersion: 1,
        id: tx.id,
        projectId: tx.projectId,
        created: tx.created,
        baseGeneration: 7,
        editorGeneration: 2,
        baseInventoryHash: digest,
        files: [{ path: "editorial/state.json", size: 1, sha256: digest }],
      }).success,
    ).toBe(true);
  });
});

it("enforces canonical timestamps, scalar limits, context graphemes and one-to-one ownership", async () => {
  const {
    EditorialCommentSchema,
    EditorialEvidenceSchema,
    EditorialThreadSchema,
  } = await import("../src/index.js");
  const state = EditorialStateSchema.parse(
    await read("project/editorial/state.json"),
  );
  const thread = state.threads[0]!;
  const comment = thread.comments[0]!;
  for (const created of [
    "2026-02-30T12:00:00.000Z",
    "2026-10-27T12:00:00Z",
    "2026-10-27T12:00:00.000+00:00",
  ])
    expect(
      EditorialCommentSchema.safeParse({ ...comment, created }).success,
    ).toBe(false);
  expect(
    EditorialCommentSchema.safeParse({
      ...comment,
      deletedAt: "2000-01-01T00:00:00.000Z",
    }).success,
  ).toBe(false);
  expect(
    EditorialCommentSchema.safeParse({
      ...comment,
      body: "\ud83d\ude00".repeat(100_000),
    }).success,
  ).toBe(true);
  expect(
    EditorialCommentSchema.safeParse({ ...comment, body: "x".repeat(100_001) })
      .success,
  ).toBe(false);
  for (const body of ["\ud800", "\udc00", "a\0b"])
    expect(EditorialCommentSchema.safeParse({ ...comment, body }).success).toBe(
      false,
    );
  expect(
    EditorialEvidenceSchema.safeParse({
      ...state.anchors[0]!.original,
      prefix: "e\u0301".repeat(32),
    }).success,
  ).toBe(true);
  expect(
    EditorialEvidenceSchema.safeParse({
      ...state.anchors[0]!.original,
      prefix: "x".repeat(33),
    }).success,
  ).toBe(false);
  expect(
    EditorialEvidenceSchema.safeParse({
      ...state.anchors[0]!.original,
      slice: {
        content: [{ type: "text", text: "valid", unknown: true }],
        openStart: 0,
        openEnd: 0,
      },
    }).success,
  ).toBe(false);
  expect(
    EditorialEvidenceSchema.safeParse({
      ...state.anchors[0]!.original,
      slice: {
        content: [{ type: "text", text: "valid" }],
        openStart: 1,
        openEnd: 0,
      },
    }).success,
  ).toBe(false);
  expect(
    EditorialStateSchema.safeParse({
      ...state,
      annotations: [
        ...state.annotations,
        {
          ...state.annotations[0]!,
          id: "00000000-0000-4000-8000-000000000098",
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    EditorialThreadSchema.safeParse({
      ...thread,
      comments: [
        { ...comment, id: "00000000-0000-4000-8000-000000000099" },
        comment,
      ],
    }).success,
  ).toBe(false);
});
it("strict editorial JSON preserves ambiguous and invalid source bytes by rejecting them", async () => {
  const { parseEditorialJson } = await import("../src/index.js");
  for (const text of [
    '{"id":1,"id":2}',
    '{"x":{"id":1,"id":2}}',
    "\ufeff{}",
    '{"x":"\\ud800"}',
    '{"x":"\\u0000"}',
  ])
    expect(() => parseEditorialJson(text)).toThrow();
  expect(() =>
    parseEditorialJson(
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    ),
  ).toThrow();
});
