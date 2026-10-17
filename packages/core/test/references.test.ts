import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  unlink,
  symlink,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import {
  executeReferenceOperation,
  REFERENCE_DIRECTORIES,
  openProject,
  openProjectForEditing,
  createProjectArchive,
  restoreProjectArchive,
  inspectReferenceBackup,
  assembleBook,
  generateEpub,
  generateDocx,
  type ReferenceWriteOptions,
} from "../src/index.js";
import type {
  ReferenceInput,
  ReferenceRequest,
  ReferenceSaved,
  ReferenceResponse,
  ReferenceCandidate,
} from "@drelwick/shared";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((c) => c.cleanup()));
});
async function fixture(
  name: "public-example" | "minimal-book" = "public-example",
) {
  const copy = await copyFixture(name);
  copies.push(copy);
  const session = await openProject(copy.projectPath);
  return {
    root: copy.projectPath,
    projectId: session.project.projectId,
    chapterId: session.project.manuscript.order[0]!,
  };
}
const contents: ReferenceInput[] = [
  {
    kind: "character",
    name: "Mira",
    aliases: ["Navigator"],
    tags: [],
    links: [],
  },
  {
    kind: "location",
    name: "Harbour",
    description: "Private inlet",
    tags: [],
    links: [],
  },
  {
    kind: "canon",
    title: "Tides",
    category: "other",
    statement: "Private rule",
    tags: [],
    links: [],
  },
  {
    kind: "timeline",
    title: "Departure",
    date: "Second tide",
    sequence: -1,
    tags: [],
    links: [],
  },
  {
    kind: "note",
    title: "Research",
    body: "PRIVATE_REFERENCE_CANARY",
    source: "Offline notebook",
    tags: [],
    links: [],
  },
];
type Fixture = Awaited<ReturnType<typeof fixture>>;
const run = (
  f: Fixture,
  request: Omit<ReferenceRequest, "projectId">,
  options?: ReferenceWriteOptions,
) =>
  executeReferenceOperation(
    {
      projectPath: f.root,
      request: { ...request, projectId: f.projectId } as ReferenceRequest,
    },
    options,
  );
function saved(result: ReferenceResponse): ReferenceSaved {
  if (result.type !== "record") throw new Error("Expected record");
  return result.value;
}
const create = async (f: Fixture, content = contents[4]!) =>
  saved(
    await run(f, { operation: "create", content, generation: 1 } as Omit<
      ReferenceRequest,
      "projectId"
    >),
  );
const input = (s: ReferenceSaved): ReferenceInput => {
  return Object.fromEntries(
    Object.entries(s.record).filter(
      ([key]) =>
        ![
          "schemaVersion",
          "id",
          "projectId",
          "created",
          "modified",
          "revision",
          "deletedAt",
        ].includes(key),
    ),
  ) as ReferenceInput;
};
const mutation = (
  s: ReferenceSaved,
  operation: "update" | "delete" | "restore",
) => ({
  operation,
  kind: s.record.kind,
  id: s.record.id,
  expectedRevision: s.record.revision,
  expectedFingerprint: s.fingerprint,
  generation: 2,
  ...(operation === "update" ? { content: input(s) } : {}),
});
const path = (f: Fixture, s: ReferenceSaved) =>
  join(
    f.root,
    "reference",
    REFERENCE_DIRECTORIES[s.record.kind],
    `${s.record.id}.json`,
  );
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function recoveries(f: Fixture): Promise<ReferenceCandidate[]> {
  const r = await run(f, { operation: "recovery-list" });
  if (r.type !== "recovery") throw new Error("Expected recovery");
  return r.candidates;
}
const key = (c: ReferenceCandidate) => ({
  source: c.source,
  kind: c.kind,
  recordId: c.recordId,
  candidateId: c.candidateId,
});

it("round-trips all five types, snapshots updates and retains soft deletion across reopen", async () => {
  const f = await fixture();
  const manuscript = await readFile(join(f.root, "project.json"));
  for (const content of contents) {
    let s = await create(f, content);
    expect(JSON.parse((await readFile(path(f, s))).toString())).toEqual(
      s.record,
    );
    s = saved(await run(f, mutation(s, "update")));
    expect(s.record.revision).toBe(2);
    s = saved(await run(f, mutation(s, "delete")));
    expect(s.record.deletedAt).not.toBeNull();
    expect(
      await run(f, {
        operation: "read",
        kind: s.record.kind,
        id: s.record.id,
      } as Omit<ReferenceRequest, "projectId">),
    ).toMatchObject({ value: s });
    s = saved(await run(f, mutation(s, "restore")));
    expect(s.record.deletedAt).toBeNull();
    expect(s.record.revision).toBe(4);
    expect(
      await readdir(join(f.root, "reference", "history", s.record.id)),
    ).toHaveLength(3);
  }
  expect(await run(f, { operation: "list" })).toMatchObject({
    type: "list",
    readOnly: false,
    records: expect.any(Array),
  });
  expect(
    (await recoveries(f)).every(
      (r) => r.status === "committed" || r.status === "historical",
    ),
  ).toBe(true);
  expect(await readFile(join(f.root, "project.json"))).toEqual(manuscript);
}, 15000);
it("serializes concurrent saves and rejects stale/external updates", async () => {
  const f = await fixture(),
    s = await create(f);
  const results = await Promise.allSettled([
    run(f, mutation(s, "update")),
    run(f, mutation(s, "update")),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "REFERENCE_STALE" },
  });
  const current = saved(
    await run(f, {
      operation: "read",
      kind: s.record.kind,
      id: s.record.id,
    } as Omit<ReferenceRequest, "projectId">),
  );
  await writeFile(path(f, s), JSON.stringify(current.record));
  await expect(run(f, mutation(current, "update"))).rejects.toMatchObject({
    code: "REFERENCE_STALE",
  });
});
it.each(
  [
    "before-draft",
    "after-draft",
    "after-snapshot",
    "after-temporary",
    "before-commit",
  ].flatMap((point) =>
    ["canon", "note", "timeline"].map((kind) => ({ point, kind })),
  ),
)(
  "preserves previous $kind bytes at $point and keeps recoverable work",
  async ({ point, kind }) => {
    const f = await fixture(),
      s = await create(
        f,
        contents.find((content) => content.kind === kind)!,
      ),
      before = await readFile(path(f, s));
    await expect(
      run(f, mutation(s, "update"), {
        checkpoint: async (p) => {
          if (p === point) throw new Error("PRIVATE_REFERENCE_CANARY");
        },
      }),
    ).rejects.not.toThrow("PRIVATE_REFERENCE_CANARY");
    expect(await readFile(path(f, s))).toEqual(before);
    if (point !== "before-draft")
      expect((await recoveries(f)).some((c) => c.status === "pending")).toBe(
        true,
      );
  },
);
it("reconciles an acknowledgement failure after commit and respects cancellation before commit", async () => {
  const f = await fixture(),
    s = await create(f);
  const result = await run(f, mutation(s, "update"), {
    checkpoint: async (p) => {
      if (p === "after-commit") throw new Error("fault");
    },
  });
  expect(result.warning).toBeDefined();
  expect(saved(result).record.revision).toBe(2);
  const controller = new AbortController();
  await expect(
    run(f, mutation(saved(result), "update"), {
      signal: controller.signal,
      checkpoint: async (p) => {
        if (p === "before-commit") controller.abort();
      },
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_CANCELLED" });
  expect(JSON.parse((await readFile(path(f, s))).toString()).revision).toBe(2);
});
it("resolves backlinks, preserves dangling/deleted targets and rejects new missing targets", async () => {
  const f = await fixture(),
    character = await create(f, contents[0]);
  const content = {
    ...contents[4]!,
    links: [
      { target: { kind: "character" as const, id: character.record.id } },
      { target: { kind: "chapter" as const, id: f.chapterId } },
    ],
  };
  const note = await create(f, content);
  const target = { kind: character.record.kind, id: character.record.id };
  expect(
    await run(f, { operation: "links", target } as Omit<
      ReferenceRequest,
      "projectId"
    >),
  ).toMatchObject({
    incoming: [{ sourceId: note.record.id, status: "resolved" }],
  });
  const deleted = saved(await run(f, mutation(character, "delete")));
  expect(
    await run(f, { operation: "links", target } as Omit<
      ReferenceRequest,
      "projectId"
    >),
  ).toMatchObject({ incoming: [{ status: "deleted" }] });
  await expect(create(f, content)).rejects.toMatchObject({
    code: "REFERENCE_TARGET_INVALID",
  });
  await run(f, mutation(note, "update"));
  await run(f, mutation(deleted, "restore"));
  await unlink(path(f, character));
  expect(
    await run(f, { operation: "links", target } as Omit<
      ReferenceRequest,
      "projectId"
    >),
  ).toMatchObject({ incoming: [{ status: "missing" }] });
  await expect(create(f, content)).rejects.toMatchObject({
    code: "REFERENCE_RECOVERY_REQUIRED",
  });
});
it.each([
  Buffer.from('{"schemaVersion":1,'),
  Buffer.from([0xc3, 0x28]),
  Buffer.from("\ufeff{}"),
  Buffer.from('{"schemaVersion":1,"schemaVersion":1}'),
])(
  "keeps malformed bytes opaque and blocks writes without blocking manuscript assembly %#",
  async (bytes) => {
    const f = await fixture(),
      s = await create(f);
    await writeFile(path(f, s), bytes);
    expect(await run(f, { operation: "list" })).toMatchObject({
      readOnly: true,
    });
    await expect(create(f)).rejects.toMatchObject({
      code: "REFERENCE_READ_ONLY",
    });
    expect(await readFile(path(f, s))).toEqual(bytes);
    expect((await assembleBook(f.root)).book.chapters.length).toBeGreaterThan(
      0,
    );
  },
);
it("rejects future records, unknown fields and duplicate IDs without choosing one", async () => {
  const f = await fixture(),
    s = await create(f);
  await writeFile(
    path(f, s),
    JSON.stringify({ ...s.record, schemaVersion: 2 }),
  );
  expect(await run(f, { operation: "list" })).toMatchObject({
    diagnostics: [{ code: "REFERENCE_UNSUPPORTED" }],
  });
  await writeFile(
    path(f, s),
    JSON.stringify({ ...s.record, future: "private" }),
  );
  expect(await run(f, { operation: "list" })).toMatchObject({
    diagnostics: [{ code: "REFERENCE_UNSUPPORTED" }],
  });
  await writeFile(path(f, s), JSON.stringify(s.record));
  await mkdir(join(f.root, "reference", "locations"), { recursive: true });
  await writeFile(
    join(f.root, "reference", "locations", `${s.record.id}.json`),
    JSON.stringify({
      ...s.record,
      kind: "location",
      name: "Duplicate",
      title: undefined,
      body: undefined,
      source: undefined,
    }),
  );
  expect(await run(f, { operation: "list" })).toMatchObject({
    records: [],
    readOnly: true,
  });
});
it("recovers corrupt/missing records while preserving opaque bytes and refuses changed candidates", async () => {
  const f = await fixture(),
    s = await create(f);
  const c = (await recoveries(f))[0]!;
  const corrupt = Buffer.from('{"private":"truncated');
  await writeFile(path(f, s), corrupt);
  const recovered = saved(
    await run(f, {
      operation: "recovery-apply",
      candidate: key(c),
      fingerprint: c.fingerprint,
      expectedFingerprint: hash(corrupt),
      confirmed: true,
    } as Omit<ReferenceRequest, "projectId">),
  );
  expect(recovered.record.revision).toBe(2);
  const preserved = join(f.root, "reference", "preserved", s.record.id);
  expect(
    await readFile(join(preserved, (await readdir(preserved))[0]!)),
  ).toEqual(corrupt);
  await unlink(path(f, s));
  const again = saved(
    await run(f, {
      operation: "recovery-apply",
      candidate: key(c),
      fingerprint: c.fingerprint,
      expectedFingerprint: null,
      confirmed: true,
    } as Omit<ReferenceRequest, "projectId">),
  );
  expect(again.record.id).toBe(s.record.id);
  await expect(
    run(f, {
      operation: "recovery-read",
      candidate: key(c),
      fingerprint: "0".repeat(64),
    } as Omit<ReferenceRequest, "projectId">),
  ).rejects.toMatchObject({ code: "REFERENCE_STALE" });
});
it("blocks traversal, symlink escapes and foreign project access without leaking content", async () => {
  const f = await fixture();
  await expect(
    run(f, { operation: "read", kind: "note", id: "../book" } as Omit<
      ReferenceRequest,
      "projectId"
    >),
  ).rejects.toMatchObject({ code: "REFERENCE_INPUT_INVALID" });
  await expect(
    executeReferenceOperation({
      projectPath: f.root,
      request: {
        operation: "list",
        projectId: "00000000-0000-4000-8000-000000000099",
      },
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_PROJECT_INVALID" });
  const outside = await fixture();
  await mkdir(join(f.root, "reference"), { recursive: true });
  await symlink(
    outside.root,
    join(f.root, "reference", "notes"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(await run(f, { operation: "list" })).toMatchObject({ readOnly: true });
  await expect(create(f)).rejects.toMatchObject({
    code: "REFERENCE_READ_ONLY",
  });
  expect(await readdir(outside.root)).not.toContain("recovery");
  await rm(join(f.root, "reference", "notes"));
});
it("preserves legacy references through migration and includes all auxiliary data in history-free backup/restore", async () => {
  const f = await fixture("minimal-book");
  expect(await run(f, { operation: "list" })).toMatchObject({
    records: [],
    readOnly: false,
  });
  await mkdir(join(f.root, "reference"), { recursive: true });
  await writeFile(join(f.root, "reference", "legacy.txt"), "old private bytes");
  const chapterBefore = await readFile(
    join(f.root, "manuscript", `${f.chapterId}.json`),
  );
  await openProjectForEditing(f.root);
  const s = await create(f);
  const deleted = saved(await run(f, mutation(s, "delete")));
  await mkdir(join(f.root, "reference", "preserved", s.record.id), {
    recursive: true,
  });
  await writeFile(
    join(
      f.root,
      "reference",
      "preserved",
      s.record.id,
      "00000000-0000-4000-8000-000000000077.bin",
    ),
    "opaque",
  );
  const archivePath = join(dirname(f.root), "reference.zip");
  await createProjectArchive({
    projectPath: f.root,
    archivePath,
    includeHistory: false,
  });
  const parent = join(dirname(f.root), "restored");
  await mkdir(parent);
  const restored = await restoreProjectArchive({
    archivePath,
    destinationParent: parent,
  });
  const reopened = { ...f, root: restored.projectPath };
  expect(
    await run(reopened, {
      operation: "read",
      kind: s.record.kind,
      id: s.record.id,
    } as Omit<ReferenceRequest, "projectId">),
  ).toMatchObject({ value: deleted });
  expect(
    await readFile(join(reopened.root, "reference", "legacy.txt"), "utf8"),
  ).toBe("old private bytes");
  expect(
    await readdir(join(reopened.root, "reference", "history", s.record.id)),
  ).toHaveLength(1);
  expect(
    await readdir(join(reopened.root, "reference", "recovery", s.record.id)),
  ).toHaveLength(2);
  expect(
    await readFile(join(f.root, "manuscript", `${f.chapterId}.json`)),
  ).toEqual(chapterBefore);
});
it("handles partial temporary writes and rechecks staging bytes before atomic replacement", async () => {
  const f = await fixture(),
    s = await create(f),
    before = await readFile(path(f, s));
  await expect(
    run(f, mutation(s, "update"), {
      writeTemporary: async (temporary, bytes) => {
        await writeFile(temporary, bytes.subarray(0, 20), { flag: "wx" });
        throw new Error("private OS payload");
      },
    }),
  ).rejects.not.toThrow("private OS payload");
  expect(await readFile(path(f, s))).toEqual(before);
  expect(
    (await recoveries(f)).some(
      (c) => c.status === "invalid" && c.source === "temporary",
    ),
  ).toBe(true);
  for (const candidate of await recoveries(f)) {
    if (candidate.status === "pending" || candidate.status === "invalid")
      await run(f, {
        operation: "recovery-discard",
        candidate: key(candidate),
        fingerprint: candidate.fingerprint,
        confirmed: true,
      } as Omit<ReferenceRequest, "projectId">);
  }
  await expect(
    run(f, mutation(s, "update"), {
      checkpoint: async (point) => {
        if (point === "before-commit") {
          const directory = dirname(path(f, s));
          const temporary = (await readdir(directory)).find((name) =>
            name.endsWith(".tmp"),
          )!;
          await writeFile(join(directory, temporary), "truncated");
        }
      },
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_STALE" });
  expect(await readFile(path(f, s))).toEqual(before);
});
it("reopens after process termination, reclaims only its dead local owner lock and exposes drafts", async () => {
  const f = await fixture(),
    s = await create(f),
    before = await readFile(path(f, s));
  const program = `const { executeReferenceOperation } = await import(process.argv[1]); await executeReferenceOperation(JSON.parse(process.argv[2]), { checkpoint: async point => { if (point === 'after-temporary') process.exit(23); } });`;
  expect(() =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        program,
        new URL("../dist/index.js", import.meta.url).href,
        JSON.stringify({
          projectPath: f.root,
          request: { ...mutation(s, "update"), projectId: f.projectId },
        }),
      ],
      { stdio: "pipe" },
    ),
  ).toThrow();
  expect(await readFile(path(f, s))).toEqual(before);
  expect(
    (await recoveries(f)).some(
      (c) => c.source === "draft" && c.status === "pending",
    ),
  ).toBe(true);
  expect(await readdir(f.root)).not.toContain(".chapter-create.lock");
  await mkdir(join(f.root, ".chapter-create.lock"));
  await expect(run(f, { operation: "list" })).rejects.toMatchObject({
    code: "PROJECT_BUSY",
  });
});
it("requires review of excluded legacy reference files and never archives unresolved temporaries", async () => {
  const f = await fixture();
  await create(f);
  await writeFile(join(f.root, "reference", "secrets.json"), "legacy bytes");
  const archivePath = join(dirname(f.root), "review.zip");
  const review = await inspectReferenceBackup(f.root);
  expect(review.excludedPaths).toEqual(["reference/secrets.json"]);
  await expect(
    createProjectArchive({ projectPath: f.root, archivePath }),
  ).rejects.toMatchObject({ code: "REFERENCE_BACKUP_REVIEW_REQUIRED" });
  await createProjectArchive({
    projectPath: f.root,
    archivePath,
    approvedReferenceExclusions: review.excludedPaths,
  });
  await writeFile(
    join(f.root, "reference", "unrecognized.tmp"),
    "private recovery",
  );
  await expect(
    createProjectArchive({
      projectPath: f.root,
      archivePath,
      approvedReferenceExclusions: review.excludedPaths,
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_RECOVERY_REQUIRED" });
});
it("excludes every reference and recovery source from semantic assembly, EPUB and DOCX", async () => {
  const f = await fixture();
  const before = await assembleBook(f.root);
  for (const content of contents) {
    const s = await create(f, {
      ...content,
      tags: ["PRIVATE_REFERENCE_CANARY"],
    });
    await run(f, mutation(s, "delete"));
  }
  const book = await assembleBook(f.root);
  expect(book.book).toEqual(before.book);
  for (const bytes of [generateEpub(book).bytes, generateDocx(book).bytes]) {
    const files = unzipSync(bytes);
    expect(Object.keys(files).every((p) => !p.startsWith("reference/"))).toBe(
      true,
    );
    expect(
      Object.values(files)
        .map((b) => Buffer.from(b).toString("utf8"))
        .join("\n"),
    ).not.toContain("PRIVATE_REFERENCE_CANARY");
  }
});

it.each([
  "character",
  "technology",
  "location",
  "history",
  "relationship",
  "terminology",
  "other",
] as const)(
  "persists canon category %s through CRUD and reopen",
  async (category) => {
    const f = await fixture();
    let s = await create(f, {
      kind: "canon",
      title: "Rule",
      category,
      statement: "  e\u0301 港 🌊\n",
      notes: "<script>inert</script>",
      tags: ["a,b\nc"],
      links: [],
    });
    await openProject(f.root);
    expect(
      saved(
        await run(f, {
          operation: "read",
          kind: "canon",
          id: s.record.id,
        } as Omit<ReferenceRequest, "projectId">),
      ),
    ).toEqual(s);
    s = saved(
      await run(f, {
        ...mutation(s, "update"),
        content: { ...input(s), title: "Updated rule" },
      } as Omit<ReferenceRequest, "projectId">),
    );
    expect(s.record).toMatchObject({
      category,
      title: "Updated rule",
      revision: 2,
    });
    s = saved(await run(f, mutation(s, "delete")));
    await openProject(f.root);
    expect(s.record.deletedAt).not.toBeNull();
    expect(JSON.parse(await readFile(path(f, s), "utf8"))).toEqual(s.record);
  },
);
it.each(["Organisation", "Technology", "General research"])(
  "round-trips %s as plain-text versioned notes",
  async (title) => {
    const f = await fixture();
    const content = {
      kind: "note" as const,
      title,
      body: "  e\u0301 港 🌊\n<script>inert</script>\n# Not rendered Markdown",
      source: "https://example.invalid/citation",
      tags: ["a,b\nc"],
      links: [],
    };
    const s = await create(f, content);
    await openProject(f.root);
    expect(
      saved(
        await run(f, {
          operation: "read",
          kind: "note",
          id: s.record.id,
        } as Omit<ReferenceRequest, "projectId">),
      ),
    ).toEqual(s);
    expect(JSON.parse(await readFile(path(f, s), "utf8"))).toMatchObject({
      schemaVersion: 1,
      ...content,
    });
  },
);

it("orders timeline sequences and ties by stable ID, ignoring fictional and absent dates after reopen", async () => {
  const f = await fixture();
  const events: ReferenceSaved[] = [];
  for (const fields of [
    { title: "Z", sequence: 0, date: "Year of the dragon" },
    { title: "A", sequence: -5 },
    { title: "B", sequence: 0, date: "1900-01-01" },
    { title: "D", date: "Before time" },
    { title: "C" },
    { title: "E", sequence: Number.MAX_SAFE_INTEGER },
  ])
    events.push(
      await create(f, { kind: "timeline", tags: [], links: [], ...fields }),
    );
  await openProject(f.root);
  const listed = await run(f, { operation: "list" });
  if (listed.type !== "list") throw new Error("Expected list");
  const expected = [
    events[1]!,
    ...[events[0]!, events[2]!].sort((a, b) =>
      a.record.id < b.record.id ? -1 : 1,
    ),
    events[5]!,
    ...[events[3]!, events[4]!].sort((a, b) =>
      a.record.id < b.record.id ? -1 : 1,
    ),
  ];
  expect(listed.records.map((r) => r.id)).toEqual(
    expected.map((r) => r.record.id),
  );
  expect(listed.records.map((r) => r.sequence)).toEqual([
    -5,
    0,
    0,
    Number.MAX_SAFE_INTEGER,
    undefined,
    undefined,
  ]);
});

it("retains timeline association identities through target renames, deletion, missing chapters and event edits", async () => {
  const f = await fixture();
  const character = await create(f, contents[0]);
  const location = await create(f, contents[1]);
  let event = await create(f, {
    kind: "timeline",
    title: "Departure",
    date: "Second moon",
    sequence: 0,
    description: "Private event",
    tags: [],
    links: [
      { target: { kind: "character", id: character.record.id } },
      { target: { kind: "location", id: location.record.id } },
      { target: { kind: "chapter", id: f.chapterId } },
    ],
  });
  const links = event.record.links;
  const renamed = saved(
    await run(f, {
      ...mutation(character, "update"),
      content: { ...input(character), name: "Renamed navigator" },
    } as Omit<ReferenceRequest, "projectId">),
  );
  const chapterPath = join(f.root, "manuscript", `${f.chapterId}.json`);
  const chapter = JSON.parse(await readFile(chapterPath, "utf8"));
  await writeFile(
    chapterPath,
    JSON.stringify({ ...chapter, title: "Renamed chapter" }),
  );
  const resolution = () =>
    run(f, {
      operation: "links",
      target: { kind: "timeline", id: event.record.id },
    } as Omit<ReferenceRequest, "projectId">);
  expect(await resolution()).toMatchObject({
    outgoing: links.map(() => ({ status: "resolved" })),
  });
  await run(f, mutation(renamed, "delete"));
  await unlink(path(f, location));
  const manifestPath = join(f.root, "project.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.manuscript.order = manifest.manuscript.order.filter(
    (id: string) => id !== f.chapterId,
  );
  await writeFile(manifestPath, JSON.stringify(manifest));
  expect(await resolution()).toMatchObject({
    outgoing: [
      { status: "deleted" },
      { status: "missing" },
      { status: "missing" },
    ],
  });
  // Removing a live target leaves its durable create draft pending. Explicitly
  // discard that recovery candidate before unrelated writes, as the store requires.
  for (const candidate of await recoveries(f)) {
    if (
      candidate.recordId === location.record.id &&
      candidate.status === "pending"
    )
      await run(f, {
        operation: "recovery-discard",
        candidate: key(candidate),
        fingerprint: candidate.fingerprint,
        confirmed: true,
      } as Omit<ReferenceRequest, "projectId">);
  }
  event = saved(
    await run(f, {
      ...mutation(event, "update"),
      content: { ...input(event), title: "Revised departure" },
    } as Omit<ReferenceRequest, "projectId">),
  );
  expect(event.record.links).toEqual(links);
  await openProject(f.root);
  expect(
    await run(f, {
      operation: "read",
      kind: "timeline",
      id: event.record.id,
    } as Omit<ReferenceRequest, "projectId">),
  ).toMatchObject({ value: event });
});

it.each([1.5, Number.MAX_SAFE_INTEGER + 1, NaN])(
  "rejects malformed timeline sequence %s without replacing valid data",
  async (sequence) => {
    const f = await fixture();
    const event = await create(f, contents[3]);
    const before = await readFile(path(f, event));
    await expect(
      run(f, {
        ...mutation(event, "update"),
        content: { ...input(event), sequence },
      } as Omit<ReferenceRequest, "projectId">),
    ).rejects.toMatchObject({ code: "REFERENCE_INPUT_INVALID" });
    expect(await readFile(path(f, event))).toEqual(before);
  },
);
