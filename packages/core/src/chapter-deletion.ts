import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { ApplicationError, createIsoDate, createUuid } from "@drelwick/shared";
import {
  EditorialStateSchema,
  ProjectConfigSchema,
  ProjectConfigV3Schema,
  type ProjectConfig,
} from "@drelwick/project-model";
import {
  CHAPTER_CREATION_LOCK,
  openProject,
  writeJsonAtomically,
  type OpenedProject,
  type ProjectLoadingFileSystem,
} from "./index.js";
import { commitEditorialTransaction } from "./editorial-transactions.js";
import { createHistorySnapshot } from "./history.js";

export const CHAPTER_TRASH_DIRECTORY = ".history/deleted";

export interface DeleteChapterInput {
  projectPath: string;
  chapterId: string;
}

export interface DeletedChapter {
  chapterId: string;
  session: OpenedProject;
  trashPath: string;
  warning?: string;
}

export interface ChapterDeletionFileSystem extends ProjectLoadingFileSystem {
  mkdir(path: string, options?: { recursive: true }): Promise<unknown>;
  rmdir(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  writeManifest(path: string, project: ProjectConfig): Promise<void>;
}

const defaults: ChapterDeletionFileSystem = {
  lstat,
  readFile,
  realpath,
  mkdir,
  rmdir,
  rename,
  writeJson: writeJsonAtomically,
  writeManifest: writeJsonAtomically,
};

export async function deleteChapter(
  input: DeleteChapterInput,
  overrides: Partial<ChapterDeletionFileSystem> = {},
): Promise<DeletedChapter> {
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
  const projectHeader = ProjectConfigSchema.safeParse(
    JSON.parse(
      await fs.readFile(join(root, "project.json"), "utf8"),
    ) as unknown,
  );
  if (projectHeader.success && projectHeader.data.schemaVersion === 3)
    return deleteEditorialChapter(input, root);
  const lock = join(root, CHAPTER_CREATION_LOCK);
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new ApplicationError(
        "PROJECT_BUSY",
        "Another chapter operation is in progress. Please try again.",
      );
    throw new ApplicationError(
      "CHAPTER_DELETE_FAILED",
      "Unable to acquire the chapter operation lock.",
    );
  }

  let result: DeletedChapter | undefined;
  let moved = false;
  let sourcePath = "";
  let trashPath = "";
  try {
    const session = await openProject(root, {}, fs);
    if (!session.project.manuscript.order.includes(input.chapterId))
      throw new ApplicationError(
        "CHAPTER_NOT_FOUND",
        "The selected chapter is no longer available.",
      );
    sourcePath = join(root, "manuscript", `${input.chapterId}.json`);
    trashPath = join(
      root,
      CHAPTER_TRASH_DIRECTORY,
      `${input.chapterId}-${createUuid()}.json`,
    );
    await fs.mkdir(join(root, CHAPTER_TRASH_DIRECTORY), { recursive: true });
    await fs.rename(sourcePath, trashPath);
    moved = true;

    const manifestPath = join(root, "project.json");
    const source = await fs.readFile(manifestPath, "utf8");
    const raw = JSON.parse(source) as unknown;
    const parsed = ProjectConfigSchema.safeParse(raw);
    if (
      !parsed.success ||
      JSON.stringify(parsed.data) !== JSON.stringify(session.project)
    )
      throw new ApplicationError(
        "PROJECT_CHANGED_DURING_DELETE",
        "The project changed during chapter deletion. The chapter was restored.",
      );
    const project: ProjectConfig = {
      ...parsed.data,
      modified: createIsoDate(),
      manuscript: {
        ...parsed.data.manuscript,
        order: parsed.data.manuscript.order.filter(
          (id) => id !== input.chapterId,
        ),
      },
    };
    await fs.writeManifest(manifestPath, project);
    const updatedSession = await openProject(root, {}, fs);
    result = { chapterId: input.chapterId, session: updatedSession, trashPath };
    return result;
  } catch (error) {
    if (moved) {
      try {
        await fs.rename(trashPath, sourcePath);
        moved = false;
      } catch {
        throw new ApplicationError(
          "CHAPTER_DELETE_RECOVERY_FAILED",
          "Chapter deletion failed and the chapter could not be restored. Preserve the project before retrying.",
        );
      }
    }
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
        "PROJECT_CHANGED_DURING_DELETE",
      ].includes(error.code)
    )
      throw error;
    throw new ApplicationError(
      "CHAPTER_DELETE_FAILED",
      "Unable to delete the chapter. The original chapter was preserved.",
    );
  } finally {
    try {
      await fs.rmdir(lock);
    } catch {
      if (result)
        result.warning =
          "The chapter was deleted, but its operation lock could not be removed. Close other project processes and inspect the lock.";
    }
  }
}

async function deleteEditorialChapter(
  input: DeleteChapterInput,
  root: string,
): Promise<DeletedChapter> {
  const session = await openProject(root, { rebuildSummaries: true });
  if (
    session.project.schemaVersion !== 3 ||
    !session.project.manuscript.order.includes(input.chapterId)
  )
    throw new ApplicationError(
      "CHAPTER_NOT_FOUND",
      "The selected chapter is no longer available.",
    );
  const chapterPath = join(root, "manuscript", `${input.chapterId}.json`);
  try {
    await lstat(`${chapterPath}.tmp`);
    throw new ApplicationError(
      "CHAPTER_RECOVERY_REQUIRED",
      "A temporary chapter file exists. Preserve it before deleting this chapter.",
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const chapter = JSON.parse(await readFile(chapterPath, "utf8")) as Record<
    string,
    unknown
  >;
  const { ChapterFileV2Schema } = await import("@drelwick/project-model");
  const parsed = ChapterFileV2Schema.safeParse(chapter);
  if (!parsed.success || parsed.data.id !== input.chapterId)
    throw new ApplicationError(
      "PROJECT_SCHEMA_INVALID",
      "The selected chapter is invalid.",
    );
  const history = await createHistorySnapshot({
    projectPath: root,
    chapterId: input.chapterId,
    document: parsed.data.content,
    reason: "before-restructure",
  });
  if (!history)
    throw new ApplicationError(
      "HISTORY_SNAPSHOT_WRITE_FAILED",
      "Unable to preserve the chapter before deletion.",
    );
  const now = createIsoDate();
  const state = EditorialStateSchema.parse(
    JSON.parse(
      await readFile(join(root, session.project.editorialFile), "utf8"),
    ) as unknown,
  );
  const anchors = state.anchors.map((anchor) => {
    const affected = anchor.segments.filter(
      (segment) => segment.chapterId === input.chapterId,
    );
    if (!affected.length) return anchor;
    const segments = anchor.segments.filter(
      (segment) => segment.chapterId !== input.chapterId,
    );
    return {
      ...anchor,
      modified: now,
      status: segments.length ? ("partial" as const) : ("orphaned" as const),
      segments,
      lost: [
        ...anchor.lost,
        ...affected.map(() => ({
          evidence: anchor.original,
          reason: "deleted-chapter" as const,
          revisionGroupId: null,
        })),
      ],
    };
  });
  const nextState = EditorialStateSchema.parse({
    ...state,
    generation: state.generation + 1,
    anchors,
  });
  const nextProject = ProjectConfigV3Schema.parse({
    ...session.project,
    modified: now,
    generation: session.project.generation + 1,
    manuscript: {
      ...session.project.manuscript,
      order: session.project.manuscript.order.filter(
        (id) => id !== input.chapterId,
      ),
    },
  });
  const trashPath = join(
    root,
    CHAPTER_TRASH_DIRECTORY,
    `${input.chapterId}-${createUuid()}.json`,
  );
  const relativeTrash = relative(root, trashPath).split(sep).join("/");
  await commitEditorialTransaction({
    projectPath: root,
    projectId: session.project.projectId,
    kind: "structure",
    expectedGeneration: session.project.generation,
    changes: [
      { path: `manuscript/${input.chapterId}.json`, after: null },
      {
        path: relativeTrash,
        after: Buffer.from(`${JSON.stringify(parsed.data, null, 2)}\n`),
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
  return {
    chapterId: input.chapterId,
    session: await openProject(root, { rebuildSummaries: true }),
    trashPath,
  };
}
