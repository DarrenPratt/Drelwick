import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadPublication,
  savePublication,
  saveBookTheme,
  openProject,
  replacePublicationCover,
} from "../../packages/core/src/index.js";
import { createMatterPage } from "../../packages/project-model/src/index.js";
import { copyFixture } from "./fixture-projects.js";
import { syntheticImage } from "./synthetic-images.js";

/** Synthetic complete book shared by native preview and adapter tests. */
export async function ebookProject() {
  const copy = await copyFixture("multi-chapter-book");
  try {
    const session = await openProject(copy.projectPath);
    const projectId = session.project.projectId;
    const initial = await loadPublication(copy.projectPath, projectId);
    const data = structuredClone(initial.data);
    data.metadata.title = 'A <script> & "book"';
    data.metadata.description =
      "<img src=\"https://remote.invalid\" onerror=\"require('child_process').exec('bad')\">";
    data.pages = (
      [
        "title",
        "copyright",
        "dedication",
        "acknowledgements",
        "author",
      ] as const
    ).map((type, index) =>
      createMatterPage(
        type,
        `00000000-0000-4000-8000-00000000080${index}`,
        data.metadata,
      ),
    );
    data.pages[2]!.inclusion = { ebook: false, print: true, navigation: true };
    data.pages[3]!.inclusion.navigation = false;
    data.body[1]!.inclusion.ebook = false;
    const sourcePath = join(copy.projectPath, "synthetic-cover.png");
    await writeFile(sourcePath, await syntheticImage());
    const covered = await replacePublicationCover({
      projectPath: copy.projectPath,
      projectId,
      expectedRevision: initial.revision,
      sourcePath,
    });
    data.coverAssetId = covered.data.coverAssetId!;
    await savePublication({
      projectPath: copy.projectPath,
      projectId,
      data,
      expectedRevision: covered.revision,
    });
    await saveBookTheme({
      projectPath: copy.projectPath,
      projectId,
      themeId: "literary",
    });
    const chapterPaths = session.project.manuscript.order.map((id) =>
      join(copy.projectPath, "manuscript", `${id}.json`),
    );
    const paths = [
      ...chapterPaths,
      ...[
        "project.json",
        "book.json",
        "publication.json",
        "presentation.json",
      ].map((name) => join(copy.projectPath, name)),
    ];
    const bytes = await Promise.all(paths.map((path) => readFile(path)));
    return {
      ...copy,
      projectId,
      data,
      chapterPaths,
      paths,
      bytes,
      assetId: data.coverAssetId,
    };
  } catch (error) {
    await copy.cleanup();
    throw error;
  }
}
