import { randomUUID, createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  link,
  realpath,
} from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { tmpdir } from "node:os";
import { ApplicationError } from "@sarel/shared";
import {
  IMPORT_LIMITS,
  validateImportedManuscript,
  ChapterFileSchema,
  BookMetadataSchema,
  ImageAssetSchema,
  type ValidatedManuscript,
} from "@sarel/project-model";
import {
  boundedRead,
  regularPath,
  validateImageContent,
} from "./image-assets.js";
import {
  createProject,
  writeJsonAtomically,
  validateProjectFiles,
  PROJECT_DIRECTORIES,
} from "./index.js";
import { syncDirectory } from "./project-snapshot.js";

/** First-party adapters only. No source path, filesystem, process or network capability.
 * Return bounded serialized JSON; never run source code, resolve external resources,
 * entities or macros. Format-specific parsers are supplied by subsequent issues.
 */
export interface ManuscriptImporter {
  parse(source: Uint8Array, signal: AbortSignal): Promise<string>;
}
export interface ImportOptions {
  signal: AbortSignal;
  /** Privileged temporary-root override for isolated filesystem tests. */
  temporaryRoot?: string;
  /** Filesystem failure injection; privileged callers only. */
  writeBytes?: typeof writeBytes;
  writeJson?: typeof writeJsonAtomically;
  remove?: (path: string) => Promise<void>;
  /** Deterministic fault injection, never exposed through IPC. */
  checkpoint?: (
    phase: "parsed" | "staging" | "staged" | "writing" | "before-commit",
  ) => Promise<void>;
}
export function importError(code = "IMPORT_FAILED") {
  return new ApplicationError(
    code,
    code === "IMPORT_CLEANUP_REQUIRED"
      ? "Import stopped, but temporary import data could not be removed. Preserve the interrupted folder and retry in a new empty destination. Source and active project were preserved."
      : code === "IMPORT_CANCELLED"
        ? "Import cancelled. Source and active project were preserved."
        : "Import could not complete. Source and active project were preserved. Check the selected folders and import limits before retrying.",
  );
}
const removeImportPath = (path: string) =>
  rm(path, { recursive: true, force: true });
function check(signal: AbortSignal) {
  if (signal.aborted) throw importError("IMPORT_CANCELLED");
}
async function checkpoint(
  options: ImportOptions,
  phase: Parameters<NonNullable<ImportOptions["checkpoint"]>>[0],
) {
  check(options.signal);
  await options.checkpoint?.(phase);
  check(options.signal);
}
async function writeBytes(path: string, bytes: Uint8Array) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function validateAssets(value: ValidatedManuscript, signal: AbortSignal) {
  let size = 0;
  for (const asset of value.assets) {
    check(signal);
    const bytes = Buffer.from(asset.base64, "base64");
    size += bytes.length;
    if (
      size > IMPORT_LIMITS.stagedBytes ||
      bytes.toString("base64") !== asset.base64
    )
      throw importError("IMPORT_INVALID");
    await validateImageContent(
      bytes,
      asset.mediaType === "image/png" ? "original.png" : "original.jpg",
    );
  }
  check(signal);
}

/** Owns one private stage. Paths never enter the inspection result. */
export class StagedManuscriptImport {
  private used = false;
  private constructor(
    private readonly root: string,
    private readonly digest: string,
    readonly preview: ValidatedManuscript,
    private readonly signal: AbortSignal,
    private readonly remove: (path: string) => Promise<void>,
  ) {}

  static async inspect(
    sourcePath: string,
    importer: ManuscriptImporter,
    options: ImportOptions,
  ): Promise<StagedManuscriptImport> {
    let root: string | undefined;
    try {
      check(options.signal);
      const source = await boundedRead(sourcePath, IMPORT_LIMITS.sourceBytes);
      check(options.signal);
      const serialized = await importer.parse(source, options.signal);
      await checkpoint(options, "parsed");
      const value = validateImportedManuscript(serialized);
      await validateAssets(value, options.signal);
      const bytes = Buffer.from(
        JSON.stringify({ schemaVersion: 1, manuscript: value }),
      );
      if (bytes.length > IMPORT_LIMITS.stagedBytes)
        throw importError("IMPORT_INVALID");
      // The OS temp location can use a system alias (for example /var on macOS).
      // Canonicalize only this application-selected root, never picker paths.
      const temporaryRoot = options.temporaryRoot ?? (await realpath(tmpdir()));
      await regularPath(temporaryRoot, true);
      root = await mkdtemp(join(temporaryRoot, "sarel-manuscript-import-"));
      await checkpoint(options, "staging");
      await (options.writeBytes ?? writeBytes)(
        join(root, "manuscript.json"),
        bytes,
      );
      await syncDirectory(root);
      await checkpoint(options, "staged");
      return new StagedManuscriptImport(
        root,
        createHash("sha256").update(bytes).digest("hex"),
        value,
        options.signal,
        options.remove ?? removeImportPath,
      );
    } catch (error) {
      if (root) {
        try {
          await (options.remove ?? removeImportPath)(root);
        } catch {
          throw importError("IMPORT_CLEANUP_REQUIRED");
        }
      }
      throw importError(
        options.signal.aborted
          ? "IMPORT_CANCELLED"
          : error instanceof ApplicationError && error.code === "IMPORT_INVALID"
            ? "IMPORT_INVALID"
            : "IMPORT_FAILED",
      );
    }
  }

  async discard(): Promise<void> {
    this.used = true;
    try {
      await regularPath(this.root, true);
      await this.remove(this.root);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw importError("IMPORT_CLEANUP_REQUIRED");
    }
  }

  /** Main authorizes the selected empty folder; core rejects unsafe paths and project descendants. */
  async commit(
    destination: string,
    options: ImportOptions,
  ): Promise<{ projectId: string; warning?: string }> {
    if (this.used) throw importError("IMPORT_EXPIRED");
    this.used = true;
    options = {
      ...options,
      signal: AbortSignal.any([this.signal, options.signal]),
    };
    const remove = options.remove ?? this.remove;
    let stage: string | undefined;
    let projectId = "";
    const published: string[] = [];
    try {
      check(options.signal);
      await regularPath(destination, true);
      for (let parent = destination; ; parent = dirname(parent)) {
        try {
          await lstat(join(parent, "project.json"));
          throw importError("IMPORT_DESTINATION_INVALID");
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        }
        if (parent === parse(parent).root) break;
      }
      if ((await readdir(destination)).length)
        throw importError("IMPORT_DESTINATION_INVALID");
      const bytes = await boundedRead(
        join(this.root, "manuscript.json"),
        IMPORT_LIMITS.stagedBytes,
      );
      if (createHash("sha256").update(bytes).digest("hex") !== this.digest)
        throw importError("IMPORT_INVALID");
      const staged: unknown = JSON.parse(bytes.toString("utf8"));
      if (
        !staged ||
        typeof staged !== "object" ||
        !("schemaVersion" in staged) ||
        staged.schemaVersion !== 1 ||
        !("manuscript" in staged)
      )
        throw importError("IMPORT_INVALID");
      const value = validateImportedManuscript(
        JSON.stringify(staged.manuscript),
      );
      await validateAssets(value, options.signal);
      // A stage inside the destination keeps all subsequent renames on one filesystem.
      stage = join(destination, `.sarel-import-${randomUUID()}`);
      await mkdir(stage);
      const project = await createProject({
        ...value.metadata,
        projectPath: stage,
      });
      projectId = project.project.projectId;
      let stagedBytes = 0;
      for (const name of ["project.json", "book.json", "format.json"])
        stagedBytes += (await lstat(join(stage, name))).size;
      const reserve = (bytes: number) => {
        stagedBytes += bytes;
        if (stagedBytes > IMPORT_LIMITS.stagedBytes)
          throw importError("IMPORT_INVALID");
      };
      const writeProjectJson: typeof writeJsonAtomically = async (
        path,
        value,
      ) => {
        reserve(Buffer.byteLength(JSON.stringify(value, null, 2)) + 1);
        await (options.writeJson ?? writeJsonAtomically)(path, value);
      };
      const timestamp = project.project.created;
      const order: string[] = [];
      for (const chapter of value.chapters) {
        await checkpoint(options, "writing");
        const id = randomUUID();
        order.push(id);
        await writeProjectJson(
          join(stage, "manuscript", `${id}.json`),
          ChapterFileSchema.parse({
            ...chapter,
            id,
            status: "draft",
            schemaVersion: 1,
            created: timestamp,
            modified: timestamp,
          }),
        );
      }
      if (value.assets.length) await mkdir(join(stage, "assets", "images"));
      for (const asset of value.assets) {
        check(options.signal);
        const bytes = Buffer.from(asset.base64, "base64");
        const filename =
          asset.mediaType === "image/png" ? "original.png" : "original.jpg";
        const dimensions = await validateImageContent(bytes, filename);
        const root = join(stage, "assets", "images", asset.id);
        await mkdir(root);
        reserve(bytes.length);
        await writeBytes(join(root, filename), bytes);
        await writeProjectJson(
          join(root, "asset.json"),
          ImageAssetSchema.parse({
            schemaVersion: 1,
            id: asset.id,
            ...dimensions,
            originalFilename: filename,
            byteSize: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          }),
        );
        await syncDirectory(root);
      }
      if (value.assets.length)
        await syncDirectory(join(stage, "assets", "images"));
      await writeProjectJson(
        join(stage, "book.json"),
        BookMetadataSchema.parse({ ...project.book, ...value.metadata }),
      );
      await writeProjectJson(join(stage, "project.json"), {
        ...project.project,
        manuscript: { order },
      });
      await validateProjectFiles(stage);
      for (const name of PROJECT_DIRECTORIES)
        await syncDirectory(join(stage, name));
      await syncDirectory(stage);
      const stageName = basename(stage);
      const destinationEntries = await readdir(destination);
      if (
        destinationEntries.length !== 1 ||
        destinationEntries[0] !== stageName
      )
        throw importError("IMPORT_DESTINATION_INVALID");
      // Publish supporting data first. No authoritative manifest exists on failure/crash.
      for (const name of [...PROJECT_DIRECTORIES, "book.json", "format.json"]) {
        check(options.signal);
        const target = join(destination, name);
        if (
          PROJECT_DIRECTORIES.includes(
            name as (typeof PROJECT_DIRECTORIES)[number],
          )
        ) {
          // Claim each target exclusively before moving children; never replace an external directory.
          await mkdir(target);
          published.push(target);
          for (const child of await readdir(join(stage, name)))
            await rename(join(stage, name, child), join(target, child));
          await syncDirectory(target);
        } else {
          await link(join(stage, name), target);
          published.push(target);
        }
      }
      await syncDirectory(destination);
      await checkpoint(options, "before-commit");
      const expected = new Set<string>([
        stageName,
        ...PROJECT_DIRECTORIES,
        "book.json",
        "format.json",
      ]);
      const finalEntries = await readdir(destination);
      if (
        finalEntries.length !== expected.size ||
        finalEntries.some((entry) => !expected.has(entry))
      )
        throw importError("IMPORT_DESTINATION_INVALID");
      check(options.signal);
      // Final exclusive publication is the commit linearization point. Cancellation
      // after this point cannot undo a complete project and returns success.
      await link(
        join(stage, "project.json"),
        join(destination, "project.json"),
      );
    } catch (error) {
      let cleanupFailed = false;
      for (const path of published.reverse())
        await remove(path).catch(() => {
          cleanupFailed = true;
        });
      if (stage)
        await remove(stage).catch(() => {
          cleanupFailed = true;
        });
      await this.discard().catch(() => {
        cleanupFailed = true;
      });
      throw importError(
        cleanupFailed
          ? "IMPORT_CLEANUP_REQUIRED"
          : options.signal.aborted
            ? "IMPORT_CANCELLED"
            : error instanceof ApplicationError
              ? error.code
              : "IMPORT_FAILED",
      );
    }
    // Cleanup must never turn a completed publication into a reported failure.
    let cleanupFailed = false;
    await syncDirectory(destination).catch(() => {
      cleanupFailed = true;
    });
    if (stage)
      await remove(stage).catch(() => {
        cleanupFailed = true;
      });
    await this.discard().catch(() => {
      cleanupFailed = true;
    });
    return {
      projectId,
      ...(cleanupFailed
        ? {
            warning:
              "The project was created, but import cleanup or directory flushing could not finish. Preserve the project and inspect retained staging before removing it.",
          }
        : {}),
    };
  }
}
