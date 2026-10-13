import { lstat, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import {
  BookPresentationSchema,
  type BookPresentation,
} from "@drelwick/project-model";
import {
  ApplicationError,
  BuiltinThemeIdSchema,
  DEFAULT_BOOK_THEME,
  type BuiltinThemeId,
  type BookThemeSelection,
} from "@drelwick/shared";
import { resolveBookTheme } from "@drelwick/renderer";
import {
  CHAPTER_CREATION_LOCK,
  openProject,
  writeJsonAtomically,
} from "./index.js";
import { boundedRead, regularPath } from "./image-assets.js";
import { separateLegacyPrintConfiguration } from "./print-configuration.js";

export const BOOK_PRESENTATION_FILE = "presentation.json";
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const error = (code = "BOOK_PRESENTATION_INVALID") =>
  new ApplicationError(
    code,
    "Book presentation settings are unavailable. Existing settings and manuscript files were preserved. Check project access or recovery files before retrying.",
  );

/** Single atomic component read. Assembly/save call this while owning the project lock. */
export async function readBookPresentation(
  projectPath: string,
  projectId: string,
): Promise<{ settings: BookPresentation; bytes?: Buffer }> {
  await regularPath(projectPath, true);
  const path = join(projectPath, BOOK_PRESENTATION_FILE);
  try {
    await lstat(`${path}.tmp`);
    throw error("BOOK_PRESENTATION_RECOVERY_REQUIRED");
  } catch (failure) {
    if (!missing(failure)) throw failure;
  }
  try {
    const bytes = await boundedRead(path, 8192);
    const parsed = BookPresentationSchema.safeParse(
      JSON.parse(bytes.toString("utf8")),
    );
    if (!parsed.success || parsed.data.projectId !== projectId) throw error();
    return { settings: parsed.data, bytes };
  } catch (failure) {
    if (missing(failure))
      return {
        settings: { schemaVersion: 1, projectId, themeId: DEFAULT_BOOK_THEME },
      };
    throw error();
  }
}
export async function loadBookTheme(
  projectPath: string,
  projectId: string,
): Promise<BookThemeSelection> {
  await regularPath(projectPath, true);
  const session = await openProject(projectPath);
  if (session.project.projectId !== projectId) throw error("PROJECT_NOT_OPEN");
  return resolveBookTheme(
    (await readBookPresentation(projectPath, projectId)).settings.themeId,
  );
}
export async function saveBookTheme(
  input: { projectPath: string; projectId: string; themeId: BuiltinThemeId },
  overrides: {
    write?: typeof writeJsonAtomically;
    releaseLock?: typeof rmdir;
  } = {},
): Promise<{ selection: BookThemeSelection; warning?: string }> {
  if (!BuiltinThemeIdSchema.safeParse(input.themeId).success)
    throw error("BOOK_THEME_INVALID");
  await regularPath(input.projectPath, true);
  const lock = join(input.projectPath, CHAPTER_CREATION_LOCK);
  try {
    await mkdir(lock);
  } catch {
    throw error("PROJECT_BUSY");
  }
  let result: { selection: BookThemeSelection; warning?: string } | undefined;
  try {
    const current = await loadBookTheme(input.projectPath, input.projectId);
    if (current.savedThemeId !== input.themeId) {
      await separateLegacyPrintConfiguration(
        input.projectPath,
        input.projectId,
      );
      await (overrides.write ?? writeJsonAtomically)(
        join(input.projectPath, BOOK_PRESENTATION_FILE),
        BookPresentationSchema.parse({
          schemaVersion: 1,
          projectId: input.projectId,
          themeId: input.themeId,
        }),
      );
    }
    result = { selection: resolveBookTheme(input.themeId) };
    return result;
  } catch (failure) {
    if (
      failure instanceof ApplicationError &&
      [
        "PROJECT_NOT_OPEN",
        "BOOK_PRESENTATION_INVALID",
        "BOOK_PRESENTATION_RECOVERY_REQUIRED",
      ].includes(failure.code)
    )
      throw failure;
    throw error("BOOK_PRESENTATION_SAVE_FAILED");
  } finally {
    try {
      await (overrides.releaseLock ?? rmdir)(lock);
    } catch {
      if (result)
        result.warning =
          "Theme selection is saved, but the project lock could not be released. Inspect the lock before making further changes.";
      // On failure preserve the original fixed error; the retained lock prevents
      // further writes and its recovery instructions still apply.
    }
  }
}
