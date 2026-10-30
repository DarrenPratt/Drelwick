import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApplicationError } from "@drelwick/shared";
import {
  parseEditorialJson,
  ChapterFileV2Schema,
  ChapterFileSchema,
  ProjectConfigSchema,
  ManuscriptDocumentSchema,
} from "@drelwick/project-model";
import { openProject } from "./index.js";

export interface LoadChapterInput {
  projectPath: string;
  chapterId: string;
}

export interface LoadedChapter {
  id: string;
  content: Record<string, unknown>;
}

export async function loadChapter(
  input: LoadChapterInput,
): Promise<LoadedChapter> {
  if (!isAbsolute(input.projectPath))
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  let root: string;
  try {
    root = await realpath(input.projectPath);
    const session = await openProject(root);
    if (!session.project.manuscript.order.includes(input.chapterId))
      throw new ApplicationError(
        "CHAPTER_NOT_FOUND",
        "The selected chapter is no longer available.",
      );
    const path = join(root, "manuscript", `${input.chapterId}.json`);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile())
      throw new ApplicationError(
        "PROJECT_PATH_INVALID",
        "Expected a regular chapter file.",
      );
    const raw = parseEditorialJson(await readFile(path)) as unknown;
    const project = ProjectConfigSchema.parse(
      parseEditorialJson(await readFile(join(root, "project.json"))) as unknown,
    );
    const parsed =
      project.schemaVersion === 3
        ? ChapterFileV2Schema.safeParse(raw)
        : ChapterFileSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== input.chapterId)
      throw new ApplicationError(
        "PROJECT_SCHEMA_INVALID",
        "The selected chapter has an invalid format.",
      );
    if (!ManuscriptDocumentSchema.safeParse(parsed.data.content).success)
      throw new ApplicationError(
        "CHAPTER_DOCUMENT_INVALID",
        "The chapter document has an unsupported or invalid structure.",
      );
    return { id: parsed.data.id, content: parsed.data.content };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "CHAPTER_LOAD_FAILED",
      "Unable to load the selected chapter.",
    );
  }
}
