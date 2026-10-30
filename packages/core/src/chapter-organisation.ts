import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  decodeEditorialDocument,
  ChapterFileSchema,
  ChapterFileV2Schema,
  EditorialStateSchema,
  ManuscriptDocumentSchema,
  ProjectConfigSchema,
  ProjectConfigV3Schema,
  type ReplacementJournal,
} from "@drelwick/project-model";
import {
  ApplicationError,
  ChapterOrganisationRequestSchema,
  createUuid,
  createIsoDate,
  type ChapterOrganisationRequest,
} from "@drelwick/shared";
import { openProject, type OpenedProject } from "./index.js";
import {
  commitChapterTransaction,
  type ChapterTransactionHooks,
} from "./manuscript-replacement.js";
import { withChapterOrder } from "./chapter-ordering.js";
import {
  splitChapterDocument,
  mergeChapterDocuments,
} from "./chapter-semantics.js";
import { assertRegularPath } from "./project-snapshot.js";
import { isMissing } from "./migration-state.js";
import { commitEditorialTransaction } from "./editorial-transactions.js";
import { editorialDocumentHash } from "./editorial-bundle.js";
import {
  mergeEditorialAnchors,
  splitEditorialAnchors,
} from "./editorial-anchors.js";
import { createHistorySnapshot } from "./history.js";

const chapterSchema = ChapterFileSchema.extend({
  content: ManuscriptDocumentSchema,
}).passthrough();

export async function organiseChapter(
  input: ChapterOrganisationRequest & { projectPath: string },
  hooks: ChapterTransactionHooks = {},
): Promise<{ session: OpenedProject; chapterId: string }> {
  const { projectPath, ...request } = input;
  const parsed = ChapterOrganisationRequestSchema.safeParse(request);
  if (!isAbsolute(projectPath) || !parsed.success)
    throw new ApplicationError(
      "CHAPTER_OPERATION_INVALID",
      "Invalid chapter operation.",
    );
  const command = parsed.data;
  const opened = await openProject(projectPath).catch(() => null);
  if (opened?.project.schemaVersion === 3)
    return organiseEditorialChapter(projectPath, command);
  let chapterId: string;
  try {
    chapterId = await commitChapterTransaction(
      projectPath,
      async (root) => {
        const session = await openProject(root);
        const order = session.project.manuscript.order;
        if (
          session.project.projectId !== command.projectId ||
          !isDeepStrictEqual(order, command.expectedOrder)
        )
          throw new Error("Stale selection.");
        const selected =
          command.operation === "merge"
            ? command.chapterIds
            : [command.chapterId];
        if (
          new Set(selected).size !== selected.length ||
          selected.some((id) => !order.includes(id))
        )
          throw new Error("Invalid selection.");
        const ids = order.filter((id) => selected.includes(id));
        if (
          command.operation === "merge" &&
          order.indexOf(ids[1]!) !== order.indexOf(ids[0]!) + 1
        )
          throw new Error("Select adjacent chapters.");
        const chapters = [];
        for (const id of ids) {
          const path = `manuscript/${id}.json`;
          await assertRegularPath(root, path);
          try {
            await lstat(join(root, `${path}.tmp`));
            throw new Error("Pending recovery data.");
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
          const chapter = chapterSchema.parse(
            JSON.parse(await readFile(join(root, path), "utf8")),
          );
          if (chapter.id !== id) throw new Error("Invalid chapter identity.");
          chapters.push(chapter);
        }
        const first = chapters[0]!;
        const now = new Date().toISOString();
        const entries: ReplacementJournal["entries"] = [];
        const created: NonNullable<ReplacementJournal["structure"]>["created"] =
          [];
        const removed: NonNullable<ReplacementJournal["structure"]>["removed"] =
          [];
        let result = first.id;
        let nextOrder = [...order];
        if (command.operation === "status") {
          if (first.status !== command.status)
            entries.push({
              before: first,
              after: { ...first, status: command.status, modified: now },
            });
          return { entries, result, reason: "before-restructure" };
        }
        if (command.operation === "merge") {
          const second = chapters[1]!;
          entries.push({
            before: first,
            after: {
              ...first,
              content: ManuscriptDocumentSchema.parse(
                mergeChapterDocuments(first.content, second.content),
              ),
              modified: now,
            },
          });
          removed.push(second);
          nextOrder = order.filter((id) => id !== second.id);
        } else {
          const id = createUuid();
          if (
            order.some(
              (existing) => existing.toLowerCase() === id.toLowerCase(),
            )
          )
            throw new Error("Identity collision.");
          for (const suffix of [".json", ".json.tmp"]) {
            try {
              await lstat(join(root, "manuscript", `${id}${suffix}`));
              throw new Error("Identity collision.");
            } catch (error) {
              if (!isMissing(error)) throw error;
            }
          }
          let content = first.content;
          if (command.operation === "split") {
            if (!isDeepStrictEqual(first.content, command.expectedContent))
              throw new Error("Stale cursor.");
            const [before, after] = splitChapterDocument(
              first.content,
              command.position,
            );
            entries.push({
              before: first,
              after: chapterSchema.parse({
                ...first,
                content: before,
                modified: now,
              }),
            });
            content = ManuscriptDocumentSchema.parse(after);
          }
          created.push(
            chapterSchema.parse({
              ...first,
              id,
              title: `${first.title.slice(0, 190).replace(/\p{Surrogate}$/u, "")} ${command.operation === "duplicate" ? "Copy" : "Continued"}`,
              created: now,
              modified: now,
              content,
            }),
          );
          nextOrder.splice(order.indexOf(first.id) + 1, 0, id);
          result = id;
        }
        await assertRegularPath(root, "project.json");
        try {
          await lstat(join(root, "project.json.tmp"));
          throw new Error("Pending manifest recovery data.");
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        const beforeManifest = JSON.parse(
          await readFile(join(root, "project.json"), "utf8"),
        ) as Record<string, unknown>;
        if (
          !isDeepStrictEqual(
            ProjectConfigSchema.parse(beforeManifest),
            session.project,
          )
        )
          throw new Error("Stale manifest.");
        const afterManifest = withChapterOrder(beforeManifest, nextOrder, now);
        return {
          entries,
          structure: { beforeManifest, afterManifest, created, removed },
          result,
          reason: "before-restructure",
        };
      },
      hooks,
    );
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      error.code === "REPLACEMENT_RECOVERY_REQUIRED"
    )
      throw new ApplicationError(
        "CHAPTER_RECOVERY_REQUIRED",
        "Chapter operation recovery is required. Preserve the project and reopen before editing.",
      );
    throw new ApplicationError(
      "CHAPTER_OPERATION_FAILED",
      "Chapter operation failed, was cancelled, or became stale. Original chapters were preserved. Check the selection and cursor, then retry.",
    );
  }
  try {
    return { session: await openProject(projectPath), chapterId };
  } catch {
    throw new ApplicationError(
      "CHAPTER_RECOVERY_REQUIRED",
      "The operation completed but the workspace could not reload. Reopen the project before editing.",
    );
  }
}

async function organiseEditorialChapter(
  projectPath: string,
  command: ChapterOrganisationRequest,
): Promise<{ session: OpenedProject; chapterId: string }> {
  const session = await openProject(projectPath, { rebuildSummaries: true });
  if (
    session.project.schemaVersion !== 3 ||
    session.project.projectId !== command.projectId ||
    !isDeepStrictEqual(session.project.manuscript.order, command.expectedOrder)
  )
    throw new ApplicationError(
      "CHAPTER_OPERATION_STALE",
      "The chapter list changed. Refresh and retry.",
    );
  const order = session.project.manuscript.order;
  const selected =
    command.operation === "merge" ? command.chapterIds : [command.chapterId];
  if (
    new Set(selected).size !== selected.length ||
    selected.some((id) => !order.includes(id))
  )
    throw new ApplicationError(
      "CHAPTER_OPERATION_INVALID",
      "The selected chapters are no longer available.",
    );
  const ids = order.filter((id) => selected.includes(id));
  if (
    command.operation === "merge" &&
    order.indexOf(ids[1]!) !== order.indexOf(ids[0]!) + 1
  )
    throw new ApplicationError(
      "CHAPTER_OPERATION_INVALID",
      "Select adjacent chapters to merge.",
    );
  const chapters = new Map<
    string,
    import("@drelwick/project-model").ChapterFileV2
  >();
  for (const id of ids) {
    const path = join(projectPath, "manuscript", `${id}.json`);
    await assertRegularPath(projectPath, `manuscript/${id}.json`);
    try {
      await lstat(`${path}.tmp`);
      throw new ApplicationError(
        "CHAPTER_RECOVERY_REQUIRED",
        "A chapter has pending recovery data. Preserve it before restructuring.",
      );
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parsed = ChapterFileV2Schema.safeParse(
      JSON.parse(await readFile(path, "utf8")) as unknown,
    );
    if (!parsed.success || parsed.data.id !== id)
      throw new ApplicationError(
        "PROJECT_SCHEMA_INVALID",
        "A selected chapter is invalid.",
      );
    chapters.set(id, parsed.data);
  }
  const statePath = join(projectPath, session.project.editorialFile);
  const state = EditorialStateSchema.parse(
    JSON.parse(await readFile(statePath, "utf8")) as unknown,
  );
  const now = createIsoDate();
  let resultId = command.operation === "merge" ? ids[0]! : command.chapterId;
  let nextOrder = [...order];
  const updates = new Map<
    string,
    import("@drelwick/project-model").ChapterFileV2 | null
  >();
  let anchors = state.anchors;
  if (command.operation === "status") {
    const chapter = chapters.get(command.chapterId)!;
    updates.set(
      chapter.id,
      ChapterFileV2Schema.parse({
        ...chapter,
        status: command.status,
        modified: now,
      }),
    );
  } else if (command.operation === "merge") {
    const first = chapters.get(ids[0]!)!;
    const second = chapters.get(ids[1]!)!;
    const content = ManuscriptDocumentSchema.parse(
      mergeChapterDocuments(first.content, second.content),
    );
    const merged = ChapterFileV2Schema.parse({
      ...first,
      modified: now,
      revision: first.revision + 1,
      content,
      review: { ...first.review, proposed: content },
    });
    updates.set(first.id, merged);
    updates.set(second.id, null);
    nextOrder = order.filter((id) => id !== second.id);
    anchors = mergeEditorialAnchors(
      state.anchors,
      second.id,
      first.id,
      documentSize(first.content),
      merged.revision,
      editorialDocumentHash(content),
    );
  } else {
    const first = chapters.get(command.chapterId)!;
    const newId = createUuid();
    if (order.includes(newId))
      throw new ApplicationError(
        "CHAPTER_OPERATION_INVALID",
        "Unable to allocate a chapter identity.",
      );
    for (const suffix of [".json", ".json.tmp"]) {
      try {
        await lstat(join(projectPath, "manuscript", `${newId}${suffix}`));
        throw new ApplicationError(
          "CHAPTER_OPERATION_INVALID",
          "Unable to allocate a chapter identity.",
        );
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    resultId = newId;
    if (command.operation === "split") {
      if (!isDeepStrictEqual(first.content, command.expectedContent))
        throw new ApplicationError(
          "CHAPTER_OPERATION_STALE",
          "The chapter changed. Refresh the split position and retry.",
        );
      const [left, right] = splitChapterDocument(
        first.content,
        command.position,
      );
      const previousRevision = first.revision + 1;
      const updated = ChapterFileV2Schema.parse({
        ...first,
        modified: now,
        revision: previousRevision,
        content: left,
        review: { ...first.review, proposed: left },
      });
      const continued = ChapterFileV2Schema.parse({
        ...first,
        id: newId,
        title: `${first.title.slice(0, 190)} Continued`,
        created: now,
        modified: now,
        revision: 1,
        content: right,
        review: { schemaVersion: 1, mode: "off", proposed: right, pending: [] },
      });
      updates.set(first.id, updated);
      updates.set(newId, continued);
      anchors = splitEditorialAnchors(
        state.anchors,
        first.id,
        first.id,
        newId,
        command.position,
        updated.revision,
        continued.revision,
        editorialDocumentHash(left),
        editorialDocumentHash(right),
        documentSize(right) - (documentSize(first.content) - command.position),
        documentSize(left),
      );
    } else {
      const duplicate = ChapterFileV2Schema.parse({
        ...first,
        id: newId,
        title: `${first.title.slice(0, 190)} Copy`,
        created: now,
        modified: now,
        revision: 1,
        review: {
          schemaVersion: 1,
          mode: "off",
          proposed: first.content,
          pending: [],
        },
      });
      updates.set(newId, duplicate);
    }
    nextOrder.splice(order.indexOf(first.id) + 1, 0, newId);
  }
  for (const chapter of chapters.values()) {
    if (
      command.operation === "duplicate" ||
      (command.operation === "status" && chapter.id !== command.chapterId)
    )
      continue;
    const safety = await createHistorySnapshot({
      projectPath,
      chapterId: chapter.id,
      document: chapter.content,
      reason: "before-restructure",
    });
    if (!safety)
      throw new ApplicationError(
        "HISTORY_SNAPSHOT_WRITE_FAILED",
        "Unable to preserve the chapter before restructuring.",
      );
  }
  const nextState = EditorialStateSchema.parse({
    ...state,
    generation: state.generation + 1,
    anchors: anchors.map((anchor) => ({
      ...anchor,
      segments: [...anchor.segments].sort(
        (a, b) =>
          nextOrder.indexOf(a.chapterId) - nextOrder.indexOf(b.chapterId) ||
          a.from - b.from ||
          a.to - b.to,
      ),
    })),
  });
  const nextProject = ProjectConfigV3Schema.parse({
    ...session.project,
    modified: now,
    generation: session.project.generation + 1,
    manuscript: { ...session.project.manuscript, order: nextOrder },
  });
  const changes = [
    ...[...updates.entries()].map(([id, chapter]) => ({
      path: `manuscript/${id}.json`,
      after:
        chapter === null
          ? null
          : Buffer.from(`${JSON.stringify(chapter, null, 2)}\n`),
    })),
    {
      path: session.project.editorialFile,
      after: Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`),
    },
    {
      path: "project.json",
      after: Buffer.from(`${JSON.stringify(nextProject, null, 2)}\n`),
    },
  ];
  await commitEditorialTransaction({
    projectPath,
    projectId: session.project.projectId,
    kind: "structure",
    expectedGeneration: session.project.generation,
    changes,
  });
  return {
    session: await openProject(projectPath, { rebuildSummaries: true }),
    chapterId: resultId,
  };
}

function documentSize(value: unknown): number {
  return decodeEditorialDocument(value).content.size;
}
