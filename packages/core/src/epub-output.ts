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

export interface EpubDestination {
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
const invalid = () =>
  error(
    "EPUB_EXPORT_DESTINATION",
    "Choose an accessible .epub file outside all Drelwick project folders.",
  );

export async function inspectEpubDestination(
  path: string,
  projectPath: string,
): Promise<EpubDestination> {
  try {
    if (
      !isAbsolute(path) ||
      extname(path).toLowerCase() !== ".epub" ||
      /[. ]$/.test(path) ||
      path.includes("\0")
    )
      throw invalid();
    await regularPath(dirname(path), true);
    const name = basename(path);
    if (
      /[<>:"|?*]/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    )
      throw invalid();
    const parent = await realpath(dirname(path));
    const root = await realpath(projectPath);
    const inside = relative(root, parent);
    if (
      !inside ||
      (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))
    )
      throw invalid();
    let ancestor = parent;
    while (true) {
      try {
        await lstat(join(ancestor, "project.json"));
        throw invalid();
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
    throw invalid();
  }
}

export async function writeEpubAtomically(
  destination: EpubDestination,
  bytes: Uint8Array,
  options: {
    overwrite: boolean;
    signal?: AbortSignal;
    checkpoint?: (phase: "written" | "commit") => Promise<void>;
  },
): Promise<{ cleanupWarning: boolean }> {
  const temporary = join(
    dirname(destination.path),
    `.drelwick-epub-${randomUUID()}.tmp`,
  );
  let owned = false;
  let committed = false;
  let cleanupWarning = false;
  let failure: unknown;
  const check = () => {
    if (options.signal?.aborted)
      throw error(
        "EPUB_EXPORT_CANCELLED",
        "EPUB export was cancelled before writing the destination.",
      );
  };
  try {
    check();
    if (destination.existing !== null && !options.overwrite)
      throw error(
        "EPUB_EXPORT_OVERWRITE",
        "The existing EPUB was not approved for replacement.",
      );
    await regularPath(dirname(destination.path), true);
    const handle = await open(temporary, "wx", 0o600);
    owned = true;
    try {
      await handle.writeFile(bytes);
      await options.checkpoint?.("written");
      await handle.sync();
    } finally {
      await handle.close();
    }
    check();
    await options.checkpoint?.("commit");
    check();
    if ((await identity(destination.path)) !== destination.existing)
      throw error(
        "EPUB_EXPORT_CHANGED",
        "The destination changed after selection. Select it again.",
      );
    if (destination.existing === null) await link(temporary, destination.path);
    else await rename(temporary, destination.path);
    committed = true;
  } catch (value) {
    failure =
      value instanceof ApplicationError && value.code.startsWith("EPUB_EXPORT_")
        ? value
        : error(
            "EPUB_EXPORT_WRITE",
            "Unable to write EPUB. The previous destination and project were preserved.",
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
              "EPUB_EXPORT_CLEANUP",
              "EPUB export failed and temporary output could not be removed.",
            );
        }
      }
    }
  }
  if (failure) throw failure;
  return { cleanupWarning };
}
