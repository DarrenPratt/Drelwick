import { lstat, mkdir, readFile, realpath, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApplicationError, createIsoDate } from "@drelwick/shared";
import {
  ChapterFileSchema,
  ChapterFileV2Schema,
  EditorialStateSchema,
  ProjectConfigSchema,
  type ChapterFile,
  type ChapterFileV2,
} from "@drelwick/project-model";
import {
  CHAPTER_CREATION_LOCK,
  openProject,
  writeJsonAtomically,
  type OpenedProject,
  type ProjectLoadingFileSystem,
} from "./index.js";
import { commitEditorialTransaction } from "./editorial-transactions.js";

export interface RenameChapterInput {
  projectPath: string;
  chapterId: string;
  title: string;
}

export interface RenamedChapter {
  chapter: ChapterFile | ChapterFileV2;
  session: OpenedProject;
  warning?: string;
}

export interface ChapterRenameFileSystem extends ProjectLoadingFileSystem {
  mkdir(path: string): Promise<unknown>;
  rmdir(path: string): Promise<void>;
  writeChapter(path: string, chapter: ChapterFile): Promise<void>;
}

const defaults: ChapterRenameFileSystem = {
  lstat,
  readFile,
  realpath,
  mkdir,
  rmdir,
  writeJson: writeJsonAtomically,
  writeChapter: writeJsonAtomically,
};

export async function renameChapter(
  input: RenameChapterInput,
  overrides: Partial<ChapterRenameFileSystem> = {},
): Promise<RenamedChapter> {
  if (typeof input.title !== "string" || !input.title.trim())
    throw new ApplicationError(
      "CHAPTER_INPUT_INVALID",
      "Enter a chapter title.",
    );
  if (!isAbsolute(input.projectPath))
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  const fs = { ...defaults, ...overrides };
  let root: string;
  try {
    root = await fs.realpath(input.projectPath);
  } catch {
    throw new ApplicationError(
      "PROJECT_PATH_ACCESS_FAILED",
      "Unable to access project folder.",
    );
  }

  const lock = join(root, CHAPTER_CREATION_LOCK);
  const projectHeader = ProjectConfigSchema.safeParse(
    JSON.parse(
      await fs.readFile(join(root, "project.json"), "utf8"),
    ) as unknown,
  );
  const useLegacyLock =
    !projectHeader.success || projectHeader.data.schemaVersion !== 3;
  let lockAcquired = false;
  if (useLegacyLock) {
    try {
      await fs.mkdir(lock);
      lockAcquired = true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw new ApplicationError(
          "PROJECT_BUSY",
          "Another chapter operation is in progress. Please try again.",
        );
      throw new ApplicationError(
        "CHAPTER_RENAME_FAILED",
        "Unable to acquire the chapter operation lock.",
      );
    }
  }

  let result: RenamedChapter | undefined;
  try {
    const session = await openProject(root, {}, fs);
    if (!session.project.manuscript.order.includes(input.chapterId))
      throw new ApplicationError(
        "CHAPTER_NOT_FOUND",
        "The selected chapter is no longer available.",
      );

    const chapterPath = join(root, "manuscript", `${input.chapterId}.json`);
    const raw = JSON.parse(await fs.readFile(chapterPath, "utf8")) as unknown;
    const parsed =
      session.project.schemaVersion === 3
        ? ChapterFileV2Schema.safeParse(raw)
        : ChapterFileSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== input.chapterId)
      throw new ApplicationError(
        "PROJECT_SCHEMA_INVALID",
        "The selected chapter has an invalid format.",
      );

    const modified = createIsoDate();
    let chapter: ChapterFile | ChapterFileV2;
    if (session.project.schemaVersion === 3) {
      const statePath = join(root, session.project.editorialFile);
      const state = EditorialStateSchema.parse(
        JSON.parse(await fs.readFile(statePath, "utf8")) as unknown,
      );
      const nextChapter = ChapterFileV2Schema.parse({
        ...(parsed.data as ChapterFileV2),
        title: input.title.trim(),
        modified,
        revision: (parsed.data as ChapterFileV2).revision + 1,
      });
      const nextProject = {
        ...session.project,
        modified,
        generation: session.project.generation + 1,
      };
      const nextState = {
        ...state,
        generation: state.generation + 1,
        anchors: state.anchors.map((anchor) => {
          const hasSegment = anchor.segments.some(
            (segment) => segment.chapterId === input.chapterId,
          );
          return hasSegment
            ? {
                ...anchor,
                modified,
                segments: anchor.segments.map((segment) =>
                  segment.chapterId === input.chapterId
                    ? { ...segment, chapterRevision: nextChapter.revision }
                    : segment,
                ),
              }
            : anchor;
        }),
      };
      await commitEditorialTransaction({
        projectPath: root,
        projectId: session.project.projectId,
        kind: "edit",
        expectedGeneration: session.project.generation,
        changes: [
          {
            path: `manuscript/${input.chapterId}.json`,
            after: Buffer.from(`${JSON.stringify(nextChapter, null, 2)}\n`),
          },
          {
            path: session.project.editorialFile,
            after: Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`),
          },
          {
            path: "project.json",
            after: Buffer.from(`${JSON.stringify(nextProject, null, 2)}\n`),
          },
        ],
      });
      chapter = nextChapter;
    } else {
      chapter = ChapterFileSchema.parse({
        ...parsed.data,
        title: input.title.trim(),
        modified,
      });
      await fs.writeChapter(chapterPath, chapter);
    }
    const updatedSession = await openProject(root, {}, fs);
    result = { chapter, session: updatedSession };
    return result;
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      [
        "PROJECT_BUSY",
        "PROJECT_PATH_INVALID",
        "PROJECT_PATH_ACCESS_FAILED",
        "PROJECT_FILE_MISSING",
        "PROJECT_JSON_INVALID",
        "PROJECT_SCHEMA_INVALID",
        "PROJECT_SCHEMA_UNSUPPORTED",
        "PROJECT_ORDER_INVALID",
        "CHAPTER_NOT_FOUND",
      ].includes(error.code)
    )
      throw error;
    throw new ApplicationError(
      "CHAPTER_RENAME_FAILED",
      "Unable to rename the chapter. The previous chapter file was preserved.",
    );
  } finally {
    try {
      if (lockAcquired) await fs.rmdir(lock);
    } catch {
      if (result)
        result.warning =
          "The chapter was renamed, but its operation lock could not be removed. Close other project processes and inspect the lock before trying again.";
    }
  }
}
