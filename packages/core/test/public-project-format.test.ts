import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import * as yauzl from "yauzl";
import {
  BookMetadataSchema,
  BookPresentationSchema,
  ChapterFileSchema,
  HistorySnapshotSchema,
  ImageAssetSchema,
  ManuscriptDocumentSchema,
  ProjectArchiveManifestSchema,
  ProjectConfigSchema,
  ProjectFormatSchema,
  PublicationSchema,
  manuscriptImageReferences,
} from "@drelwick/project-model";
import {
  assembleBook,
  createProjectArchive,
  loadChapter,
  openProject,
  openProjectForEditing,
  readImageAsset,
  readPublication,
  renameChapter,
  restoreProjectArchive,
  saveChapter,
  writeJsonAtomically,
} from "../src/index.js";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const first = id(902),
  second = id(901),
  assetId = id(903);
const copies: FixtureCopy[] = [];
const temporary: string[] = [];
const execute = promisify(execFile);
const script = fileURLToPath(
  new URL("../../../scripts/recover-project-text.mjs", import.meta.url),
);
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all([
    ...copies.splice(0).map((copy) => copy.cleanup()),
    ...temporary
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  ]);
});
async function fixture() {
  const copy = await copyFixture("public-example");
  copies.push(copy);
  return copy.projectPath;
}
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "drelwick-format-review-"));
  temporary.push(root);
  return root;
}
async function json(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, path), "utf8")) as unknown;
}
async function inventory(
  root: string,
  relative = "",
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(join(root, relative), {
    withFileTypes: true,
  })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      for (const [child, bytes] of await inventory(root, name))
        files.set(child, bytes);
    else files.set(name, await readFile(join(root, name)));
  }
  return files;
}
interface RecoveryReport {
  projectId: string;
  book: { title: string };
  publicationMetadata: { title: string };
  documents: {
    id: string;
    title: string;
    text: string;
    links: string[];
    assetIds: string[];
  }[];
  assets: { id: string; path: string; byteSize: number; sha256: string }[];
}
async function recover(
  root: string,
  isolatedScript = script,
): Promise<RecoveryReport> {
  const result = await execute(process.execPath, [isolatedScript, root], {
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as RecoveryReport;
}

it("validates every public example component through production schemas, loader and assembly", async () => {
  const root = await fixture();
  const originals = await inventory(root);
  for (const [name, bytes] of originals) {
    if (!name.endsWith(".json")) continue;
    expect(bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]))).toBe(
      false,
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(Buffer.from(decoded, "utf8")).toEqual(bytes);
    expect(() => JSON.parse(decoded)).not.toThrow();
  }
  const manifest = ProjectConfigSchema.parse(await json(root, "project.json"));
  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.manuscript.order).toEqual([first, second]);
  expect([...manifest.manuscript.order].sort()).toEqual([second, first]);
  expect(ProjectFormatSchema.parse(await json(root, "format.json"))).toEqual({
    schemaVersion: 1,
    projectId: manifest.projectId,
    bookSchemaVersion: 1,
    chapterSchemaVersion: 1,
  });
  BookMetadataSchema.parse(await json(root, "book.json"));
  BookPresentationSchema.parse(await json(root, "presentation.json"));
  const opened = await openProjectForEditing(root);
  expect(opened.chapters.map((chapter) => chapter.id)).toEqual([first, second]);
  const publication = PublicationSchema.parse(
    await json(root, "publication.json"),
  );
  expect((await readPublication(root, opened)).data).toEqual(publication);
  expect(publication.body.map((entry) => entry.id)).toEqual([second, first]);
  const references = new Set([publication.coverAssetId!]);
  for (const chapterId of manifest.manuscript.order) {
    const chapter = ChapterFileSchema.parse(
      await json(root, `manuscript/${chapterId}.json`),
    );
    expect(chapter.id).toBe(chapterId);
    expect(chapter.schemaVersion).toBe(1);
    ManuscriptDocumentSchema.parse(chapter.content);
    expect(
      (await loadChapter({ projectPath: root, chapterId })).content,
    ).toEqual(chapter.content);
    manuscriptImageReferences(chapter.content).forEach((reference) =>
      references.add(reference),
    );
  }
  for (const page of publication.pages)
    manuscriptImageReferences(page.document).forEach((reference) =>
      references.add(reference),
    );
  expect([...references]).toEqual([assetId]);
  const { asset, bytes } = await readImageAsset(root, assetId);
  expect(
    ImageAssetSchema.parse(
      await json(root, `assets/images/${assetId}/asset.json`),
    ),
  ).toEqual(asset);
  expect(asset).toMatchObject({
    width: 2,
    height: 3,
    byteSize: 96,
    sha256: hash(bytes),
  });
  const snapshot = HistorySnapshotSchema.parse(
    await json(root, `.history/snapshots/${first}/${id(990)}.json`),
  );
  expect(snapshot.chapterId).toBe(first);
  expect(snapshot.id).toBe(id(990));
  const assembled = await assembleBook(root);
  expect(assembled.book.chapters.map((chapter) => chapter.id)).toEqual([
    assetId,
    id(904),
    id(905),
    first,
    second,
    id(906),
  ]);
  expect(assembled.assets.get(assetId)).toEqual(new Uint8Array(bytes));
  expect(assembled.book.title).toBe("The Lantern Example");
  expect(opened.book.title).toBe("The Lantern Example — working title");
  for (const [name, original] of originals)
    expect(await readFile(join(root, name))).toEqual(original);
  // Optional cache writes are allowed; a current project requires no migration.
  expect(
    (await readdir(root)).filter((name) => name.includes("migration")),
  ).toEqual([]);
});

it("recovers exact synthetic text, hidden matter, links and local image paths using only Node built-ins", async () => {
  const isolated = await temp();
  const isolatedScript = join(isolated, "recover.mjs");
  await cp(script, isolatedScript);
  const root = await fixture();
  const before = await inventory(root);
  const report = await recover(root, isolatedScript);
  expect(report.documents.map((document) => document.id)).toEqual([
    id(904),
    id(905),
    first,
    second,
    id(906),
  ]);
  expect(report.documents.map((document) => document.text)).toEqual([
    "The Lantern Example\nExample Author\n",
    "This hidden draft must remain recoverable.\n",
    "A synthetic beginning\n“Café” — Καλημέρα · こんにちは · مرحبًا · 😀 · e\u0301.\nAll prose in this project is synthetic.\nBold and italic introduce a sample link.\nA lantern is only a mark on this fictional map.\nAn invented archive\nAn imaginary quay\nA nested synthetic step\n[Image: Synthetic blue rectangle, two by three pixels.]\n[Scene break]\nThe first chapter ends here.\n",
    'A synthetic ending\nNo real person or manuscript is represented.\nUnderline / strike / code\nsample = "fiction"\nreturn sample\n[Horizontal rule]\nThe second chapter closes the example.\n',
    "Example Author is a fictional credit for this fixture.\n",
  ]);
  expect(report.documents[2]?.links).toEqual(["https://example.invalid/story"]);
  expect(report.documents[2]?.assetIds).toEqual([assetId]);
  expect(report.assets).toEqual([
    {
      id: assetId,
      path: `assets/images/${assetId}/original.png`,
      originalFilename: "synthetic-blue.png",
      byteSize: 96,
      sha256:
        "daa407f36db632b5281cd1c21cebfa35a3b54e1671c28051f57b6f3423c92188",
    },
  ]);
  expect(await inventory(root)).toEqual(before);
});

/** Ordinary ZIP decoding of our generated synthetic archive, not Drelwick restore. */
async function unzip(archive: string, destination: string) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (error, opened) => {
      if (error || !opened) reject(error ?? new Error("Missing ZIP"));
      else resolve(opened);
    });
  });
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      const parts = entry.fileName.split("/");
      if (
        parts.some(
          (part) =>
            !part || part === "." || part === ".." || /[\\:]/.test(part),
        )
      ) {
        zip.close();
        reject(new Error("Unexpected fixture ZIP path"));
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error("Missing ZIP stream"));
          return;
        }
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream)
            chunks.push(Buffer.from(chunk as Buffer));
          const target = join(destination, ...parts);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, Buffer.concat(chunks), { flag: "wx" });
          zip.readEntry();
        })().catch(reject);
      });
    });
    zip.readEntry();
  });
}

it("recovers an ordinary ZIP extraction with verified envelope, Unicode, assets and optional history", async () => {
  const root = await fixture();
  const work = await temp();
  const archive = join(work, "example.drelwick.zip");
  const originals = await inventory(root);
  await createProjectArchive({ projectPath: root, archivePath: archive });
  const extracted = join(work, "ordinary-extraction");
  await mkdir(extracted);
  await unzip(archive, extracted);
  const manifest = ProjectArchiveManifestSchema.parse(
    await json(extracted, ".drelwick-archive.json"),
  );
  expect(manifest).toMatchObject({
    schemaVersion: 1,
    projectId: id(900),
    includesHistory: true,
  });
  expect(manifest.files.map((file) => file.path).sort()).toEqual(
    [...originals.keys()].sort(),
  );
  for (const file of manifest.files) {
    const recovered = await readFile(join(extracted, file.path));
    expect(recovered.length).toBe(file.size);
    expect(hash(recovered)).toBe(file.sha256);
    expect(recovered).toEqual(originals.get(file.path));
  }
  const report = await recover(root);
  expect(await recover(extracted)).toEqual(report);
  const restored = await restoreProjectArchive({
    archivePath: archive,
    destinationParent: work,
  });
  expect(await recover(restored.projectPath)).toEqual(report);
  expect(
    (await openProject(restored.projectPath)).project.manuscript.order,
  ).toEqual([first, second]);
  const noHistory = join(work, "without-history.zip");
  await createProjectArchive({
    projectPath: root,
    archivePath: noHistory,
    includeHistory: false,
  });
  const noHistoryDirectory = join(work, "without-history");
  await mkdir(noHistoryDirectory);
  await unzip(noHistory, noHistoryDirectory);
  const without = ProjectArchiveManifestSchema.parse(
    await json(noHistoryDirectory, ".drelwick-archive.json"),
  );
  expect(without.includesHistory).toBe(false);
  expect(without.files.some((file) => file.path.startsWith(".history/"))).toBe(
    false,
  );
  expect(await recover(noHistoryDirectory)).toEqual(report);
});

it("round-trips the example chapter through the real writer and verifies UTF-8, BOM and newline behavior", async () => {
  const root = await fixture();
  const chapterPath = join(root, "manuscript", `${first}.json`);
  const chapter = ChapterFileSchema.parse(
    await json(root, `manuscript/${first}.json`),
  );
  await saveChapter({
    projectPath: root,
    chapterId: first,
    document: chapter.content,
  });
  expect(
    (await loadChapter({ projectPath: root, chapterId: first })).content,
  ).toEqual(chapter.content);
  const written = await readFile(chapterPath);
  expect(written.toString("utf8")).toContain("e\u0301");
  expect(written.toString("utf8")).not.toContain("\r");
  expect(written.at(-1)).toBe(10);
  expect(written.subarray(0, 3).equals(Buffer.from([239, 187, 191]))).toBe(
    false,
  );
  await writeFile(
    chapterPath,
    written.toString("utf8").trimEnd().replaceAll("\n", "\r\n"),
  );
  expect(
    (await loadChapter({ projectPath: root, chapterId: first })).content,
  ).toEqual(chapter.content);
  await writeFile(
    join(root, "book.json"),
    Buffer.concat([
      Buffer.from([239, 187, 191]),
      await readFile(join(root, "book.json")),
    ]),
  );
  await expect(openProject(root)).rejects.toMatchObject({
    code: "PROJECT_JSON_INVALID",
  });
});

it("pins documented unknown-data behavior without promising extension-field preservation", async () => {
  const root = await fixture();
  const chapterPath = `manuscript/${first}.json`;
  const chapter = ChapterFileSchema.parse(await json(root, chapterPath));
  await writeJsonAtomically(join(root, chapterPath), {
    ...chapter,
    unknownExample: "not a format field",
  });
  await saveChapter({
    projectPath: root,
    chapterId: first,
    document: chapter.content,
  });
  expect(await json(root, chapterPath)).toHaveProperty("unknownExample");
  await renameChapter({
    projectPath: root,
    chapterId: first,
    title: "Renamed example",
  });
  expect(await json(root, chapterPath)).not.toHaveProperty("unknownExample");
  expect(
    ManuscriptDocumentSchema.safeParse({
      type: "doc",
      content: [{ type: "futureNode" }],
    }).success,
  ).toBe(false);
  for (const [name, schema] of [
    ["format.json", ProjectFormatSchema],
    ["publication.json", PublicationSchema],
    ["presentation.json", BookPresentationSchema],
    [`assets/images/${assetId}/asset.json`, ImageAssetSchema],
  ] as const) {
    const value = (await json(root, name)) as Record<string, unknown>;
    expect(schema.safeParse({ ...value, unknownExample: true }).success).toBe(
      false,
    );
  }
});
