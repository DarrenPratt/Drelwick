import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type {
  GlobalSearchSnapshot,
  ReferenceInput,
  ReferenceSaved,
} from "@drelwick/shared";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { executeReferenceOperation, openProject } from "../src/index.js";
import { searchGlobalIndex } from "../src/global-search.js";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function fixture() {
  const copy = await copyFixture("public-example");
  copies.push(copy);
  const project = (await openProject(copy.projectPath)).project;
  const snapshot = async (): Promise<GlobalSearchSnapshot> => {
    const value = await executeReferenceOperation({
      projectPath: copy.projectPath,
      request: { operation: "search-snapshot", projectId: project.projectId },
    });
    if (value.type !== "search-snapshot") throw new Error("snapshot");
    return value.snapshot;
  };
  return { ...copy, project, snapshot };
}
const find = (snapshot: GlobalSearchSnapshot, query: string) =>
  searchGlobalIndex(
    snapshot,
    { query, matchCase: false, wholeWord: false, kinds: [] },
    new AbortController().signal,
  );

it("rebuilds all saved kinds after reopen, excludes tombstones/history/drafts and rejects renamed/deleted hits", async () => {
  const f = await fixture();
  const contents: ReferenceInput[] = [
    {
      kind: "character",
      name: "Search character",
      aliases: ["needle"],
      tags: [],
      links: [],
    },
    {
      kind: "location",
      name: "Search location",
      notes: "needle",
      tags: [],
      links: [],
    },
    {
      kind: "canon",
      title: "Search canon",
      category: "other",
      statement: "needle",
      tags: [],
      links: [],
    },
    {
      kind: "timeline",
      title: "Search timeline",
      date: "needle",
      tags: [],
      links: [],
    },
    { kind: "note", title: "Search note", body: "needle", tags: [], links: [] },
  ];
  const saved: ReferenceSaved[] = [];
  for (const content of contents) {
    const result = await executeReferenceOperation({
      projectPath: f.projectPath,
      request: {
        operation: "create",
        projectId: f.project.projectId,
        content,
        generation: 1,
      },
    });
    if (result.type !== "record") throw new Error("record");
    saved.push(result.value);
  }
  const beforeFiles = await readdir(f.projectPath, { recursive: true });
  const first = await f.snapshot();
  expect(first.incomplete).toBe(false);
  expect((await find(first, "needle")).hits.map((hit) => hit.kind)).toEqual([
    "canon",
    "character",
    "location",
    "note",
    "timeline",
  ]);
  await openProject(f.projectPath);
  expect(await f.snapshot()).toEqual(first);
  expect(await readdir(f.projectPath, { recursive: true })).toEqual(
    beforeFiles,
  );
  const original = saved[4]!;
  const resolve = () =>
    executeReferenceOperation({
      projectPath: f.projectPath,
      request: {
        operation: "search-resolve",
        projectId: f.project.projectId,
        target: { kind: "note", id: original.record.id },
        fingerprint: original.fingerprint,
      },
    });
  expect((await resolve()).type).toBe("search-entry");
  const renamed = await executeReferenceOperation({
    projectPath: f.projectPath,
    request: {
      operation: "update",
      projectId: f.project.projectId,
      kind: "note",
      id: original.record.id,
      expectedRevision: original.record.revision,
      expectedFingerprint: original.fingerprint,
      generation: 2,
      content: {
        ...contents[4]!,
        kind: "note",
        title: "Renamed note",
        body: "changed-body",
      },
    },
  });
  if (renamed.type !== "record") throw new Error("record");
  await expect(resolve()).rejects.toMatchObject({ code: "REFERENCE_STALE" });
  expect((await find(await f.snapshot(), "needle")).hits).toHaveLength(4);
  expect((await find(await f.snapshot(), "changed-body")).hits).toHaveLength(1);
  await executeReferenceOperation({
    projectPath: f.projectPath,
    request: {
      operation: "delete",
      projectId: f.project.projectId,
      kind: "note",
      id: original.record.id,
      expectedRevision: renamed.value.record.revision,
      expectedFingerprint: renamed.value.fingerprint,
      generation: 3,
    },
  });
  await expect(
    executeReferenceOperation({
      projectPath: f.projectPath,
      request: {
        operation: "search-resolve",
        projectId: f.project.projectId,
        target: { kind: "note", id: original.record.id },
        fingerprint: renamed.value.fingerprint,
      },
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_STALE" });
  expect((await find(await f.snapshot(), "changed-body")).hits).toHaveLength(0);
});

it("refreshes chapter titles/text, reports corrupt sources and resolves only manifest-listed unchanged chapters", async () => {
  const f = await fixture();
  const first = await f.snapshot();
  const chapter = first.entries.find((entry) => entry.kind === "chapter")!;
  const path = join(f.projectPath, "manuscript", `${chapter.id}.json`);
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  raw.title = "new-search-title";
  raw.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "new-search-body" }],
      },
    ],
  };
  await writeFile(path, JSON.stringify(raw));
  await expect(
    executeReferenceOperation({
      projectPath: f.projectPath,
      request: {
        operation: "search-resolve",
        projectId: f.project.projectId,
        target: { kind: "chapter", id: chapter.id },
        fingerprint: chapter.fingerprint,
      },
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_STALE" });
  const next = await f.snapshot();
  expect((await find(next, "new-search-title")).hits[0]?.field).toBe("title");
  expect((await find(next, "new-search-body")).hits[0]?.from).toBe(1);
  const manifestPath = join(f.projectPath, "project.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    manuscript: { order: string[] };
  };
  manifest.manuscript.order = manifest.manuscript.order.filter(
    (id) => id !== chapter.id,
  );
  await writeFile(manifestPath, JSON.stringify(manifest));
  expect((await find(await f.snapshot(), "new-search-body")).hits).toHaveLength(
    0,
  );
  await writeFile(path, "broken");
  manifest.manuscript.order.push(chapter.id);
  await writeFile(manifestPath, JSON.stringify(manifest));
  expect((await f.snapshot()).incomplete).toBe(true);
});
