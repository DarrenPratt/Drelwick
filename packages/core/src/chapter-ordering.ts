import { lstat, mkdir, readFile, realpath, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ApplicationError, createIsoDate } from "@drelwick/shared";
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

export interface ReorderChaptersInput {
  projectPath: string;
  chapterIds: string[];
}

export interface ReorderedChapters {
  session: OpenedProject;
  warning?: string;
}

export interface ChapterOrderingFileSystem extends ProjectLoadingFileSystem {
  mkdir(path: string): Promise<unknown>;
  rmdir(path: string): Promise<void>;
  writeManifest(path: string, project: ProjectConfig): Promise<void>;
}

const defaults: ChapterOrderingFileSystem = {
  lstat,
  readFile,
  realpath,
  mkdir,
  rmdir,
  writeJson: writeJsonAtomically,
  writeManifest: writeJsonAtomically,
};

/** Preserve extension metadata while changing the canonical order, never filenames. */
export function withChapterOrder(
  raw: Record<string, unknown>,
  chapterIds: string[],
  modified: string,
): ProjectConfig {
  ProjectConfigSchema.parse(raw);
  const result = {
    ...raw,
    modified,
    manuscript: {
      ...(raw.manuscript as Record<string, unknown>),
      order: chapterIds,
    },
  };
  return Object.assign(ProjectConfigSchema.parse(result), result);
}

export async function reorderChapters(
  input: ReorderChaptersInput,
  overrides: Partial<ChapterOrderingFileSystem> = {},
): Promise<ReorderedChapters> {
  if (!isAbsolute(input.projectPath))
    throw new ApplicationError(
      "PROJECT_PATH_INVALID",
      "Project root must be an absolute path.",
    );
  const normalizedIds = input.chapterIds.map((id) => id.trim());
  const uniqueIds = new Set(normalizedIds.map((id) => id.toLowerCase()));
  if (
    normalizedIds.some((id) => !id) ||
    uniqueIds.size !== normalizedIds.length
  )
    throw new ApplicationError(
      "PROJECT_ORDER_INVALID",
      "Chapter order must contain each chapter exactly once.",
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
  const initial = await openProject(root, { rebuildSummaries: true }, fs);
  if (initial.project.schemaVersion === 3) {
    const currentSet = new Set(
      initial.project.manuscript.order.map((id) => id.toLowerCase()),
    );
    if (
      normalizedIds.length !== currentSet.size ||
      normalizedIds.some((id) => !currentSet.has(id.toLowerCase()))
    )
      throw new ApplicationError(
        "PROJECT_ORDER_INVALID",
        "Chapter order must contain every chapter in the project exactly once.",
      );
    const now = createIsoDate();
    const state = EditorialStateSchema.parse(
      JSON.parse(
        await fs.readFile(join(root, initial.project.editorialFile), "utf8"),
      ) as unknown,
    );
    const nextState = {
      ...state,
      generation: state.generation + 1,
      anchors: state.anchors.map((anchor) => ({
        ...anchor,
        segments: [...anchor.segments].sort(
          (a, b) =>
            normalizedIds.indexOf(a.chapterId) -
              normalizedIds.indexOf(b.chapterId) ||
            a.from - b.from ||
            a.to - b.to,
        ),
      })),
    };
    const project = ProjectConfigV3Schema.parse({
      ...initial.project,
      modified: now,
      generation: initial.project.generation + 1,
      manuscript: { ...initial.project.manuscript, order: normalizedIds },
    });
    await commitEditorialTransaction({
      projectPath: root,
      projectId: project.projectId,
      kind: "structure",
      expectedGeneration: initial.project.generation,
      changes: [
        {
          path: project.editorialFile,
          after: Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`),
        },
        {
          path: "project.json",
          after: Buffer.from(`${JSON.stringify(project, null, 2)}\n`),
        },
      ],
    });
    const byId = new Map(
      initial.chapters.map((item) => [item.id.toLowerCase(), item]),
    );
    return {
      session: {
        ...initial,
        project,
        chapters: normalizedIds
          .map((id) => byId.get(id.toLowerCase())!)
          .filter(Boolean),
      },
    };
  }
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new ApplicationError(
        "PROJECT_BUSY",
        "Another chapter operation is in progress. Please try again.",
      );
    throw new ApplicationError(
      "CHAPTER_REORDER_FAILED",
      "Unable to acquire the chapter operation lock.",
    );
  }

  let result: ReorderedChapters | undefined;
  try {
    const session = await openProject(root, {}, fs);
    const currentIds = session.project.manuscript.order;
    const currentSet = new Set(currentIds.map((id) => id.toLowerCase()));
    if (
      normalizedIds.length !== currentIds.length ||
      normalizedIds.some((id) => !currentSet.has(id.toLowerCase()))
    )
      throw new ApplicationError(
        "PROJECT_ORDER_INVALID",
        "Chapter order must contain every chapter in the project exactly once.",
      );

    const manifestPath = join(root, "project.json");
    const source = await fs.readFile(manifestPath, "utf8");
    const raw = JSON.parse(source) as unknown;
    const parsed = ProjectConfigSchema.safeParse(raw);
    if (
      !parsed.success ||
      JSON.stringify(parsed.data) !== JSON.stringify(session.project)
    )
      throw new ApplicationError(
        "PROJECT_CHANGED_DURING_REORDER",
        "The project changed during chapter reordering. Reopen it before retrying.",
      );
    const project = withChapterOrder(
      raw as Record<string, unknown>,
      normalizedIds,
      createIsoDate(),
    );
    await fs.writeManifest(manifestPath, project);
    result = {
      session: {
        ...session,
        project,
        chapters: normalizedIds.map((id) => {
          const chapter = session.chapters.find(
            (entry) => entry.id.toLowerCase() === id.toLowerCase(),
          );
          if (!chapter)
            throw new ApplicationError(
              "PROJECT_ORDER_INVALID",
              "Chapter order references an unavailable chapter.",
            );
          return chapter;
        }),
      },
    };
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
        "PROJECT_CHANGED_DURING_REORDER",
      ].includes(error.code)
    )
      throw error;
    throw new ApplicationError(
      "CHAPTER_REORDER_FAILED",
      "Unable to reorder chapters. The previous order was preserved.",
    );
  } finally {
    try {
      await fs.rmdir(lock);
    } catch {
      if (result)
        result.warning =
          "The chapters were reordered, but the operation lock could not be removed. Close other project processes and inspect the lock.";
    }
  }
}
