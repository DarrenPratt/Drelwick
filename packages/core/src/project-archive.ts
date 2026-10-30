import { createHash, randomBytes, type Hash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Transform, type Readable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApplicationError, createIsoDate, isUuid } from "@drelwick/shared";
import {
  ProjectArchiveManifestSchema,
  type ProjectArchiveManifest,
} from "@drelwick/project-model";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { openProject } from "./index.js";
import { withReferenceLock } from "./reference-files.js";
import {
  assertReferenceBackupReady,
  referenceBackupDiagnostics,
} from "./references.js";

export const PROJECT_ARCHIVE_MANIFEST = ".drelwick-archive.json";
export const PROJECT_ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_FILE_BYTES = 512 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_FILES = 10000;
const ARCHIVE_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const knownProjectDirectories = new Set([
  "manuscript",
  "frontmatter",
  "backmatter",
  "assets",
  "reference",
  "editorial",
  "styles",
  ".editorial",
]);
const knownProjectRoots = new Set([
  "project.json",
  "book.json",
  "format.json",
  "presentation.json",
  "print.json",
  "publication.json",
  "cover.jpg",
]);
const excludedDirectoryNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "test-results",
  "playwright-report",
  ".cache",
  "cache",
]);
const excludedFileNames = new Set([
  ".chapter-summaries.json",
  ".chapter-create.lock",
  "credentials.json",
  "secrets.json",
]);

interface FileRecord {
  path: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  sha256?: string;
}

interface ZipEntryList extends Array<yauzl.Entry> {
  zip: yauzl.ZipFile;
}

/** Native backup review only; returned paths are local UI data, never log fields. */
export async function inspectReferenceBackup(
  projectPath: string,
): Promise<{ excludedPaths: string[]; unsupportedCount: number }> {
  return withReferenceLock(projectPath, async (root) => {
    const session = await openProject(
      root,
      {},
      { readFile, lstat, realpath, writeJson: async () => undefined },
    );
    await assertReferenceBackupReady(root, session.project.projectId);
    const excludedPaths: string[] = [];
    await collectProjectFiles(root, false, excludedPaths);
    return {
      excludedPaths,
      unsupportedCount: (
        await referenceBackupDiagnostics(root, session.project.projectId)
      ).length,
    };
  });
}

/** Capture a validated project revision as a portable, checksummed ZIP file. */
export async function createProjectArchive(input: {
  projectPath: string;
  archivePath: string;
  includeHistory?: boolean;
  approvedReferenceExclusions?: string[];
}): Promise<{ projectId: string; fileCount: number }> {
  return withReferenceLock(input.projectPath, (projectPath) =>
    createProjectArchiveLocked({ ...input, projectPath }),
  );
}
async function createProjectArchiveLocked(input: {
  projectPath: string;
  archivePath: string;
  includeHistory?: boolean;
  approvedReferenceExclusions?: string[];
}): Promise<{ projectId: string; fileCount: number }> {
  if (!isAbsolute(input.projectPath) || !isAbsolute(input.archivePath))
    throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");

  const projectRoot = await realProjectRoot(input.projectPath);
  const archivePath = resolve(input.archivePath);
  const archiveRelative = relative(projectRoot, archivePath);
  if (
    archiveRelative === "" ||
    (!archiveRelative.startsWith(`..${sep}`) &&
      archiveRelative !== ".." &&
      !isAbsolute(archiveRelative))
  )
    throw archiveError("PROJECT_ARCHIVE_IN_PROJECT");

  const opened = await openProject(
    projectRoot,
    {},
    {
      readFile: (path, encoding) => readFile(path, encoding),
      lstat,
      realpath,
      // Validation must not write/rebuild a disposable summary cache in the source.
      writeJson: async () => undefined,
    },
  );
  const includeHistory = input.includeHistory ?? true;
  await assertReferenceBackupReady(projectRoot, opened.project.projectId);
  const excludedReferences: string[] = [];
  const inventory = await collectProjectFiles(
    projectRoot,
    includeHistory,
    excludedReferences,
  );
  if (
    JSON.stringify(excludedReferences) !==
    JSON.stringify(input.approvedReferenceExclusions ?? [])
  )
    throw new ApplicationError(
      "REFERENCE_BACKUP_REVIEW_REQUIRED",
      "Review excluded reference files before creating the backup.",
    );
  if (inventory.length > PROJECT_ARCHIVE_MAX_FILES)
    throw archiveError("PROJECT_ARCHIVE_TOO_MANY_FILES");
  if (
    inventory.reduce((total, file) => total + file.size, 0) >
    PROJECT_ARCHIVE_MAX_UNPACKED_BYTES
  )
    throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");

  const stagingRoot = await mkdtemp(join(tmpdir(), "drelwick-backup-"));
  const archiveTemporary = `${archivePath}.drelwick-${randomBytes(8).toString("hex")}.tmp`;
  let archiveCreated = false;
  try {
    const files: ProjectArchiveManifest["files"] = [];
    for (const record of inventory) {
      if (record.size > PROJECT_ARCHIVE_MAX_FILE_BYTES)
        throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
      const source = resolve(projectRoot, ...record.path.split("/"));
      const staged = resolve(stagingRoot, ...record.path.split("/"));
      await mkdir(dirname(staged), { recursive: true });
      const hasher = createHash("sha256");
      const digesting = new HashTransform(hasher);
      await pipeline(
        createReadStream(source),
        digesting,
        createWriteStream(staged, { flags: "wx" }),
      );
      const after = await lstat(source);
      if (!sameFileRevision(record, after))
        throw archiveError("PROJECT_ARCHIVE_CHANGED");
      files.push({
        path: record.path,
        size: record.size,
        sha256: digesting.digest(),
      });
    }
    const currentExclusions: string[] = [];
    const currentInventory = await collectProjectFiles(
      projectRoot,
      includeHistory,
      currentExclusions,
    );
    if (
      !sameInventory(inventory, currentInventory) ||
      JSON.stringify(currentExclusions) !== JSON.stringify(excludedReferences)
    )
      throw archiveError("PROJECT_ARCHIVE_CHANGED");

    const manifest = ProjectArchiveManifestSchema.parse({
      schemaVersion: 1,
      projectId: opened.project.projectId,
      created: createIsoDate(),
      includesHistory: includeHistory,
      files,
    });
    await writeFile(
      join(stagingRoot, PROJECT_ARCHIVE_MANIFEST),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx", encoding: "utf8" },
    );
    const zip = new yazl.ZipFile();
    for (const record of files)
      zip.addFile(
        resolve(stagingRoot, ...record.path.split("/")),
        record.path,
        { mtime: new Date("2000-01-01T00:00:00.000Z"), mode: 0o100644 },
      );
    zip.addFile(
      join(stagingRoot, PROJECT_ARCHIVE_MANIFEST),
      PROJECT_ARCHIVE_MANIFEST,
      { mtime: new Date("2000-01-01T00:00:00.000Z"), mode: 0o100644 },
    );
    const output = createWriteStream(archiveTemporary, { flags: "wx" });
    const written = pipeline(zip.outputStream as Readable, output);
    zip.end();
    await written;
    const latestInventory = await collectProjectFiles(
      projectRoot,
      includeHistory,
    );
    if (!sameInventory(inventory, latestInventory))
      throw archiveError("PROJECT_ARCHIVE_CHANGED");
    const archiveStats = await stat(archiveTemporary);
    if (archiveStats.size > PROJECT_ARCHIVE_MAX_BYTES)
      throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
    await rename(archiveTemporary, archivePath);
    archiveCreated = true;
    return { projectId: opened.project.projectId, fileCount: files.length };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw mapArchiveIoError(error, "PROJECT_ARCHIVE_CREATE_FAILED");
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
    if (!archiveCreated)
      await rm(archiveTemporary, { force: true }).catch(() => undefined);
  }
}

/** Validate and extract a project into a new collision-free child of the chosen parent. */
export async function restoreProjectArchive(input: {
  archivePath: string;
  destinationParent: string;
}): Promise<{ projectId: string; projectPath: string; title: string }> {
  if (!isAbsolute(input.archivePath) || !isAbsolute(input.destinationParent))
    throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
  const archiveLinkStats = await lstat(input.archivePath).catch(
    (error: unknown) => {
      throw mapArchiveIoError(error, "PROJECT_ARCHIVE_READ_FAILED");
    },
  );
  if (!archiveLinkStats.isFile() || archiveLinkStats.isSymbolicLink())
    throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
  const archiveStats = await stat(input.archivePath);
  if (archiveStats.size <= 0 || archiveStats.size > PROJECT_ARCHIVE_MAX_BYTES)
    throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
  const parent = await realProjectRoot(input.destinationParent);
  await rejectProjectDestination(parent);
  const stage = await mkdtemp(join(parent, ".drelwick-restore-"));
  let openedZip: yauzl.ZipFile | undefined;
  try {
    const entries = await readZipEntries(input.archivePath);
    openedZip = entries.zip;
    const validated = validateZipEntries(entries);
    const manifestEntry = validated.files.get(PROJECT_ARCHIVE_MANIFEST);
    if (
      !manifestEntry ||
      manifestEntry.uncompressedSize > ARCHIVE_MANIFEST_MAX_BYTES
    )
      throw archiveError("PROJECT_ARCHIVE_INVALID");
    const manifestBuffer = await readEntryBuffer(
      validated.zip,
      manifestEntry,
      ARCHIVE_MANIFEST_MAX_BYTES,
    );
    let manifest: ProjectArchiveManifest;
    try {
      manifest = ProjectArchiveManifestSchema.parse(
        JSON.parse(manifestBuffer.toString("utf8")) as unknown,
      );
    } catch {
      throw archiveError("PROJECT_ARCHIVE_INVALID");
    }
    validateManifest(manifest, validated.files);
    for (const record of manifest.files) {
      const entry = validated.files.get(record.path);
      if (!entry || entry.uncompressedSize !== record.size)
        throw archiveError("PROJECT_ARCHIVE_INVALID");
      const target = resolve(stage, ...record.path.split("/"));
      if (!isPathWithin(stage, target))
        throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
      await mkdir(dirname(target), { recursive: true });
      const readStream = await readEntryStream(validated.zip, entry);
      const hasher = createHash("sha256");
      const digesting = new HashTransform(hasher);
      await pipeline(
        readStream,
        digesting,
        createWriteStream(target, { flags: "wx", mode: 0o600 }),
      );
      if (
        digesting.bytes !== record.size ||
        digesting.digest() !== record.sha256
      )
        throw archiveError("PROJECT_ARCHIVE_CHECKSUM_INVALID");
    }
    for (const directory of [
      "manuscript",
      "frontmatter",
      "backmatter",
      "assets",
      "reference",
      "styles",
      ...(manifest.includesHistory ? [".history"] : []),
    ])
      await mkdir(join(stage, directory), { recursive: true });
    const opened = await openProject(stage);
    if (opened.project.projectId !== manifest.projectId)
      throw archiveError("PROJECT_ARCHIVE_INVALID");
    const destinationName = portableDirectoryName(opened.book.title);
    const target = await uniqueDestination(parent, destinationName);
    await rename(stage, target);
    return {
      projectId: opened.project.projectId,
      projectPath: target,
      title: opened.book.title,
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw mapArchiveIoError(error, "PROJECT_ARCHIVE_RESTORE_FAILED");
  } finally {
    openedZip?.close();
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function realProjectRoot(path: string): Promise<string> {
  try {
    const result = await realpath(path);
    const info = await lstat(result);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("unsafe");
    return result;
  } catch {
    throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
  }
}

async function rejectProjectDestination(parent: string): Promise<void> {
  let directory = parent;
  while (true) {
    try {
      const info = await lstat(join(directory, "project.json"));
      if (info.isFile() && !info.isSymbolicLink())
        throw archiveError("PROJECT_ARCHIVE_DESTINATION_IN_PROJECT");
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (!isMissing(error))
        throw mapArchiveIoError(error, "PROJECT_ARCHIVE_PATH_INVALID");
    }
    const parentDirectory = dirname(directory);
    if (parentDirectory === directory) return;
    directory = parentDirectory;
  }
}

async function collectProjectFiles(
  root: string,
  includeHistory: boolean,
  excludedReferences: string[] = [],
): Promise<FileRecord[]> {
  const records: FileRecord[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    const directory = relativeDirectory
      ? join(root, ...relativeDirectory.split("/"))
      : root;
    const names = await readdir(directory);
    names.sort((left, right) => left.localeCompare(right, "en"));
    for (const name of names) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      // Retained managed evidence is an exact inventory: basename filters must
      // not remove a before image, draft component or verified safety-copy byte.
      const evidence = isEditorialEvidencePath(relativePath);
      if (!evidence && shouldExcludeName(name, false)) {
        if (relativePath.startsWith("reference/")) {
          if (name.toLowerCase().endsWith(".tmp"))
            throw new ApplicationError(
              "REFERENCE_RECOVERY_REQUIRED",
              "Resolve reference temporary files before backup.",
            );
          excludedReferences.push(relativePath);
        }
        continue;
      }
      if (!isAllowedProjectPath(relativePath, includeHistory, true)) continue;
      const path = join(root, ...relativePath.split("/"));
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw archiveError("PROJECT_ARCHIVE_SYMLINK");
      if (info.isDirectory()) {
        if (!evidence && shouldExcludeName(name, true)) {
          if (relativePath.startsWith("reference/"))
            excludedReferences.push(relativePath);
          continue;
        }
        await visit(relativePath);
      } else if (info.isFile()) {
        records.push({
          path: relativePath,
          size: info.size,
          mtimeMs: info.mtimeMs,
          ctimeMs: info.ctimeMs,
        });
      } else throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
    }
  };
  await visit("");
  records.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return records;
}

function isEditorialEvidencePath(path: string): boolean {
  return [
    ".editorial/transactions/",
    ".editorial/drafts/",
    ".editorial/migration-backups/",
  ].some((prefix) => path.startsWith(prefix));
}

function shouldExcludeName(name: string, directory: boolean): boolean {
  const lower = name.toLowerCase();
  if (directory && excludedDirectoryNames.has(lower)) return true;
  return (
    excludedFileNames.has(lower) ||
    lower === PROJECT_ARCHIVE_MANIFEST ||
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower.endsWith(".tmp") ||
    lower.endsWith(".lock") ||
    lower.endsWith(".log") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx")
  );
}

function isAllowedProjectPath(
  path: string,
  includeHistory: boolean,
  allowDirectoryRoots = false,
): boolean {
  const segments = path.split("/");
  if (segments.some((part) => part === "" || part === "." || part === ".."))
    return false;
  if (segments[0] === ".history")
    return includeHistory && (segments.length > 1 || allowDirectoryRoots);
  return (
    knownProjectRoots.has(path) ||
    (knownProjectDirectories.has(segments[0] ?? "") &&
      (segments.length > 1 || allowDirectoryRoots))
  );
}

function sameFileRevision(
  record: FileRecord,
  info: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    info.isFile() &&
    !info.isSymbolicLink() &&
    info.size === record.size &&
    info.mtimeMs === record.mtimeMs &&
    info.ctimeMs === record.ctimeMs
  );
}

function sameInventory(left: FileRecord[], right: FileRecord[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        item.path === other.path &&
        item.size === other.size &&
        item.mtimeMs === other.mtimeMs &&
        item.ctimeMs === other.ctimeMs
      );
    })
  );
}

function isPathWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function validateZipEntries(entries: ZipEntryList): {
  zip: yauzl.ZipFile;
  files: Map<string, yauzl.Entry>;
} {
  const zip = entries.zip;
  const files = new Map<string, yauzl.Entry>();
  const foldedNames = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const name = entry.fileName;
    if (!isSafeArchiveName(name))
      throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0o170000;
    if (
      (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) ||
      (entry.externalFileAttributes & 0x400) !== 0
    )
      throw archiveError("PROJECT_ARCHIVE_SYMLINK");
    if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod))
      throw archiveError("PROJECT_ARCHIVE_INVALID");
    if (name.endsWith("/")) continue;
    const foldedName = name.normalize("NFC").toLowerCase();
    if (files.has(name) || foldedNames.has(foldedName))
      throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
    if (files.size >= PROJECT_ARCHIVE_MAX_FILES + 1)
      throw archiveError("PROJECT_ARCHIVE_TOO_MANY_FILES");
    if (entry.uncompressedSize > PROJECT_ARCHIVE_MAX_FILE_BYTES)
      throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
    foldedNames.add(foldedName);
    total += entry.uncompressedSize;
    if (total > PROJECT_ARCHIVE_MAX_UNPACKED_BYTES)
      throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
    files.set(name, entry);
  }
  return { zip, files };
}

function isSafeArchiveName(name: string): boolean {
  if (
    !name ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name) ||
    name.startsWith("//")
  )
    return false;
  const clean = name.endsWith("/") ? name.slice(0, -1) : name;
  const parts = clean.split("/");
  return parts.every(
    (part) =>
      part.length > 0 &&
      part !== "." &&
      part !== ".." &&
      !part.includes(":") &&
      !/[. ]$/.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
  );
}

function validateManifest(
  manifest: ProjectArchiveManifest,
  entries: Map<string, yauzl.Entry>,
): void {
  if (
    !isUuid(manifest.projectId) ||
    entries.size !== manifest.files.length + 1 ||
    !entries.has(PROJECT_ARCHIVE_MANIFEST)
  )
    throw archiveError("PROJECT_ARCHIVE_INVALID");
  const seen = new Set<string>();
  let total = 0;
  for (const file of manifest.files) {
    if (
      !isSafeArchiveName(file.path) ||
      file.path.endsWith("/") ||
      !isAllowedProjectPath(file.path, manifest.includesHistory) ||
      (!isEditorialEvidencePath(file.path) &&
        shouldExcludeName(basename(file.path), false)) ||
      seen.has(file.path)
    )
      throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
    seen.add(file.path);
    total += file.size;
    if (
      file.size > PROJECT_ARCHIVE_MAX_FILE_BYTES ||
      total > PROJECT_ARCHIVE_MAX_UNPACKED_BYTES
    )
      throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
  }
  for (const file of seen) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1)
      if (seen.has(parts.slice(0, index).join("/")))
        throw archiveError("PROJECT_ARCHIVE_PATH_INVALID");
  }
  if (
    !seen.has("project.json") ||
    !seen.has("book.json") ||
    seen.size !== entries.size - 1
  )
    throw archiveError("PROJECT_ARCHIVE_INVALID");
  for (const name of entries.keys())
    if (name !== PROJECT_ARCHIVE_MANIFEST && !seen.has(name))
      throw archiveError("PROJECT_ARCHIVE_INVALID");
}

async function readZipEntries(path: string): Promise<ZipEntryList> {
  const zip = await new Promise<yauzl.ZipFile>((resolveZip, reject) => {
    yauzl.open(
      path,
      {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, opened) => {
        if (error || !opened) reject(error ?? new Error("invalid ZIP"));
        else resolveZip(opened);
      },
    );
  });
  if (zip.entryCount > PROJECT_ARCHIVE_MAX_FILES + 100) {
    zip.close();
    throw archiveError("PROJECT_ARCHIVE_TOO_MANY_FILES");
  }
  const entries: yauzl.Entry[] = [];
  return await new Promise((resolveEntries, reject) => {
    zip.on("error", (error) => {
      zip.close();
      reject(error);
    });
    zip.on("entry", (entry: yauzl.Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on("end", () => {
      Object.defineProperty(entries, "zip", { value: zip });
      resolveEntries(entries as ZipEntryList);
    });
    zip.readEntry();
  });
}

function readEntryStream(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("invalid ZIP entry"));
      else resolveStream(stream);
    });
  });
}

async function readEntryBuffer(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  maxBytes: number,
): Promise<Buffer> {
  if (entry.uncompressedSize > maxBytes)
    throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
  const stream = await readEntryStream(zip, entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > maxBytes) throw archiveError("PROJECT_ARCHIVE_TOO_LARGE");
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

async function uniqueDestination(
  parent: string,
  name: string,
): Promise<string> {
  for (let index = 1; index < 10000; index += 1) {
    const candidateName = index === 1 ? name : `${name} (${index})`;
    const candidate = join(parent, candidateName);
    try {
      await lstat(candidate);
    } catch (error) {
      if (isMissing(error)) return candidate;
      throw mapArchiveIoError(error, "PROJECT_ARCHIVE_RESTORE_FAILED");
    }
  }
  throw archiveError("PROJECT_ARCHIVE_DESTINATION_EXISTS");
}

function portableDirectoryName(title: string): string {
  const clean = [...title]
    .map((character) =>
      /[<>:"/\\|?*]/.test(character) || character.charCodeAt(0) < 32
        ? " "
        : character,
    )
    .join("")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .replace(/[. ]+$/g, "");
  if (!clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))
    return "Restored Book";
  return clean;
}

class HashTransform extends Transform {
  bytes = 0;
  private finishedDigest?: string;
  constructor(private readonly hash: Hash) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytes += chunk.length;
    this.hash.update(chunk);
    callback(null, chunk);
  }
  digest(): string {
    if (!this.finishedDigest) this.finishedDigest = this.hash.digest("hex");
    return this.finishedDigest;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function mapArchiveIoError(error: unknown, fallback: string): ApplicationError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOSPC"
  )
    return archiveError("PROJECT_ARCHIVE_DISK_SPACE");
  return archiveError(fallback);
}

function archiveError(code: string): ApplicationError {
  const messages: Record<string, string> = {
    PROJECT_ARCHIVE_PATH_INVALID:
      "Choose an accessible local folder and backup location.",
    PROJECT_ARCHIVE_IN_PROJECT:
      "Choose a backup location outside the open project folder.",
    PROJECT_ARCHIVE_SYMLINK:
      "The project or archive contains a symbolic link. Remove it and try again.",
    PROJECT_ARCHIVE_CHANGED:
      "The project changed while the backup was being created. Save and try again.",
    PROJECT_ARCHIVE_TOO_LARGE:
      "The project or backup archive exceeds the supported size limits.",
    PROJECT_ARCHIVE_TOO_MANY_FILES:
      "The project contains more files than the backup format supports.",
    PROJECT_ARCHIVE_INVALID:
      "This file is not a valid Drelwick project backup.",
    PROJECT_ARCHIVE_CHECKSUM_INVALID:
      "A file in the backup failed its integrity check. No project was restored.",
    PROJECT_ARCHIVE_DISK_SPACE:
      "There is not enough disk space to complete this backup or restore. Free space and try again.",
    PROJECT_ARCHIVE_DESTINATION_EXISTS:
      "A restored project with this name already exists too many times. Choose another parent folder.",
    PROJECT_ARCHIVE_READ_FAILED:
      "Unable to read the selected backup. Check its location and try again.",
    PROJECT_ARCHIVE_CREATE_FAILED:
      "Unable to create the backup. Check folder permissions and available disk space.",
    PROJECT_ARCHIVE_RESTORE_FAILED:
      "Unable to restore the backup. Check folder permissions and available disk space; the existing project was not replaced.",
    PROJECT_ARCHIVE_DESTINATION_IN_PROJECT:
      "Choose a restore location outside all existing Drelwick project folders.",
  };
  return new ApplicationError(
    code,
    messages[code] ?? "Unable to process the project backup.",
  );
}
