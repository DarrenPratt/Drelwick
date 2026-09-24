import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import {
  createProjectArchive,
  openProject,
  PROJECT_ARCHIVE_MAX_BYTES,
  PROJECT_ARCHIVE_MAX_FILE_BYTES,
  restoreProjectArchive,
  writeJsonAtomically,
} from "../src/index.js";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";

const temporaryRoots: string[] = [];
const fixtureCopies: FixtureCopy[] = [];

afterEach(async () => {
  await Promise.all([
    ...temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
    ...fixtureCopies.splice(0).map((fixture) => fixture.cleanup()),
  ]);
});

async function unicodeFixture(): Promise<FixtureCopy> {
  const fixture = await copyFixture("unicode-book");
  fixtureCopies.push(fixture);
  return fixture;
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "drelwick-project-archive-"));
  temporaryRoots.push(path);
  return path;
}

interface ZipItem {
  name: string;
  data: Buffer;
}

async function readZip(path: string): Promise<ZipItem[]> {
  const zip = await new Promise<yauzl.ZipFile>((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, opened) => {
      if (error || !opened)
        reject(error ?? new Error("Unable to open archive"));
      else resolveZip(opened);
    });
  });
  return new Promise((resolveItems, reject) => {
    const items: ZipItem[] = [];
    zip.on("error", reject);
    zip.on("entry", (entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error("Unable to read archive entry"));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        stream.on("error", reject);
        stream.on("end", () => {
          items.push({ name: entry.fileName, data: Buffer.concat(chunks) });
          zip.readEntry();
        });
      });
    });
    zip.on("end", () => resolveItems(items));
    zip.readEntry();
  });
}

async function writeZip(path: string, items: ZipItem[]): Promise<void> {
  const zip = new yazl.ZipFile();
  const output = (await import("node:fs")).createWriteStream(path);
  const completed = new Promise<void>((resolveOutput, reject) => {
    output.once("finish", resolveOutput);
    output.once("error", reject);
    zip.outputStream.once("error", reject);
  });
  zip.outputStream.pipe(output);
  for (const item of items)
    zip.addBuffer(item.data, item.name, { compress: false });
  zip.end();
  await completed;
}

describe("portable project archive", () => {
  it("round-trips Unicode manuscript text, assets and optional recovery history", async () => {
    const fixture = await unicodeFixture();
    const parent = await temporaryDirectory();
    const archive = join(parent, "book.zip");
    const destination = join(parent, "restored");
    await mkdir(destination);
    const chapterPath = join(
      fixture.projectPath,
      "manuscript",
      "00000000-0000-4000-8000-000000000411.json",
    );
    const originalChapter = await readFile(chapterPath);
    const asset = Buffer.from("synthetic cover asset\n", "utf8");
    await mkdir(join(fixture.projectPath, "assets"), { recursive: true });
    await writeFile(join(fixture.projectPath, "assets", "cover.svg"), asset);
    const history = Buffer.from('{"synthetic":"recovery history"}\n', "utf8");
    await mkdir(
      join(fixture.projectPath, ".history", "snapshots", "synthetic"),
      { recursive: true },
    );
    await writeFile(
      join(
        fixture.projectPath,
        ".history",
        "snapshots",
        "synthetic",
        "saved.json",
      ),
      history,
    );

    await createProjectArchive({
      projectPath: fixture.projectPath,
      archivePath: archive,
    });
    expect(await readFile(chapterPath)).toEqual(originalChapter);
    expect(await readdir(fixture.projectPath)).not.toContain(
      ".chapter-summaries.json",
    );
    const names = (await readZip(archive)).map(({ name }) => name);
    expect(names).toContain("assets/cover.svg");
    expect(names).toContain(".history/snapshots/synthetic/saved.json");

    const restored = await restoreProjectArchive({
      archivePath: archive,
      destinationParent: destination,
    });
    const opened = await openProject(restored.projectPath);
    const restoredChapter = await readFile(
      join(
        restored.projectPath,
        "manuscript",
        "00000000-0000-4000-8000-000000000411.json",
      ),
      "utf8",
    );
    expect(restored.title).toBe(opened.book.title);
    expect(restoredChapter).toContain("l’autrice — déjà");
    expect(restoredChapter).toContain("こんにちは世界");
    expect(
      await readFile(join(restored.projectPath, "assets", "cover.svg")),
    ).toEqual(asset);
    expect(
      await readFile(
        join(
          restored.projectPath,
          ".history",
          "snapshots",
          "synthetic",
          "saved.json",
        ),
      ),
    ).toEqual(history);
  });

  it("supports backups without history and excludes caches, credentials and transient files", async () => {
    const fixture = await unicodeFixture();
    const parent = await temporaryDirectory();
    const archive = join(parent, "without-history.zip");
    await writeFile(
      join(fixture.projectPath, ".chapter-summaries.json"),
      "cache",
    );
    await writeFile(join(fixture.projectPath, ".env"), "credential=synthetic");
    await writeFile(
      join(fixture.projectPath, "manuscript", "interrupted.json.tmp"),
      "temporary",
    );
    await mkdir(
      join(fixture.projectPath, ".history", "snapshots", "synthetic"),
      { recursive: true },
    );
    await writeJsonAtomically(
      join(
        fixture.projectPath,
        ".history",
        "snapshots",
        "synthetic",
        "history.json",
      ),
      { placeholder: true },
    );

    await createProjectArchive({
      projectPath: fixture.projectPath,
      archivePath: archive,
      includeHistory: false,
    });
    const names = (await readZip(archive)).map(({ name }) => name);
    expect(names.some((name) => name.startsWith(".history/"))).toBe(false);
    const restored = await restoreProjectArchive({
      archivePath: archive,
      destinationParent: parent,
    });
    expect(
      await readFile(
        join(
          restored.projectPath,
          "manuscript",
          "00000000-0000-4000-8000-000000000411.json",
        ),
        "utf8",
      ),
    ).toContain("l’autrice");
    const archiveNames = (await readZip(archive)).map(({ name }) => name);
    expect(archiveNames).not.toContain(".chapter-summaries.json");
    expect(
      await readFile(
        join(restored.projectPath, "manuscript", "interrupted.json.tmp"),
      ).catch(() => null),
    ).toBeNull();
    expect(
      await readFile(join(restored.projectPath, ".env")).catch(() => null),
    ).toBeNull();
    expect(
      await stat(join(restored.projectPath, ".history")).catch(() => null),
    ).toBeNull();
  });

  it("never overwrites an existing restored project", async () => {
    const fixture = await unicodeFixture();
    const parent = await temporaryDirectory();
    const archive = join(parent, "book.zip");
    const destination = join(parent, "restored");
    await mkdir(destination);
    await mkdir(join(fixture.projectPath, "assets"), { recursive: true });
    await createProjectArchive({
      projectPath: fixture.projectPath,
      archivePath: archive,
    });
    const first = await restoreProjectArchive({
      archivePath: archive,
      destinationParent: destination,
    });
    const marker = join(first.projectPath, "keep.txt");
    await writeFile(marker, "preserve existing data");
    const second = await restoreProjectArchive({
      archivePath: archive,
      destinationParent: destination,
    });
    expect(second.projectPath).not.toBe(first.projectPath);
    expect(await readFile(marker, "utf8")).toBe("preserve existing data");
  });

  it("rejects corrupted, traversal and checksum-invalid archives without activating a project", async () => {
    const fixture = await unicodeFixture();
    const parent = await temporaryDirectory();
    const archive = join(parent, "book.zip");
    const destination = join(parent, "restored");
    await mkdir(destination);
    await createProjectArchive({
      projectPath: fixture.projectPath,
      archivePath: archive,
    });

    const items = await readZip(archive);
    const chapter = items.find(
      ({ name }) => name.startsWith("manuscript/") && name.endsWith(".json"),
    );
    expect(chapter).toBeDefined();
    chapter!.data = Buffer.from(
      chapter!.data.toString("utf8").replace("Bonjour", "BonjouX"),
      "utf8",
    );
    const checksumMismatch = join(parent, "checksum.zip");
    await writeZip(checksumMismatch, items);
    await expect(
      restoreProjectArchive({
        archivePath: checksumMismatch,
        destinationParent: destination,
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVE_CHECKSUM_INVALID" });

    const traversal = join(parent, "traversal.zip");
    const original = await readFile(archive);
    const name = Buffer.from("book.json");
    const replacement = Buffer.from("../evil.j");
    expect(replacement.length).toBe(name.length);
    const changed = Buffer.from(original);
    let cursor = 0;
    while ((cursor = changed.indexOf(name, cursor)) !== -1) {
      replacement.copy(changed, cursor);
      cursor += replacement.length;
    }
    await writeFile(traversal, changed);
    await expect(
      restoreProjectArchive({
        archivePath: traversal,
        destinationParent: destination,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(await readdir(parent)).not.toContain("evil.j");

    const corrupt = join(parent, "corrupt.zip");
    await writeFile(corrupt, "not a ZIP archive");
    await expect(
      restoreProjectArchive({
        archivePath: corrupt,
        destinationParent: destination,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(await readdir(destination)).toEqual([]);
  });

  it("rejects symbolic links in project content instead of following them", async () => {
    const fixture = await unicodeFixture();
    const parent = await temporaryDirectory();
    const outside = join(parent, "private.txt");
    await writeFile(outside, "must not be archived");
    const link = join(fixture.projectPath, "assets", "linked.txt");
    await mkdir(join(fixture.projectPath, "assets"), { recursive: true });
    try {
      await (await import("node:fs/promises")).symlink(outside, link);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      )
        return;
      throw error;
    }
    await expect(
      createProjectArchive({
        projectPath: fixture.projectPath,
        archivePath: join(parent, "book.zip"),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVE_SYMLINK" });
    expect(await readFile(outside, "utf8")).toBe("must not be archived");
  });

  it("rejects oversized archives, declared decompression bombs and destinations inside a project", async () => {
    const fixture = await unicodeFixture();
    const parent = await temporaryDirectory();
    const archive = join(parent, "book.zip");
    const destination = join(parent, "restored");
    await mkdir(destination);
    await mkdir(join(fixture.projectPath, "assets"), { recursive: true });
    await createProjectArchive({
      projectPath: fixture.projectPath,
      archivePath: archive,
    });

    await expect(
      restoreProjectArchive({
        archivePath: archive,
        destinationParent: join(fixture.projectPath, "assets"),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVE_DESTINATION_IN_PROJECT" });
    const originalManifest = await readFile(
      join(fixture.projectPath, "project.json"),
    );
    await expect(
      createProjectArchive({
        projectPath: fixture.projectPath,
        archivePath: join(fixture.projectPath, "backup.zip"),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVE_IN_PROJECT" });
    expect(await readFile(join(fixture.projectPath, "project.json"))).toEqual(
      originalManifest,
    );

    const items = await readZip(archive);
    const manifestEntry = items.find(
      ({ name }) => name === ".drelwick-archive.json",
    );
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(manifestEntry!.data.toString("utf8")) as {
      files: { size: number }[];
    };
    manifest.files[0]!.size = PROJECT_ARCHIVE_MAX_FILE_BYTES + 1;
    manifestEntry!.data = Buffer.from(JSON.stringify(manifest), "utf8");
    const bomb = join(parent, "oversized-manifest.zip");
    await writeZip(bomb, items);
    await expect(
      restoreProjectArchive({
        archivePath: bomb,
        destinationParent: destination,
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVE_TOO_LARGE" });

    const oversized = join(parent, "oversized.zip");
    await writeFile(oversized, "");
    await truncate(oversized, PROJECT_ARCHIVE_MAX_BYTES + 1);
    await expect(
      restoreProjectArchive({
        archivePath: oversized,
        destinationParent: destination,
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVE_TOO_LARGE" });
    expect(await readdir(destination)).toEqual([]);
  });
});
