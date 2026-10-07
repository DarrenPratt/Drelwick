import { createHash } from "node:crypto";
import { lstat, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { PrintConfigurationSchema } from "@drelwick/project-model";
import {
  ApplicationError,
  defaultPrintSettings,
  PrintSaveRequestSchema,
  type PrintSaveRequest,
  type PrintConfigurationState,
} from "@drelwick/shared";
import {
  CHAPTER_CREATION_LOCK,
  openProject,
  writeJsonAtomically,
} from "./index.js";
import { boundedRead, regularPath } from "./image-assets.js";

export const PRINT_CONFIGURATION_FILE = "print.json";
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const failed = (code = "PRINT_CONFIGURATION_INVALID") =>
  new ApplicationError(
    code,
    "Print settings are unavailable. Existing settings and manuscript files were preserved. Check project access or recovery files before retrying.",
  );
const revision = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

/** Read-only, including old projects. Call under the project lock when assembling a print job. */
export async function readPrintConfiguration(
  projectPath: string,
  projectId: string,
): Promise<PrintConfigurationState> {
  await regularPath(projectPath, true);
  const path = join(projectPath, PRINT_CONFIGURATION_FILE);
  try {
    await lstat(`${path}.tmp`);
    throw failed("PRINT_CONFIGURATION_RECOVERY_REQUIRED");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  try {
    const bytes = await boundedRead(path, 16384);
    const parsed = PrintConfigurationSchema.safeParse(
      JSON.parse(bytes.toString("utf8")),
    );
    if (!parsed.success || parsed.data.projectId !== projectId) throw failed();
    return { settings: parsed.data.settings, revision: revision(bytes) };
  } catch (error) {
    if (!missing(error)) throw failed();
    const settings = defaultPrintSettings();
    return {
      settings,
      revision: revision(
        JSON.stringify({ schemaVersion: 1, projectId, settings }),
      ),
    };
  }
}
export async function loadPrintConfiguration(
  projectPath: string,
  projectId: string,
): Promise<PrintConfigurationState> {
  await regularPath(projectPath, true);
  const session = await openProject(projectPath);
  if (session.project.projectId !== projectId) throw failed("PROJECT_NOT_OPEN");
  return readPrintConfiguration(projectPath, projectId);
}
export async function savePrintConfiguration(
  input: { projectPath: string } & PrintSaveRequest,
  overrides: {
    write?: typeof writeJsonAtomically;
    releaseLock?: typeof rmdir;
  } = {},
): Promise<PrintConfigurationState & { warning?: string }> {
  // Do not allow malformed configuration to access paths or acquire a lock.
  const { projectPath, ...request } = input;
  const parsed = PrintSaveRequestSchema.safeParse(request);
  if (!parsed.success) throw failed("PRINT_CONFIGURATION_INVALID");
  await regularPath(projectPath, true);
  const lock = join(projectPath, CHAPTER_CREATION_LOCK);
  try {
    await mkdir(lock);
  } catch {
    throw failed("PROJECT_BUSY");
  }
  let result: (PrintConfigurationState & { warning?: string }) | undefined;
  try {
    const current = await loadPrintConfiguration(
      projectPath,
      parsed.data.projectId,
    );
    if (current.revision !== parsed.data.expectedRevision)
      throw failed("PRINT_CONFIGURATION_STALE");
    const data = PrintConfigurationSchema.parse({
      schemaVersion: 1,
      projectId: parsed.data.projectId,
      settings: parsed.data.settings,
    });
    await (overrides.write ?? writeJsonAtomically)(
      join(projectPath, PRINT_CONFIGURATION_FILE),
      data,
    );
    // Match the atomic writer's serialization without a fallible post-commit read.
    result = {
      settings: data.settings,
      revision: revision(`${JSON.stringify(data, null, 2)}\n`),
    };
    return result;
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      [
        "PROJECT_NOT_OPEN",
        "PRINT_CONFIGURATION_INVALID",
        "PRINT_CONFIGURATION_STALE",
        "PRINT_CONFIGURATION_RECOVERY_REQUIRED",
      ].includes(error.code)
    )
      throw error;
    throw failed("PRINT_CONFIGURATION_SAVE_FAILED");
  } finally {
    try {
      await (overrides.releaseLock ?? rmdir)(lock);
    } catch {
      if (result)
        result.warning =
          "Print settings are saved, but the project lock could not be released. Resolve the retained lock before further changes.";
    }
  }
}
