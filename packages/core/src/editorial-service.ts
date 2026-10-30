import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isUuid, type EditorialExpectedFiles } from "@drelwick/shared";
export interface EditorialMutationExpected {
  operationId: string;
  expectedGeneration: number;
  expectedFiles: EditorialExpectedFiles;
  requestHash?: string;
}
import {
  parseEditorialJson,
  ChapterFileV2Schema,
  decodeEditorialDocument,
  decodeEditorialSlice,
  isEditorialDocumentBoundary,
  EditorialAnchorSchema,
  EditorialAnnotationSchema,
  EditorialStateSchema,
  EditorialThreadSchema,
  type EditorialState,
} from "@drelwick/project-model";
import { ApplicationError, createIsoDate, createUuid } from "@drelwick/shared";
import { openProject } from "./index.js";
import { editorialDocumentHash } from "./editorial-bundle.js";
import { registerEditorialMetadataEvent } from "./editorial-editing.js";
import { commitEditorialTransaction } from "./editorial-transactions.js";

export interface CreateEditorialAnnotationInput {
  projectPath: string;
  chapterId: string;
  from: number;
  to: number;
  kind: "comment" | "note" | "highlight";
  colour?: "yellow" | "blue" | "green" | "pink";
  body?: string;
  authorLabel?: string | null;
  evidence: {
    slice: {
      content: Record<string, unknown>[];
      openStart: number;
      openEnd: number;
    };
    prefix: string;
    suffix: string;
  };
}

export async function readEditorialChapter(input: {
  projectPath: string;
  chapterId: string;
}) {
  return readEditorialState(input);
}
export async function readEditorialProject(input: { projectPath: string }) {
  return readEditorialState(input);
}
async function readEditorialState(input: {
  projectPath: string;
  chapterId?: string;
}) {
  if (input.chapterId !== undefined && !isUuid(input.chapterId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid chapter identity.",
    );
  const session = await openProject(input.projectPath, {
    rebuildSummaries: true,
  });
  if (session.project.schemaVersion !== 3)
    throw new ApplicationError(
      "EDITORIAL_UNAVAILABLE",
      "This project has not been upgraded for annotations.",
    );
  if (
    input.chapterId &&
    !session.project.manuscript.order.includes(input.chapterId)
  )
    throw new ApplicationError(
      "CHAPTER_NOT_FOUND",
      "The selected chapter is no longer available.",
    );
  const capturedStateBytes = await readFile(
    join(input.projectPath, session.project.editorialFile),
  );
  const state = EditorialStateSchema.parse(
    parseEditorialJson(capturedStateBytes),
  );
  const anchors = state.anchors.filter(
    (anchor) =>
      !input.chapterId ||
      anchor.status === "orphaned" ||
      anchor.status === "unverified" ||
      anchor.segments.some(
        (segment) => segment.chapterId === input.chapterId,
      ) ||
      anchor.original.chapterId === input.chapterId,
  );
  const anchorIds = new Set(anchors.map((anchor) => anchor.id));
  const annotations = state.annotations.filter((annotation) =>
    anchorIds.has(annotation.anchorId),
  );
  const threadIds = new Set(
    annotations.map((annotation) => annotation.threadId),
  );
  const projectBytes = await readFile(join(input.projectPath, "project.json"));
  const chapterBytes = input.chapterId
    ? await readFile(
        join(input.projectPath, "manuscript", `${input.chapterId}.json`),
      )
    : undefined;
  const capturedChapter = chapterBytes
    ? ChapterFileV2Schema.parse(parseEditorialJson(chapterBytes))
    : undefined;
  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  return {
    generation: state.generation,
    chapters: session.chapters.map(({ id, title }) => ({ id, title })),
    ...(capturedChapter
      ? {
          documentIdentity: {
            storedHash: editorialDocumentHash(capturedChapter.review.proposed),
            editorHash: editorialDocumentHash(
              decodeEditorialDocument(capturedChapter.review.proposed).toJSON(),
            ),
          },
        }
      : {}),
    expectedFiles: {
      project: hash(projectBytes),
      editorial: hash(capturedStateBytes),
      chapters:
        chapterBytes && input.chapterId
          ? { [input.chapterId]: hash(chapterBytes) }
          : {},
    },
    anchors,
    annotations,
    threads: state.threads.filter((thread) => threadIds.has(thread.id)),
  };
}

/** Creates an annotation against the exact currently saved chapter revision. */
export async function createEditorialAnnotation(
  input: CreateEditorialAnnotationInput,
  expected?: EditorialMutationExpected,
) {
  if (!isUuid(input.chapterId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid chapter identity.",
    );
  const session = await openProject(input.projectPath, {
    rebuildSummaries: true,
  });
  if (session.project.schemaVersion !== 3)
    throw new ApplicationError(
      "EDITORIAL_UNAVAILABLE",
      "This project has not been migrated for local annotations.",
    );
  const chapterPath = join(
    input.projectPath,
    "manuscript",
    `${input.chapterId}.json`,
  );
  const chapter = parseEditorialJson(
    await readFile(chapterPath, "utf8"),
  ) as Record<string, unknown>;
  const parsed = await import("@drelwick/project-model").then(
    ({ ChapterFileV2Schema }) => ChapterFileV2Schema.safeParse(chapter),
  );
  if (
    !parsed.success ||
    parsed.data.id !== input.chapterId ||
    !session.project.manuscript.order.includes(input.chapterId)
  )
    throw new ApplicationError(
      "CHAPTER_NOT_FOUND",
      "The selected chapter is no longer available.",
    );
  const { from, to } = input;
  const documentSize = documentNodeSize(parsed.data.content);
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    from > to ||
    to > documentSize
  )
    throw new ApplicationError(
      "EDITORIAL_RANGE_INVALID",
      "Select a valid manuscript range.",
    );
  const semanticDocument = decodeEditorialDocument(parsed.data.content);
  if (
    !isEditorialDocumentBoundary(semanticDocument, from) ||
    !isEditorialDocumentBoundary(semanticDocument, to)
  )
    throw new ApplicationError(
      "EDITORIAL_RANGE_INVALID",
      "Select complete Unicode graphemes when adding an annotation.",
    );
  if (
    !semanticDocument
      .slice(from, to)
      .eq(decodeEditorialSlice(input.evidence.slice))
  )
    throw new ApplicationError(
      "EDITORIAL_EVIDENCE_STALE",
      "The selected text changed. Select it again before adding an annotation.",
    );
  const now = createIsoDate();
  const anchorId = createUuid();
  const annotationId = createUuid();
  const threadId = createUuid();
  const commentId = createUuid();
  const hash = editorialDocumentHash(parsed.data.content);
  const anchor = EditorialAnchorSchema.parse({
    schemaVersion: 1,
    id: anchorId,
    created: now,
    modified: now,
    deletedAt: null,
    status: "attached",
    segments: [
      {
        chapterId: input.chapterId,
        chapterRevision: parsed.data.revision,
        documentHash: hash,
        from,
        to,
        pointAffinity: "right",
      },
    ],
    lost: [],
    original: {
      chapterId: input.chapterId,
      documentHash: hash,
      from,
      to,
      slice: input.evidence.slice,
      prefix: input.evidence.prefix,
      suffix: input.evidence.suffix,
    },
  });
  const annotation = EditorialAnnotationSchema.parse({
    schemaVersion: 1,
    id: annotationId,
    anchorId,
    threadId,
    kind: input.kind,
    colour: input.kind === "highlight" ? (input.colour ?? "yellow") : null,
    created: now,
    modified: now,
    deletedAt: null,
  });
  const thread = EditorialThreadSchema.parse({
    schemaVersion: 1,
    id: threadId,
    state: "open",
    resolvedAt: null,
    created: now,
    modified: now,
    deletedAt: null,
    comments: input.body
      ? [
          {
            schemaVersion: 1,
            id: commentId,
            body: input.body,
            authorLabel: input.authorLabel ?? null,
            created: now,
            modified: now,
            deletedAt: null,
          },
        ]
      : [],
  });
  if (input.kind !== "highlight" && !thread.comments.length)
    throw new ApplicationError(
      "EDITORIAL_COMMENT_REQUIRED",
      "Add text to start a comment or note.",
    );
  const committed = await commitState(
    input.projectPath,
    session.project,
    (state) => ({
      ...state,
      anchors: [...state.anchors, anchor],
      annotations: [...state.annotations, annotation],
      threads: [...state.threads, thread],
    }),
    "annotation",
    expected,
  );
  return {
    annotation,
    anchor,
    thread,
    generation: session.project.generation + 1,
    ...(committed.historyEventId
      ? { historyEventId: committed.historyEventId }
      : {}),
  };
}

export async function replyToEditorialThread(
  input: {
    projectPath: string;
    threadId: string;
    body: string;
    authorLabel?: string | null;
  },
  expected?: EditorialMutationExpected,
) {
  if (!isUuid(input.threadId) || !input.body.trim())
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "A valid reply is required.",
    );
  return mutateEditorial(
    input.projectPath,
    "annotation",
    (state, now) => {
      const index = state.threads.findIndex(
        (thread) => thread.id === input.threadId,
      );
      if (index < 0 || state.threads[index]!.deletedAt)
        throw new ApplicationError(
          "EDITORIAL_NOT_FOUND",
          "The discussion is no longer available.",
        );
      const thread = state.threads[index]!;
      const comment = {
        schemaVersion: 1 as const,
        id: createUuid(),
        body: input.body,
        authorLabel: input.authorLabel ?? null,
        created: now,
        modified: now,
        deletedAt: null,
      };
      const threads = [...state.threads];
      threads[index] = EditorialThreadSchema.parse({
        ...thread,
        modified: now,
        comments: [...thread.comments, comment].sort((a, b) =>
          a.created < b.created
            ? -1
            : a.created > b.created
              ? 1
              : a.id < b.id
                ? -1
                : a.id > b.id
                  ? 1
                  : 0,
        ),
      });
      return { ...state, threads };
    },
    expected,
  );
}

/** Null explicitly tombstones a comment; an empty body remains a live comment. */
export async function updateEditorialComment(
  input: {
    projectPath: string;
    threadId: string;
    commentId: string;
    body: string | null;
  },
  expected?: EditorialMutationExpected,
) {
  if (
    !isUuid(input.threadId) ||
    !isUuid(input.commentId) ||
    (input.body !== null && typeof input.body !== "string")
  )
    throw new ApplicationError("EDITORIAL_INVALID", "Invalid comment update.");
  return mutateEditorial(
    input.projectPath,
    "annotation",
    (state, now) => {
      const thread = state.threads.find(
        (item) => item.id === input.threadId && !item.deletedAt,
      );
      const comment = thread?.comments.find(
        (item) => item.id === input.commentId && !item.deletedAt,
      );
      if (!thread || !comment)
        throw new ApplicationError(
          "EDITORIAL_NOT_FOUND",
          "The comment is no longer available.",
        );
      const updated = EditorialThreadSchema.parse({
        ...thread,
        modified: now,
        comments: thread.comments.map((item) =>
          item.id === comment.id
            ? {
                ...item,
                body: input.body === null ? item.body : input.body,
                modified: now,
                deletedAt: input.body === null ? now : null,
              }
            : item,
        ),
      });
      return {
        ...state,
        threads: state.threads.map((item) =>
          item.id === thread.id ? updated : item,
        ),
      };
    },
    expected,
  );
}

export async function setEditorialThreadResolved(
  input: {
    projectPath: string;
    threadId: string;
    resolved: boolean;
  },
  expected?: EditorialMutationExpected,
) {
  if (!isUuid(input.threadId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid discussion identity.",
    );
  return mutateEditorial(
    input.projectPath,
    "annotation",
    (state, now) => {
      const index = state.threads.findIndex(
        (thread) => thread.id === input.threadId,
      );
      if (index < 0 || state.threads[index]!.deletedAt)
        throw new ApplicationError(
          "EDITORIAL_NOT_FOUND",
          "The discussion is no longer available.",
        );
      const threads = [...state.threads];
      const thread = threads[index]!;
      threads[index] = EditorialThreadSchema.parse({
        ...thread,
        state: input.resolved ? "resolved" : "open",
        resolvedAt: input.resolved ? (thread.resolvedAt ?? now) : null,
        modified: now,
      });
      return { ...state, threads };
    },
    expected,
  );
}

export async function tombstoneEditorialAnnotation(
  input: {
    projectPath: string;
    annotationId: string;
  },
  expected?: EditorialMutationExpected,
) {
  if (!isUuid(input.annotationId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid annotation identity.",
    );
  return mutateEditorial(
    input.projectPath,
    "annotation",
    (state, now) => {
      const annotation = state.annotations.find(
        (item) => item.id === input.annotationId,
      );
      if (!annotation || annotation.deletedAt)
        throw new ApplicationError(
          "EDITORIAL_NOT_FOUND",
          "The annotation is no longer available.",
        );
      return {
        ...state,
        annotations: state.annotations.map((item) =>
          item.id === annotation.id
            ? { ...item, deletedAt: now, modified: now }
            : item,
        ),
        anchors: state.anchors.map((item) =>
          item.id === annotation.anchorId
            ? { ...item, deletedAt: now, modified: now }
            : item,
        ),
        threads: state.threads.map((item) =>
          item.id === annotation.threadId
            ? {
                ...item,
                deletedAt: now,
                modified: now,
                // Individual comment tombstones survive annotation delete/restore.
                comments: item.comments,
              }
            : item,
        ),
      };
    },
    expected,
  );
}

/** Reattachment is an explicit author action; original evidence and lost slices remain intact. */
export async function reattachEditorialAnchor(
  input: {
    projectPath: string;
    anchorId: string;
    chapterId: string;
    from: number;
    to: number;
  },
  expected?: EditorialMutationExpected,
) {
  if (!isUuid(input.anchorId) || !isUuid(input.chapterId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid annotation target.",
    );
  const session = await openProject(input.projectPath, {
    rebuildSummaries: true,
  });
  if (
    session.project.schemaVersion !== 3 ||
    !session.project.manuscript.order.includes(input.chapterId)
  )
    throw new ApplicationError(
      "CHAPTER_NOT_FOUND",
      "The selected chapter is no longer available.",
    );
  const path = join(input.projectPath, "manuscript", `${input.chapterId}.json`);
  const chapter = parseEditorialJson(await readFile(path, "utf8")) as unknown;
  const { ChapterFileV2Schema } = await import("@drelwick/project-model");
  const parsed = ChapterFileV2Schema.safeParse(chapter);
  if (!parsed.success)
    throw new ApplicationError(
      "PROJECT_SCHEMA_INVALID",
      "The selected chapter is invalid.",
    );
  const size = documentNodeSize(parsed.data.content);
  if (
    !Number.isSafeInteger(input.from) ||
    !Number.isSafeInteger(input.to) ||
    input.from < 0 ||
    input.from > input.to ||
    input.to > size
  )
    throw new ApplicationError(
      "EDITORIAL_RANGE_INVALID",
      "Select a valid manuscript range.",
    );
  const semanticDocument = decodeEditorialDocument(parsed.data.content);
  if (
    !isEditorialDocumentBoundary(semanticDocument, input.from) ||
    !isEditorialDocumentBoundary(semanticDocument, input.to)
  )
    throw new ApplicationError(
      "EDITORIAL_RANGE_INVALID",
      "Select complete Unicode graphemes when reattaching.",
    );
  return mutateEditorial(
    input.projectPath,
    "annotation",
    (state, now) => {
      const index = state.anchors.findIndex(
        (anchor) => anchor.id === input.anchorId,
      );
      if (index < 0 || state.anchors[index]!.deletedAt)
        throw new ApplicationError(
          "EDITORIAL_NOT_FOUND",
          "The annotation is no longer available.",
        );
      const anchors = [...state.anchors];
      const anchor = anchors[index]!;
      anchors[index] = EditorialAnchorSchema.parse({
        ...anchor,
        modified: now,
        status: anchor.lost.length ? "partial" : "attached",
        segments: [
          {
            chapterId: input.chapterId,
            chapterRevision: parsed.data.revision,
            documentHash: editorialDocumentHash(parsed.data.content),
            from: input.from,
            to: input.to,
            pointAffinity: "right",
          },
        ].sort(
          (a, b) =>
            session.project.manuscript.order.indexOf(a.chapterId) -
              session.project.manuscript.order.indexOf(b.chapterId) ||
            a.from - b.from ||
            a.to - b.to,
        ),
      });
      return { ...state, anchors };
    },
    expected,
  );
}

function documentNodeSize(value: unknown): number {
  return decodeEditorialDocument(value).content.size;
}

async function commitState(
  projectPath: string,
  project: Extract<
    Awaited<ReturnType<typeof openProject>>["project"],
    { schemaVersion: 3 }
  >,
  update: (state: EditorialState) => EditorialState,
  kind: "annotation",
  expected?: EditorialMutationExpected,
) {
  const path = join(projectPath, project.editorialFile);
  const currentBytes = await readFile(path);
  const current = EditorialStateSchema.parse(
    parseEditorialJson(currentBytes) as unknown,
  );
  if (expected && expected.expectedGeneration !== project.generation)
    throw new ApplicationError(
      "EDITORIAL_STALE",
      "The discussion changed. Refresh and review before retrying.",
    );
  if (current.generation !== project.generation)
    throw new ApplicationError(
      "EDITORIAL_STALE",
      "The project changed. Refresh and retry.",
    );
  const modified = createIsoDate();
  const state = EditorialStateSchema.parse({
    ...update(current),
    generation: current.generation + 1,
  });
  const nextProject = {
    ...project,
    modified,
    generation: project.generation + 1,
  };
  const expectedBefore: Record<string, string | null> = {
    [project.editorialFile]: createHash("sha256")
      .update(currentBytes)
      .digest("hex"),
  };
  if (expected) {
    expectedBefore["project.json"] = expected.expectedFiles.project;
    expectedBefore[project.editorialFile] = expected.expectedFiles.editorial;
    for (const [id, hash] of Object.entries(expected.expectedFiles.chapters)) {
      if (!isUuid(id) || !project.manuscript.order.includes(id))
        throw new ApplicationError(
          "EDITORIAL_INVALID",
          "Invalid chapter precondition.",
        );
      expectedBefore[`manuscript/${id}.json`] = hash;
    }
  }
  const chapterIds = Object.keys(expected?.expectedFiles.chapters ?? {});
  const chapterId = chapterIds.length === 1 ? chapterIds[0] : undefined;
  if (
    chapterId &&
    (!isUuid(chapterId) || !project.manuscript.order.includes(chapterId))
  )
    throw new ApplicationError(
      "EDITORIAL_STALE",
      "The selected chapter changed.",
    );
  const chapterBytes = chapterId
    ? await readFile(join(projectPath, "manuscript", `${chapterId}.json`))
    : undefined;
  const chapter = chapterBytes
    ? ChapterFileV2Schema.parse(parseEditorialJson(chapterBytes))
    : undefined;
  const committed = await commitEditorialTransaction({
    projectPath,
    ...(expected
      ? {
          operationId: expected.operationId,
          ...(expected.requestHash
            ? { requestHash: expected.requestHash }
            : {}),
        }
      : {}),
    projectId: project.projectId,
    kind,
    expectedGeneration: project.generation,
    expectedBefore,
    changes: [
      ...(chapterId && chapterBytes
        ? [{ path: `manuscript/${chapterId}.json`, after: chapterBytes }]
        : []),
      {
        path: project.editorialFile,
        after: Buffer.from(`${JSON.stringify(state, null, 2)}\n`),
      },
      {
        path: "project.json",
        after: Buffer.from(`${JSON.stringify(nextProject, null, 2)}\n`),
      },
    ],
  });
  if (chapterId && chapter) {
    registerEditorialMetadataEvent(
      `${await realpath(projectPath)}\0${chapterId}`,
      committed.operationId,
      chapter.review.proposed,
      current,
      state,
    );
    return { ...committed, historyEventId: committed.operationId };
  }
  return { ...committed, historyEventId: undefined };
}

async function mutateEditorial(
  projectPath: string,
  kind: "annotation",
  update: (state: EditorialState, now: string) => EditorialState,
  expected?: EditorialMutationExpected,
) {
  const session = await openProject(projectPath, { rebuildSummaries: true });
  if (session.project.schemaVersion !== 3)
    throw new ApplicationError(
      "EDITORIAL_UNAVAILABLE",
      "This project has not been migrated for local annotations.",
    );
  const result = await commitState(
    projectPath,
    session.project,
    (state) => update(state, createIsoDate()),
    kind,
    expected,
  );
  return {
    generation: result.generation,
    ...(result.historyEventId ? { historyEventId: result.historyEventId } : {}),
  };
}

/** Restore the owned records together, preserving independently deleted comments. */
export async function restoreEditorialAnnotation(
  input: {
    projectPath: string;
    annotationId: string;
  },
  expected?: EditorialMutationExpected,
) {
  if (!isUuid(input.annotationId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid annotation identity.",
    );
  return mutateEditorial(
    input.projectPath,
    "annotation",
    (state, now) => {
      const annotation = state.annotations.find(
        (item) => item.id === input.annotationId && item.deletedAt,
      );
      if (!annotation)
        throw new ApplicationError(
          "EDITORIAL_NOT_FOUND",
          "The deleted annotation is no longer available.",
        );
      return {
        ...state,
        annotations: state.annotations.map((item) =>
          item.id === annotation.id
            ? { ...item, deletedAt: null, modified: now }
            : item,
        ),
        anchors: state.anchors.map((item) =>
          item.id === annotation.anchorId
            ? { ...item, deletedAt: null, modified: now }
            : item,
        ),
        threads: state.threads.map((item) =>
          item.id === annotation.threadId
            ? { ...item, deletedAt: null, modified: now }
            : item,
        ),
      };
    },
    expected,
  );
}

export async function setEditorialAnnotationColour(
  input: {
    projectPath: string;
    annotationId: string;
    colour: "yellow" | "blue" | "green" | "pink";
  },
  expected?: EditorialMutationExpected,
) {
  return mutateEditorial(
    input.projectPath,
    "annotation",
    (state, now) => {
      const annotation = state.annotations.find(
        (item) =>
          item.id === input.annotationId &&
          !item.deletedAt &&
          item.kind === "highlight",
      );
      if (!annotation)
        throw new ApplicationError(
          "EDITORIAL_NOT_FOUND",
          "The highlight is no longer available.",
        );
      return {
        ...state,
        annotations: state.annotations.map((item) =>
          item.id === annotation.id
            ? EditorialAnnotationSchema.parse({
                ...item,
                colour: input.colour,
                modified: now,
              })
            : item,
        ),
      };
    },
    expected,
  );
}
