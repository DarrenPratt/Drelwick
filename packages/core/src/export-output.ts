import { randomUUID } from "node:crypto";
import {
  dirname,
  extname,
  basename,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";
import { lstat, open, rename, link, unlink, realpath } from "node:fs/promises";
import { regularPath } from "./image-assets.js";
import { ApplicationError } from "@drelwick/shared";

export interface ExportDestination {
  path: string;
  existing: string | null;
}
const error = (code: string, message: string) =>
  new ApplicationError(code, message);
const identity = async (path: string): Promise<string | null> => {
  try {
    await regularPath(path);
    const stat = await lstat(path, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (value) {
    if (
      value &&
      typeof value === "object" &&
      "code" in value &&
      value.code === "ENOENT"
    )
      return null;
    throw value;
  }
};
const invalid = (format: "epub" | "pdf") =>
  error(
    `${format.toUpperCase()}_EXPORT_DESTINATION`,
    `Choose an accessible .${format} file outside all Drelwick project folders.`,
  );

export async function inspectExportDestination(
  path: string,
  projectPath: string,
  format: "epub" | "pdf",
): Promise<ExportDestination> {
  try {
    if (
      !isAbsolute(path) ||
      extname(path).toLowerCase() !== `.${format}` ||
      /[. ]$/.test(path) ||
      path.includes("\0")
    )
      throw invalid(format);
    await regularPath(dirname(path), true);
    const name = basename(path);
    if (
      /[<>:"|?*]/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    )
      throw invalid(format);
    const parent = await realpath(dirname(path));
    const root = await realpath(projectPath);
    const inside = relative(root, parent);
    if (
      !inside ||
      (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))
    )
      throw invalid(format);
    let ancestor = parent;
    while (true) {
      try {
        await lstat(join(ancestor, "project.json"));
        throw invalid(format);
      } catch (value) {
        if (!(
          value &&
          typeof value === "object" &&
          "code" in value &&
          value.code === "ENOENT"
        ))
          throw value;
      }
      const next = dirname(ancestor);
      if (next === ancestor) break;
      ancestor = next;
    }
    const canonical = join(parent, name);
    return { path: canonical, existing: await identity(canonical) };
  } catch {
    throw invalid(format);
  }
}

export async function writeExportAtomically(
  destination: ExportDestination,
  bytes: Uint8Array,
  options: {
    format: "epub" | "pdf";
    overwrite: boolean;
    validate?: (bytes: Uint8Array) => Promise<void>;
    signal?: AbortSignal;
    checkpoint?: (phase: "written" | "commit") => Promise<void>;
  },
): Promise<{ cleanupWarning: boolean }> {
  const format = options.format;
  const prefix = `${format.toUpperCase()}_EXPORT_`;
  const temporary = join(
    dirname(destination.path),
    `.drelwick-${format}-${randomUUID()}.tmp`,
  );
  let owned = false;
  let committed = false;
  let cleanupWarning = false;
  let failure: unknown;
  const check = () => {
    if (options.signal?.aborted)
      throw error(
        `${prefix}CANCELLED`,
        "Export was cancelled before writing the destination.",
      );
  };
  try {
    check();
    if (destination.existing !== null && !options.overwrite)
      throw error(
        `${prefix}OVERWRITE`,
        "The existing file was not approved for replacement.",
      );
    await regularPath(dirname(destination.path), true);
    const handle = await open(temporary, "wx+", 0o600);
    owned = true;
    try {
      await handle.writeFile(bytes);
      await options.checkpoint?.("written");
      await handle.sync();
      if (options.validate) {
        const staged = new Uint8Array(bytes.length);
        let bytesRead = 0;
        while (bytesRead < staged.length) {
          const read = await handle.read(
            staged,
            bytesRead,
            staged.length - bytesRead,
            bytesRead,
          );
          if (!read.bytesRead) break;
          bytesRead += read.bytesRead;
        }
        if (
          bytesRead !== bytes.length ||
          (await handle.stat()).size !== bytes.length ||
          !Buffer.from(staged).equals(Buffer.from(bytes))
        )
          throw new Error("Staged output verification failed");
        await options.validate(staged);
      }
    } finally {
      await handle.close();
    }
    check();
    await options.checkpoint?.("commit");
    check();
    await regularPath(dirname(destination.path), true);
    if ((await identity(destination.path)) !== destination.existing)
      throw error(
        `${prefix}CHANGED`,
        "The destination changed after selection. Select it again.",
      );
    check();
    // New destinations use atomic no-clobber publication; rename replaces only
    // an explicitly approved existing file, following the existing export policy.
    if (destination.existing === null) await link(temporary, destination.path);
    else await rename(temporary, destination.path);
    committed = true;
  } catch (value) {
    failure =
      value instanceof ApplicationError && value.code.startsWith(prefix)
        ? value
        : error(
            `${prefix}WRITE`,
            "Unable to write export. Check permissions and disk space. The previous destination and project were preserved.",
          );
  } finally {
    if (owned) {
      try {
        await unlink(temporary);
      } catch (value) {
        if (!(
          value &&
          typeof value === "object" &&
          "code" in value &&
          value.code === "ENOENT"
        )) {
          if (committed) cleanupWarning = true;
          else
            failure = error(
              `${prefix}CLEANUP`,
              "Export failed and temporary output could not be removed. Check the destination folder for .drelwick temporary files.",
            );
        }
      }
    }
  }
  if (failure) throw failure;
  return { cleanupWarning };
}
