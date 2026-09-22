import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  link,
  symlink,
  open,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  IMPORT_LIMITS,
  validateImportedManuscript,
  type ImporterResult,
} from "@sarel/project-model";
import { IsolatedManuscriptImporter } from "@sarel/core";
import {
  StagedManuscriptImport,
  createProject,
  loadChapter,
  readImageAsset,
  validateProjectFiles,
} from "../src/index.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";

const roots: string[] = [];
const stages: StagedManuscriptImport[] = [];
afterEach(async () => {
  for (const stage of stages.splice(0))
    await stage.discard().catch(() => undefined);
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const manuscript = (): ImporterResult => ({
  metadata: {
    title: "海 — café",
    author: "Synthetic author",
    language: "en",
    subtitle: "Subtitle",
    series: { name: "Series", number: 2 },
  },
  chapters: [
    {
      title: "Opening",
      type: "chapter",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Unicode 🌱 prose" }],
          },
        ],
      },
    },
  ],
  assets: [],
  warnings: [
    {
      code: "OMITTED_STYLE",
      message: "Style omitted",
      location: { chapter: 0, block: 0, label: "Paragraph 1" },
    },
  ],
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sarel-import-test-"));
  roots.push(root);
  const source = join(root, "source.bin");
  const destination = join(root, "destination");
  await writeFile(source, "unchanged source");
  await mkdir(destination);
  const active = join(root, "active");
  await createProject({
    projectPath: active,
    title: "Active",
    author: "Author",
    language: "en",
  });
  const activeBytes = await readFile(join(active, "project.json"));
  const abort = new AbortController();
  return { root, source, destination, active, activeBytes, abort };
}
async function inspect(
  source: string,
  value = manuscript(),
  signal = new AbortController().signal,
) {
  const stage = await StagedManuscriptImport.inspect(
    source,
    { parse: async () => JSON.stringify(value) },
    { signal },
  );
  stages.push(stage);
  return stage;
}
it("previews without project creation, then commits semantic content, metadata and byte-identical managed assets", async () => {
  const f = await fixture();
  const value = manuscript();
  const id = "00000000-0000-4000-8000-000000000001";
  const image = await syntheticImage();
  value.assets.push({
    id,
    mediaType: "image/png",
    base64: image.toString("base64"),
  });
  value.chapters[0]!.content.content!.push({
    type: "image",
    attrs: { assetId: id, alt: "海", size: "large" },
  });
  const stage = await inspect(f.source, value);
  expect(stage.preview).toEqual(value);
  expect(await readdir(f.destination)).toEqual([]);
  const receipt = await stage.commit(f.destination, { signal: f.abort.signal });
  const project = await validateProjectFiles(f.destination);
  expect(receipt.projectId).toBe(project.project.projectId);
  expect(project.book).toMatchObject(value.metadata);
  const chapter = await loadChapter({
    projectPath: f.destination,
    chapterId: project.project.manuscript.order[0]!,
  });
  expect(chapter.content).toEqual(value.chapters[0]!.content);
  expect((await readImageAsset(f.destination, id)).bytes).toEqual(image);
  expect(await readFile(f.source, "utf8")).toBe("unchanged source");
  expect(await readFile(join(f.active, "project.json"))).toEqual(f.activeBytes);
});
it.each(["parsed", "staging", "staged"] as const)(
  "cancels at %s and removes its private stage",
  async (phase) => {
    const f = await fixture();
    const before = (await readdir(f.root)).filter((name) =>
      name.startsWith("sarel-manuscript-import-"),
    );
    await expect(
      StagedManuscriptImport.inspect(
        f.source,
        { parse: async () => JSON.stringify(manuscript()) },
        {
          signal: f.abort.signal,
          temporaryRoot: f.root,
          checkpoint: async (point) => {
            if (point === phase) f.abort.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
    expect(
      (await readdir(f.root)).filter((name) =>
        name.startsWith("sarel-manuscript-import-"),
      ),
    ).toEqual(before);
    expect(await readdir(f.destination)).toEqual([]);
    expect(await readFile(f.source, "utf8")).toBe("unchanged source");
  },
);
it.each(["writing", "before-commit"] as const)(
  "cancellation at %s leaves no authoritative or partial destination",
  async (phase) => {
    const f = await fixture();
    const stage = await inspect(f.source);
    await expect(
      stage.commit(f.destination, {
        signal: f.abort.signal,
        checkpoint: async (point) => {
          if (point === phase) f.abort.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
    expect(await readdir(f.destination)).toEqual([]);
    expect(await readFile(join(f.active, "project.json"))).toEqual(
      f.activeBytes,
    );
  },
);
it("cancels a preview before commit and consumes the staged capability", async () => {
  const f = await fixture();
  const stage = await inspect(f.source);
  f.abort.abort();
  await expect(
    stage.commit(f.destination, { signal: f.abort.signal }),
  ).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
  await expect(
    stage.commit(f.destination, { signal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: "IMPORT_EXPIRED" });
  expect(await readdir(f.destination)).toEqual([]);
});
it("handles actual partial staging writes and project write failures without touching source or active project", async () => {
  const f = await fixture();
  let stagePath = "";
  await expect(
    StagedManuscriptImport.inspect(
      f.source,
      { parse: async () => JSON.stringify(manuscript()) },
      {
        signal: f.abort.signal,
        writeBytes: async (path) => {
          stagePath = path;
          await writeFile(path, "partial");
          throw new Error("synthetic disk failure");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "IMPORT_FAILED" });
  await expect(readFile(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
  const stage = await inspect(f.source);
  await expect(
    stage.commit(f.destination, {
      signal: f.abort.signal,
      writeJson: async () => {
        throw new Error("synthetic failure");
      },
    }),
  ).rejects.toMatchObject({ code: "IMPORT_FAILED" });
  expect(await readdir(f.destination)).toEqual([]);
  expect(await readFile(f.source, "utf8")).toBe("unchanged source");
  expect(await readFile(join(f.active, "project.json"))).toEqual(f.activeBytes);
});
it("rejects nonempty destinations and empty descendants of existing projects", async () => {
  const f = await fixture();
  await writeFile(join(f.destination, "keep.txt"), "keep");
  await expect(
    (await inspect(f.source)).commit(f.destination, { signal: f.abort.signal }),
  ).rejects.toMatchObject({ code: "IMPORT_DESTINATION_INVALID" });
  expect(await readFile(join(f.destination, "keep.txt"), "utf8")).toBe("keep");
  const child = join(f.active, "empty");
  await mkdir(child);
  await expect(
    (await inspect(f.source)).commit(child, { signal: f.abort.signal }),
  ).rejects.toMatchObject({ code: "IMPORT_DESTINATION_INVALID" });
  expect(await readdir(child)).toEqual([]);
});
it("rejects traversal, hard-linked sources and junction destinations", async () => {
  const f = await fixture();
  await expect(
    inspect(`${f.root}/destination/../source.bin`),
  ).rejects.toBeDefined();
  const hard = join(f.root, "hard.bin");
  await link(f.source, hard);
  await expect(inspect(hard)).rejects.toBeDefined();
  const junction = join(f.root, "linked");
  await symlink(f.destination, junction, "junction");
  // Use a separate unlinked input so only the destination is rejected.
  const source = join(f.root, "second.bin");
  await writeFile(source, "source");
  await expect(
    (await inspect(source)).commit(junction, { signal: f.abort.signal }),
  ).rejects.toBeDefined();
  expect(await readdir(f.destination)).toEqual([]);
});
it("rejects malformed parser results, invalid semantics, missing assets and structural/resource overflow", () => {
  expect(validateImportedManuscript(JSON.stringify(manuscript()))).toEqual(
    manuscript(),
  );
  const values: unknown[] = [
    {
      ...manuscript(),
      warnings: [
        { code: "WARNING", message: "Problem", location: { label: "" } },
      ],
    },
    {
      ...manuscript(),
      assets: Array.from({ length: IMPORT_LIMITS.assets + 1 }, () => ({
        id: "00000000-0000-4000-8000-000000000001",
        mediaType: "image/png",
        base64: "AAAA",
      })),
    },
    null,
    {},
    { ...manuscript(), extra: true },
    { ...manuscript(), chapters: [] },
    {
      ...manuscript(),
      chapters: Array.from(
        { length: IMPORT_LIMITS.chapters + 1 },
        () => manuscript().chapters[0],
      ),
    },
    {
      ...manuscript(),
      warnings: Array.from(
        { length: IMPORT_LIMITS.warnings + 1 },
        () => manuscript().warnings[0],
      ),
    },
    {
      ...manuscript(),
      metadata: { ...manuscript().metadata, title: "x".repeat(501) },
    },
    {
      ...manuscript(),
      chapters: [
        {
          title: "Unsafe",
          type: "chapter",
          content: {
            type: "doc",
            content: [{ type: "script", text: "execute()" }],
          },
        },
      ],
    },
    {
      ...manuscript(),
      assets: [{ id: "../../outside", mediaType: "image/png", base64: "" }],
    },
  ];
  for (const value of values)
    expect(() => validateImportedManuscript(JSON.stringify(value))).toThrow();
  expect(() => validateImportedManuscript("{author prose malformed")).toThrow(
    "The imported manuscript is invalid",
  );
  expect(() =>
    validateImportedManuscript(" ".repeat(IMPORT_LIMITS.parserBytes + 1)),
  ).toThrow();
  const deep = `${'{"x":'.repeat(100)}0${"}".repeat(100)}`;
  expect(() => validateImportedManuscript(deep)).toThrow();
});
it("runs with network, filesystem, execution and dynamic-code capabilities unavailable", async () => {
  const program = `() => {
    if ([typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof require, typeof process].some(x => x !== 'undefined')) throw new Error('capability');
    try { Function('return 1')(); throw new Error('execution permitted'); } catch (e) { if (e.name !== 'EvalError') throw e; }
    return ${JSON.stringify(JSON.stringify(manuscript()))};
  }`;
  const result = await new IsolatedManuscriptImporter(program).parse(
    new TextEncoder().encode(
      '<img src="https://external.invalid/image"><script>fetch("https://external.invalid")</script>',
    ),
    new AbortController().signal,
  );
  expect(validateImportedManuscript(result)).toEqual(manuscript());
});
it("terminates a busy parser on cancellation and strips parser error contents", async () => {
  const abort = new AbortController();
  const operation = new IsolatedManuscriptImporter(
    "() => { while (true) {} }",
  ).parse(new Uint8Array([1]), abort.signal);
  setTimeout(() => abort.abort(), 100);
  await expect(operation).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
  await expect(
    new IsolatedManuscriptImporter(
      "() => { throw new Error('secret manuscript text'); }",
    ).parse(new Uint8Array([1]), new AbortController().signal),
  ).rejects.not.toThrow("secret manuscript text");
});

it("rejects oversized sources before invoking the parser", async () => {
  const f = await fixture();
  const handle = await open(f.source, "w");
  await handle.truncate(IMPORT_LIMITS.sourceBytes + 1);
  await handle.close();
  let called = false;
  await expect(
    StagedManuscriptImport.inspect(
      f.source,
      {
        parse: async () => {
          called = true;
          return "{}";
        },
      },
      { signal: f.abort.signal },
    ),
  ).rejects.toBeDefined();
  expect(called).toBe(false);
});

it("rejects invalid image payloads, executable assets and remote image references", async () => {
  const f = await fixture();
  const value = manuscript();
  const id = "00000000-0000-4000-8000-000000000001";
  value.assets = [
    {
      id,
      mediaType: "image/png",
      base64: Buffer.from('<svg onload="execute()"/>').toString("base64"),
    },
  ];
  await expect(inspect(f.source, value)).rejects.toBeDefined();
  value.assets = [];
  value.chapters[0]!.content.content = [
    { type: "image", attrs: { assetId: id, alt: "missing", size: "medium" } },
  ];
  expect(() => validateImportedManuscript(JSON.stringify(value))).toThrow();
  value.chapters[0]!.content.content = [
    { type: "image", attrs: { src: "https://external.invalid/image" } },
  ];
  expect(() => validateImportedManuscript(JSON.stringify(value))).toThrow();
  expect(await readdir(f.destination)).toEqual([]);
});

it("rejects altered staged bytes and does not persist a mutated preview", async () => {
  const f = await fixture();
  let stagedFile = "";
  const stage = await StagedManuscriptImport.inspect(
    f.source,
    { parse: async () => JSON.stringify(manuscript()) },
    {
      signal: f.abort.signal,
      writeBytes: async (path, bytes) => {
        stagedFile = path;
        await writeFile(path, bytes, { flag: "wx" });
      },
    },
  );
  stages.push(stage);
  await writeFile(
    stagedFile,
    JSON.stringify({
      ...manuscript(),
      metadata: { ...manuscript().metadata, title: "Tampered" },
    }),
  );
  await expect(
    stage.commit(f.destination, { signal: f.abort.signal }),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  expect(await readdir(f.destination)).toEqual([]);
  const next = await inspect(f.source);
  next.preview.metadata.title = "Mutated";
  await next.commit(f.destination, { signal: f.abort.signal });
  expect((await validateProjectFiles(f.destination)).book.title).toBe(
    manuscript().metadata.title,
  );
});

it("does not overwrite a file introduced before final publication and removes only owned artifacts", async () => {
  const f = await fixture();
  const stage = await inspect(f.source);
  await expect(
    stage.commit(f.destination, {
      signal: f.abort.signal,
      checkpoint: async (phase) => {
        if (phase === "before-commit")
          await writeFile(
            join(f.destination, "project.json"),
            "external content",
            { flag: "wx" },
          );
      },
    }),
  ).rejects.toBeDefined();
  expect(await readdir(f.destination)).toEqual(["project.json"]);
  expect(await readFile(join(f.destination, "project.json"), "utf8")).toBe(
    "external content",
  );
});

it("rejects oversized isolated parser output before passing it to the coordinator", async () => {
  await expect(
    new IsolatedManuscriptImporter(
      `() => 'x'.repeat(${IMPORT_LIMITS.parserBytes + 1})`,
    ).parse(new Uint8Array([1]), new AbortController().signal),
  ).rejects.toMatchObject({ code: "IMPORT_PARSER_FAILED" });
});
