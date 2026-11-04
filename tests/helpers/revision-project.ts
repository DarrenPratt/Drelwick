import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { decodeEditorialDocument } from "../../packages/project-model/src/index.js";
import {
  saveChapter,
  readRevisionChapter,
} from "../../packages/core/src/index.js";
import {
  normalizeRevision,
  RevisionStateStep,
} from "../../packages/core/src/revisions.js";
import { EditorialHistoryStep } from "../../packages/core/src/editorial-history.js";
import { randomUUID } from "node:crypto";
import { editorialProject } from "./editorial-project.js";
export const ACCEPTED_CONTROL = "ACCEPTED_ONLY";
export const PROPOSED_CONTROL = "PROPOSED_ONLY";
export const REVISION_PRIVATE = "PRIVATE_REVISION_AUTHOR";
const document = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
/** Uses the actual revision-aware save path, with pre-existing retained discussion canaries. */
export async function revisionProject() {
  const fixture = await editorialProject();
  try {
    const projectId = JSON.parse(
      await readFile(join(fixture.projectPath, "project.json"), "utf8"),
    ).projectId as string;
    await saveChapter({
      projectPath: fixture.projectPath,
      chapterId: fixture.chapterId,
      document: document(`Publication control text. ${ACCEPTED_CONTROL} gap.`),
    });
    for (const text of [
      `Publication control text. ${ACCEPTED_CONTROL} gap. ${PROPOSED_CONTROL}`,
      `Publication control text.  gap. ${PROPOSED_CONTROL}`,
    ]) {
      const { state } = await readRevisionChapter(
          fixture.projectPath,
          projectId,
          fixture.chapterId,
        ),
        next = document(text),
        options = {
          id: randomUUID(),
          created: new Date().toISOString(),
          authorLabel: REVISION_PRIVATE,
          tracking: true,
        };
      const plan = normalizeRevision(state, next, options),
        before = decodeEditorialDocument(state.review.proposed);
      if (plan.requiresCombine)
        throw new Error("Synthetic revision fixture unexpectedly overlaps");
      const steps = [
        {
          stepType: "replace",
          from: 0,
          to: before.content.size,
          slice: { content: next.content },
        },
        new RevisionStateStep(options.id, state, plan.state, {
          kind: "edit",
          options,
        }).toJSON(),
        new EditorialHistoryStep(randomUUID()).toJSON(),
      ];
      await saveChapter({
        projectPath: fixture.projectPath,
        chapterId: fixture.chapterId,
        operationId: randomUUID(),
        document: next,
        transactions: [
          { before: before.toJSON() as Record<string, unknown>, steps },
        ],
      });
    }
    return {
      ...fixture,
      projectId,
      chapterPath: join(
        fixture.projectPath,
        "manuscript",
        `${fixture.chapterId}.json`,
      ),
      view: await readRevisionChapter(
        fixture.projectPath,
        projectId,
        fixture.chapterId,
      ),
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}
