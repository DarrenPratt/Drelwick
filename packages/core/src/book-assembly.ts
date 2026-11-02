import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rmdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterFileSchema,
  ChapterFileV2Schema,
  ManuscriptDocumentSchema,
  manuscriptImageReferences,
  ImageAssetSchema,
} from "@drelwick/project-model";
import { ApplicationError } from "@drelwick/shared";
import type { BookRevision, BookAsset } from "@drelwick/renderer";
import { CHAPTER_CREATION_LOCK, openProject } from "./index.js";
import { readImageAsset, regularPath, boundedRead } from "./image-assets.js";
import {
  readBookPresentation,
  BOOK_PRESENTATION_FILE,
} from "./book-presentation.js";
import type { BookPresentation } from "@drelwick/project-model";
import { PUBLICATION_INCLUSION } from "@drelwick/shared";
import { readPublication, PUBLICATION_FILE } from "./publication.js";
import { readPrintConfiguration } from "./print-configuration.js";
import type { PrintConfigurationState } from "@drelwick/shared";

export interface AssembledBook {
  print?: PrintConfigurationState;
  presentation: BookPresentation;
  book: BookRevision;
  /** Captured validated originals, not paths to files that could change later. */
  assets: ReadonlyMap<string, Uint8Array>;
}
const failure = (code: string) =>
  new ApplicationError(
    code,
    "Unable to capture a consistent book revision. Save pending edits, resolve project recovery and retry.",
  );

/** Caller flushes its editor first. All cooperating project writers use this lock. */
export async function assembleBook(
  projectPath: string,
  options: {
    print?: boolean;
    /** Internal deterministic test seam, never exposed over IPC. */
    checkpoint?: (chapterId: string) => Promise<void>;
  } = {},
): Promise<AssembledBook> {
  await regularPath(projectPath, true);
  const lock = join(projectPath, CHAPTER_CREATION_LOCK);
  try {
    await mkdir(lock);
  } catch {
    throw failure("PROJECT_BUSY");
  }
  try {
    const started = Date.now();
    let capturedSize = 0;
    const checkPrintBudget = () => {
      if (
        options.print &&
        (capturedSize > 64 * 1024 * 1024 || Date.now() - started > 30_000)
      )
        throw failure("PRINT_RESOURCE_LIMIT");
    };
    const captured = new Map<string, Buffer>();
    const capture = async (path: string) => {
      checkPrintBudget();
      const bytes = await boundedRead(path, 64 * 1024 * 1024);
      capturedSize += bytes.byteLength;
      checkPrintBudget();
      captured.set(path, bytes);
      return bytes;
    };
    // Capture metadata before validation; verify it again after all content reads.
    await capture(join(projectPath, "project.json"));
    await capture(join(projectPath, "book.json"));
    const session = await openProject(
      projectPath,
      { rebuildSummaries: true },
      { readFile, lstat, realpath, writeJson: async () => undefined },
    );
    if (session.project.schemaVersion >= 2)
      await capture(join(projectPath, "format.json"));
    if (session.project.schemaVersion === 3)
      await capture(join(projectPath, session.project.editorialFile));
    const presentation = await readBookPresentation(
      projectPath,
      session.project.projectId,
    );
    const print = options.print
      ? await readPrintConfiguration(projectPath, session.project.projectId)
      : undefined;
    if (presentation.bytes)
      captured.set(
        join(projectPath, BOOK_PRESENTATION_FILE),
        presentation.bytes,
      );
    const chapters: BookRevision["chapters"][number][] = [];
    const publication = await readPublication(projectPath, session);
    if (publication.bytes)
      captured.set(join(projectPath, PUBLICATION_FILE), publication.bytes);
    const ids = new Set<string>();
    for (const id of session.project.manuscript.order) {
      const path = join(projectPath, "manuscript", `${id}.json`);
      try {
        await lstat(`${path}.tmp`);
        throw failure("CHAPTER_RECOVERY_REQUIRED");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      const rawChapter = JSON.parse((await capture(path)).toString("utf8"));
      const chapter =
        session.project.schemaVersion === 3
          ? ChapterFileV2Schema.safeParse(rawChapter)
          : ChapterFileSchema.safeParse(rawChapter);
      if (!chapter.success || chapter.data.id !== id)
        throw failure("PROJECT_SCHEMA_INVALID");
      const document = ManuscriptDocumentSchema.safeParse(
        chapter.data.schemaVersion === 2
          ? chapter.data.review.proposed
          : chapter.data.content,
      );
      if (!document.success) throw failure("CHAPTER_DOCUMENT_INVALID");
      chapters.push({
        publication: {
          section: "body",
          inclusion: publication.data.body.find((entry) => entry.id === id)
            ?.inclusion ?? { ...PUBLICATION_INCLUSION },
        },
        id,
        title: chapter.data.title,
        type: chapter.data.type,
        document: document.data,
      });
      manuscriptImageReferences(document.data).forEach((id) => ids.add(id));
      await options.checkpoint?.(id);
    }
    const matter = (placement: "front" | "back") =>
      publication.data.pages
        .filter((page) => page.placement === placement)
        .map((page) => {
          const document = ManuscriptDocumentSchema.parse(page.document);
          manuscriptImageReferences(document).forEach((id) => ids.add(id));
          return {
            id: page.id,
            title: page.title,
            type:
              placement === "front"
                ? ("frontmatter" as const)
                : ("backmatter" as const),
            document,
            publication: {
              section: placement,
              kind: page.type,
              inclusion: page.inclusion,
            },
          };
        });
    chapters.unshift(...matter("front"));
    chapters.push(...matter("back"));
    if (publication.data.coverAssetId) {
      const id = publication.data.coverAssetId;
      ids.add(id);
      chapters.unshift({
        id,
        title: "Ebook cover",
        type: "frontmatter",
        publication: {
          section: "front",
          kind: "cover",
          inclusion: { navigation: false, ebook: true, print: false },
        },
        document: ManuscriptDocumentSchema.parse({
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                assetId: id,
                alt: `${publication.data.metadata.title} cover`,
                size: "full",
              },
            },
          ],
        }),
      });
    }
    const descriptors: BookAsset[] = [];
    const assets = new Map<string, Uint8Array>();
    for (const id of ids) {
      try {
        const { asset, bytes } = await readImageAsset(projectPath, id);
        const { mediaType, width, height, byteSize, sha256 } = asset;
        const record = await capture(
          join(projectPath, "assets", "images", id, "asset.json"),
        );
        if (
          JSON.stringify(
            ImageAssetSchema.parse(JSON.parse(record.toString("utf8"))),
          ) !== JSON.stringify(asset)
        )
          throw failure("BOOK_REVISION_CHANGED");
        descriptors.push({
          status: "available",
          descriptor: { id, mediaType, width, height, byteSize, sha256 },
        });
        assets.set(id, new Uint8Array(bytes));
        capturedSize += bytes.byteLength;
        checkPrintBudget();
        captured.set(
          join(
            projectPath,
            "assets",
            "images",
            id,
            `original.${mediaType === "image/png" ? "png" : "jpg"}`,
          ),
          bytes,
        );
      } catch (error) {
        if (
          error instanceof ApplicationError &&
          (error.code === "BOOK_REVISION_CHANGED" ||
            error.code === "PRINT_RESOURCE_LIMIT")
        )
          throw error;
        let status: "missing" | "invalid" = "invalid";
        try {
          await lstat(join(projectPath, "assets", "images", id, "asset.json"));
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            status = "missing";
        }
        descriptors.push({ status, id });
      }
    }
    for (const [path, bytes] of captured) {
      checkPrintBudget();
      if (!(await boundedRead(path, 64 * 1024 * 1024)).equals(bytes))
        throw failure("BOOK_REVISION_CHANGED");
    }
    const value = {
      projectId: session.project.projectId,
      title: publication.data.metadata.title,
      language: publication.data.metadata.language,
      metadata: publication.data.metadata,
      ...(publication.data.coverAssetId
        ? { coverAssetId: publication.data.coverAssetId }
        : {}),
      chapters,
      assets: descriptors,
    };
    const revision = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    const latestPresentation = await readBookPresentation(
      projectPath,
      session.project.projectId,
    );
    if (
      (await readPublication(projectPath, session)).revision !==
      publication.revision
    )
      throw failure("BOOK_REVISION_CHANGED");
    if (
      JSON.stringify(presentation.settings) !==
      JSON.stringify(latestPresentation.settings)
    )
      throw failure("BOOK_REVISION_CHANGED");
    if (
      print &&
      (await readPrintConfiguration(projectPath, session.project.projectId))
        .revision !== print.revision
    )
      throw failure("BOOK_REVISION_CHANGED");
    return {
      ...(print ? { print } : {}),
      book: { ...value, revision },
      assets,
      presentation: presentation.settings,
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw failure("BOOK_ASSEMBLY_FAILED");
  } finally {
    await rmdir(lock);
  }
}
