import { join } from "node:path";
import {
  openProjectForEditing,
  migrateProjectToEditorialV3,
  saveChapter,
  createEditorialAnnotation,
} from "../../packages/core/src/index.js";
import { copyFixture } from "./fixture-projects.js";

export const EDITORIAL_CANARIES = [
  "PRIVATE_RETAINED_CANARY",
  "PRIVATE_COMMENT_CANARY",
  "PRIVATE_NOTE_CANARY",
  "PRIVATE_HIGHLIGHT_CANARY",
  "PRIVATE_AUTHOR_CANARY",
];
export const PUBLICATION_CONTROL = "Publication control text.";

/** Real v3 authoring saves with overlapping discussions and retained deleted prose. */
export async function editorialProject() {
  const fixture = await copyFixture("minimal-book");
  try {
    const session = await openProjectForEditing(fixture.projectPath);
    const chapterId = session.project.manuscript.order[0]!;
    await migrateProjectToEditorialV3(fixture.projectPath);
    const prefix = `${PUBLICATION_CONTROL} `;
    const selected = EDITORIAL_CANARIES[0]!;
    const before = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: prefix + selected }],
        },
      ],
    };
    await saveChapter({
      projectPath: fixture.projectPath,
      chapterId,
      document: before,
    });
    const from = 1 + prefix.length;
    const to = from + selected.length;
    for (const [index, kind] of (
      ["comment", "note", "highlight"] as const
    ).entries())
      await createEditorialAnnotation({
        projectPath: fixture.projectPath,
        chapterId,
        from,
        to,
        kind,
        body: EDITORIAL_CANARIES[index + 1]!,
        authorLabel: EDITORIAL_CANARIES[4]!,
        evidence: {
          slice: {
            content: [{ type: "text", text: selected }],
            openStart: 0,
            openEnd: 0,
          },
          prefix,
          suffix: "",
        },
      });
    await saveChapter({
      projectPath: fixture.projectPath,
      chapterId,
      document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: prefix }] },
        ],
      },
      transactions: [{ before, steps: [{ stepType: "replace", from, to }] }],
      editorGeneration: 2,
    });
    return {
      ...fixture,
      chapterId,
      editorialPath: join(fixture.projectPath, "editorial/state.json"),
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}
