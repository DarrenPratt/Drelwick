import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "@tiptap/pm/transform";
import { decodeEditorialDocument } from "@drelwick/project-model";
import { expect, it } from "vitest";
import { editorialProject } from "../../../tests/helpers/editorial-project.js";
import {
  StagedManuscriptImport,
  createEditorialAnnotation,
  loadChapter,
  migrateProjectToEditorialV3,
  openProject,
  saveChapter,
} from "../src/index.js";

it("A10 identical imported titles and text receive new identities and no discussions; paste maps the existing target", async () => {
  const fixture = await editorialProject();
  const scratch = await mkdtemp(join(tmpdir(), "editorial-import-"));
  let stage: StagedManuscriptImport | undefined;
  try {
    const chapter = await loadChapter({
      projectPath: fixture.projectPath,
      chapterId: fixture.chapterId,
    });
    const annotation = await createEditorialAnnotation({
      projectPath: fixture.projectPath,
      chapterId: fixture.chapterId,
      from: 1,
      to: 12,
      kind: "comment",
      body: "Private original discussion",
      evidence: {
        slice: {
          content: [{ type: "text", text: "Publication" }],
          openStart: 0,
          openEnd: 0,
        },
        prefix: "",
        suffix: "",
      },
    });
    const beforeState = await readFile(fixture.editorialPath);
    const source = join(scratch, "same-title.txt");
    const destination = join(scratch, "imported");
    await mkdir(destination);
    await writeFile(source, "Synthetic source remains unchanged");
    const signal = new AbortController().signal;
    stage = await StagedManuscriptImport.inspect(
      source,
      {
        parse: async () =>
          JSON.stringify({
            metadata: {
              title: "Minimal Fixture",
              author: "Synthetic author",
              language: "en",
            },
            chapters: [
              {
                title: "Chapter One",
                type: "chapter",
                content: chapter.content,
              },
            ],
            assets: [],
            warnings: [],
          }),
      },
      { signal },
    );
    const imported = await stage.commit(destination, { signal });
    await migrateProjectToEditorialV3(destination);
    const opened = await openProject(destination);
    expect(imported.projectId).not.toBe(
      (await openProject(fixture.projectPath)).project.projectId,
    );
    expect(opened.project.manuscript.order).not.toContain(fixture.chapterId);
    expect(
      JSON.parse(
        await readFile(join(destination, "editorial/state.json"), "utf8"),
      ),
    ).toMatchObject({ anchors: [], annotations: [], threads: [] });
    expect(await readFile(fixture.editorialPath)).toEqual(beforeState);
    const doc = decodeEditorialDocument(chapter.content);
    const pasted = new Transform(doc).insert(
      1,
      doc.type.schema.text("Pasted "),
    );
    await saveChapter({
      projectPath: fixture.projectPath,
      chapterId: fixture.chapterId,
      document: pasted.doc.toJSON() as Record<string, unknown>,
      transactions: [
        {
          before: chapter.content,
          steps: pasted.steps.map(
            (step) => step.toJSON() as Record<string, unknown>,
          ),
        },
      ],
    });
    const state = JSON.parse(await readFile(fixture.editorialPath, "utf8"));
    expect(
      state.anchors.find(
        (item: { id: string }) => item.id === annotation.anchor.id,
      ),
    ).toMatchObject({
      status: "attached",
      segments: [{ from: 8, to: 19 }],
      lost: [],
    });
    expect(
      state.threads.find(
        (item: { id: string }) => item.id === annotation.thread.id,
      ).comments[0].body,
    ).toBe("Private original discussion");
  } finally {
    await stage?.discard();
    await fixture.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});
