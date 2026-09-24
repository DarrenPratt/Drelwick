import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ChapterFileSchema,
  ManuscriptDocumentSchema,
  type ReplacementJournal,
} from "@drelwick/project-model";
import {
  ApplicationError,
  ChapterOrganisationRequestSchema,
  createUuid,
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
          try {
            await lstat(join(root, "manuscript", `${id}.json`));
            throw new Error("Identity collision.");
          } catch (error) {
            if (!isMissing(error)) throw error;
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
              title: `${first.title.slice(0, 190)} ${command.operation === "duplicate" ? "Copy" : "Continued"}`,
              created: now,
              modified: now,
              content,
            }),
          );
          nextOrder.splice(order.indexOf(first.id) + 1, 0, id);
          result = id;
        }
        await assertRegularPath(root, "project.json");
        const beforeManifest = JSON.parse(
          await readFile(join(root, "project.json"), "utf8"),
        ) as Record<string, unknown>;
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
