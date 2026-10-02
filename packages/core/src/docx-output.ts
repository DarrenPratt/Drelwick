import { randomUUID } from "node:crypto";
import { lstat, open, rename, link, unlink, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";
import { regularPath } from "./image-assets.js";
import { docxExportError } from "./docx-export.js";

export interface DocxDestination {
  path: string;
  /** Identity captured before asking for overwrite consent. */
  existing: string | null;
}
const identity = async (path: string): Promise<string | null> => {
  try {
    await regularPath(path);
    const s = await lstat(path, { bigint: true });
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
};
const pathError = () =>
  docxExportError(
    "DOCX_EXPORT_DESTINATION",
    "Choose an accessible .docx file outside all Drelwick project folders. Linked paths are not supported.",
  );

/** Only the privileged native picker supplies this path. Never accept it over IPC. */
export async function inspectDocxDestination(
  path: string,
  projectPath: string,
): Promise<DocxDestination> {
  try {
    if (
      !isAbsolute(path) ||
      extname(path).toLowerCase() !== ".docx" ||
      /[. ]$/.test(path) ||
      path.includes("\0")
    )
      throw pathError();
    await regularPath(dirname(path), true);
    // Validate the final component too, including Windows ADS / device names.
    if (
      /[<>:"|?*]/.test(basename(path)) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename(path))
    )
      throw pathError();
    const parent = await realpath(dirname(path));
    const root = await realpath(projectPath);
    const inside = relative(root, parent);
    if (
      !inside ||
      (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))
    )
      throw pathError();
    // Protect other projects too: a generated output is never a project file.
    let ancestor = parent;
    while (true) {
      try {
        await lstat(join(ancestor, "project.json"));
        throw pathError();
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      const next = dirname(ancestor);
      if (next === ancestor) break;
      ancestor = next;
    }
    const canonical = join(parent, basename(path));
    return { path: canonical, existing: await identity(canonical) };
  } catch {
    throw pathError();
  }
}

/** Binary equivalent of the JSON writer's exclusive temp + fsync + rename path.
 * A hard link publishes a new file without replacing a concurrently-created file.
 * Replacement is allowed only for the destination reviewed by the user.
 */
export async function writeDocxAtomically(
  destination: DocxDestination,
  bytes: Uint8Array,
  options: {
    overwrite: boolean;
    signal?: AbortSignal;
    checkpoint?: (phase: "written" | "commit") => Promise<void>;
  },
): Promise<{ cleanupWarning: boolean }> {
  const temporary = join(
    dirname(destination.path),
    `.drelwick-docx-${randomUUID()}.tmp`,
  );
  let owned = false;
  let committed = false;
  let cleanupWarning = false;
  let failure: unknown;
  const check = () => {
    if (options.signal?.aborted)
      throw docxExportError(
        "DOCX_EXPORT_CANCELLED",
        "DOCX export was cancelled before writing the destination.",
      );
  };
  try {
    check();
    if (destination.existing !== null && !options.overwrite)
      throw docxExportError(
        "DOCX_EXPORT_OVERWRITE",
        "The existing file was not approved for replacement.",
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
    await regularPath(dirname(destination.path), true);
    if ((await identity(destination.path)) !== destination.existing)
      throw docxExportError(
        "DOCX_EXPORT_CHANGED",
        "The destination changed after selection. Select it again and review overwrite confirmation.",
      );
    if (destination.existing === null) await link(temporary, destination.path);
    else await rename(temporary, destination.path);
    committed = true;
  } catch (error) {
    failure =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("DOCX_EXPORT_")
        ? error
        : docxExportError(
            "DOCX_EXPORT_WRITE",
            "Unable to write DOCX. Check destination permissions and disk space. The previous destination and project were preserved.",
          );
  } finally {
    if (owned) {
      try {
        await unlink(temporary);
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )) {
          if (committed) cleanupWarning = true;
          else
            failure = docxExportError(
              "DOCX_EXPORT_CLEANUP",
              "Export failed and its temporary output could not be removed. The previous destination is preserved; check the destination folder for a .drelwick-docx temporary file.",
            );
        }
      }
    }
  }
  if (failure) throw failure;
  return { cleanupWarning };
}
