import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createChapter,
  createProject,
  loadChapter,
  openProjectForEditing,
  replaceManuscript,
  saveChapter,
  REPLACEMENT_JOURNAL,
} from "../src/index.js";
import { spawn } from "node:child_process";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const document = (value: string) => ({
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: value, marks: [{ type: "bold" }] }],
    },
  ],
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "drelwick-replace-"));
  roots.push(root);
  await createProject({
    projectPath: root,
    title: "Book",
    author: "Author",
    language: "en",
  });
  const expected = [];
  for (const title of ["A", "B", "C"]) {
    const { chapter } = await createChapter({ projectPath: root, title });
    const content = document(`${title} moon café 🌙`);
    await saveChapter({
      projectPath: root,
      chapterId: chapter.id,
      document: content,
    });
    expected.push({ id: chapter.id, content });
  }
  return {
    projectPath: root,
    expected,
    options: { query: "moon", matchCase: false, wholeWord: true },
    replacement: "銀色",
  };
}
async function contents(input: Awaited<ReturnType<typeof fixture>>) {
  return Promise.all(
    input.expected.map(({ id }) =>
      loadChapter({ projectPath: input.projectPath, chapterId: id }),
    ),
  );
}
it("replaces all chapters, keeps semantics and snapshots, then reopens without replaying", async () => {
  const input = await fixture();
  expect(await replaceManuscript(input)).toEqual({ matches: 3, chapters: 3 });
  const changed = await contents(input);
  expect(JSON.stringify(changed)).toContain("銀色");
  expect(JSON.stringify(changed)).not.toContain("moon");
  for (const chapter of input.expected) {
    const directory = join(
      input.projectPath,
      ".history",
      "snapshots",
      chapter.id,
    );
    const snapshots = await readdir(directory);
    const snapshot = JSON.parse(
      await readFile(join(directory, snapshots[0]!), "utf8"),
    );
    expect(snapshot.reason).toBe("before-replace");
    expect(snapshot.content).toEqual(chapter.content);
  }
  await saveChapter({
    projectPath: input.projectPath,
    chapterId: input.expected[0]!.id,
    document: document("Later edits"),
  });
  await openProjectForEditing(input.projectPath);
  expect((await contents(input))[0]!.content).toEqual(document("Later edits"));
});
it("limits current chapter scope and handles empty, identical and no-match replacement", async () => {
  const input = await fixture();
  const first = input.expected[0]!;
  expect(
    await replaceManuscript({
      ...input,
      chapterId: first.id,
      expected: [first],
      replacement: "",
    }),
  ).toEqual({ matches: 1, chapters: 1 });
  expect((await contents(input)).slice(1)).toEqual(input.expected.slice(1));
  const fresh = await contents(input);
  expect(
    await replaceManuscript({ ...input, expected: fresh, replacement: "moon" }),
  ).toEqual({ matches: 2, chapters: 0 });
  expect(
    await replaceManuscript({
      ...input,
      expected: fresh,
      options: { ...input.options, query: "absent" },
    }),
  ).toEqual({ matches: 0, chapters: 0 });
});
it("restores all chapters after injected second-write failure, including previously flushed edits", async () => {
  const input = await fixture();
  input.expected[0]!.content = document("New unsaved prose moon");
  await saveChapter({
    projectPath: input.projectPath,
    chapterId: input.expected[0]!.id,
    document: input.expected[0]!.content,
  });
  let reached = false;
  await expect(
    replaceManuscript(input, {
      beforeWrite: async (index) => {
        if (index === 1) {
          reached = true;
          throw new Error("Injected failure");
        }
      },
    }),
  ).rejects.toMatchObject({ code: "REPLACEMENT_FAILED" });
  expect(reached).toBe(true);
  expect(await contents(input)).toEqual(input.expected);
  await openProjectForEditing(input.projectPath);
  expect(await contents(input)).toEqual(input.expected);
});
it.each([0, 1, 2])(
  "cancels at write boundary %i without leaving mixed chapters",
  async (boundary) => {
    const input = await fixture();
    let cancelled = false;
    input.expected[0]!.content = document("Newly flushed prose moon");
    await saveChapter({
      projectPath: input.projectPath,
      chapterId: input.expected[0]!.id,
      document: input.expected[0]!.content,
    });
    await expect(
      replaceManuscript(input, {
        cancelled: () => cancelled,
        beforeWrite: async (index) => {
          if (index === boundary) cancelled = true;
        },
      }),
    ).rejects.toMatchObject({ code: "REPLACEMENT_CANCELLED" });
    expect(await contents(input)).toEqual(input.expected);
  },
);
it("rejects stale review, invalid replacement document and failed snapshot before mutation", async () => {
  const input = await fixture();
  await expect(
    replaceManuscript({ ...input, expected: [] }),
  ).rejects.toMatchObject({ code: "REPLACEMENT_FAILED" });
  await expect(
    replaceManuscript(input, {
      snapshot: async () => {
        throw new Error("snapshot failed");
      },
    }),
  ).rejects.toMatchObject({ code: "REPLACEMENT_FAILED" });
  expect(await contents(input)).toEqual(input.expected);
});
it("blocks editing and retains journal when rollback detects external conflicting work", async () => {
  const input = await fixture();
  await expect(
    replaceManuscript(input, {
      beforeWrite: async (index) => {
        if (index !== 1) return;
        const path = join(
          input.projectPath,
          "manuscript",
          `${input.expected[0]!.id}.json`,
        );
        const raw = JSON.parse(await readFile(path, "utf8"));
        await writeFile(
          path,
          JSON.stringify({ ...raw, content: document("External newer prose") }),
        );
        throw new Error("interrupt");
      },
    }),
  ).rejects.toMatchObject({ code: "REPLACEMENT_RECOVERY_REQUIRED" });
  await expect(contents(input)).rejects.toMatchObject({
    code: "REPLACEMENT_RECOVERY_REQUIRED",
  });
  await expect(openProjectForEditing(input.projectPath)).rejects.toMatchObject({
    code: "REPLACEMENT_RECOVERY_REQUIRED",
  });
  expect(
    JSON.parse(
      await readFile(join(input.projectPath, REPLACEMENT_JOURNAL), "utf8"),
    ).phase,
  ).toBe("pending");
});
it("recovers a terminated process midway through writes on reopen", async () => {
  const input = await fixture();
  const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
  const script = `import { replaceManuscript } from ${JSON.stringify(moduleUrl)}; const input = JSON.parse(process.argv[1]); await replaceManuscript(input, { beforeWrite: async index => { if(index === 1) process.exit(73); } });`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, JSON.stringify(input)],
    { stdio: "ignore", windowsHide: true },
  );
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  expect(code).toBe(73);
  await expect(contents(input)).rejects.toMatchObject({
    code: "REPLACEMENT_RECOVERY_REQUIRED",
  });
  await openProjectForEditing(input.projectPath);
  expect(await contents(input)).toEqual(input.expected);
});
