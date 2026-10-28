import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isUuid } from "@drelwick/shared";
import {
  EditorialAnchorSchema,
  EditorialAnnotationSchema,
  EditorialStateSchema,
  EditorialThreadSchema,
  type EditorialState,
} from "@drelwick/project-model";
import { ApplicationError, createIsoDate, createUuid } from "@drelwick/shared";
import { openProject } from "./index.js";
import { editorialDocumentHash } from "./editorial-bundle.js";
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
  if (!isUuid(input.chapterId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid chapter identity.",
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
  const state = EditorialStateSchema.parse(
    JSON.parse(
      await readFile(
        join(input.projectPath, session.project.editorialFile),
        "utf8",
      ),
    ) as unknown,
  );
  const anchors = state.anchors.filter(
    (anchor) =>
      anchor.segments.some(
        (segment) => segment.chapterId === input.chapterId,
      ) || anchor.original.chapterId === input.chapterId,
  );
  const anchorIds = new Set(anchors.map((anchor) => anchor.id));
  const annotations = state.annotations.filter((annotation) =>
    anchorIds.has(annotation.anchorId),
  );
  const threadIds = new Set(
    annotations.map((annotation) => annotation.threadId),
  );
  return {
    generation: state.generation,
    anchors,
    annotations,
    threads: state.threads.filter((thread) => threadIds.has(thread.id)),
  };
}

/** Creates an annotation against the exact currently saved chapter revision. */
export async function createEditorialAnnotation(
  input: CreateEditorialAnnotationInput,
) {
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
  const chapter = JSON.parse(await readFile(chapterPath, "utf8")) as Record<
    string,
    unknown
  >;
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
  if (!documentGraphemeBoundaries(parsed.data.content, from, to))
    throw new ApplicationError(
      "EDITORIAL_RANGE_INVALID",
      "Select complete Unicode graphemes when adding an annotation.",
    );
  if (
    plainText(input.evidence.slice.content) !==
    documentTextRange(parsed.data.content, from, to)
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
  await commitState(
    input.projectPath,
    session.project,
    (state) => ({
      ...state,
      anchors: [...state.anchors, anchor],
      annotations: [...state.annotations, annotation],
      threads: [...state.threads, thread],
    }),
    "annotation",
  );
  return {
    annotation,
    anchor,
    thread,
    generation: session.project.generation + 1,
  };
}

export async function replyToEditorialThread(input: {
  projectPath: string;
  threadId: string;
  body: string;
  authorLabel?: string | null;
}) {
  if (!isUuid(input.threadId) || !input.body.trim())
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "A valid reply is required.",
    );
  return mutateEditorial(input.projectPath, "annotation", (state, now) => {
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
      comments: [...thread.comments, comment],
    });
    return { ...state, threads };
  });
}

/** Null explicitly tombstones a comment; an empty body remains a live comment. */
export async function updateEditorialComment(input: {
  projectPath: string;
  threadId: string;
  commentId: string;
  body: string | null;
}) {
  if (
    !isUuid(input.threadId) ||
    !isUuid(input.commentId) ||
    (input.body !== null &&
      (typeof input.body !== "string" || input.body.length > 100_000))
  )
    throw new ApplicationError("EDITORIAL_INVALID", "Invalid comment update.");
  return mutateEditorial(input.projectPath, "annotation", (state, now) => {
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
  });
}

export async function setEditorialThreadResolved(input: {
  projectPath: string;
  threadId: string;
  resolved: boolean;
}) {
  if (!isUuid(input.threadId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid discussion identity.",
    );
  return mutateEditorial(input.projectPath, "annotation", (state, now) => {
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
  });
}

export async function tombstoneEditorialAnnotation(input: {
  projectPath: string;
  annotationId: string;
}) {
  if (!isUuid(input.annotationId))
    throw new ApplicationError(
      "EDITORIAL_INVALID",
      "Invalid annotation identity.",
    );
  return mutateEditorial(input.projectPath, "annotation", (state, now) => {
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
              comments: item.comments.map((comment) => ({
                ...comment,
                deletedAt: now,
                modified: now,
              })),
            }
          : item,
      ),
    };
  });
}

/** Reattachment is an explicit author action; original evidence and lost slices remain intact. */
export async function reattachEditorialAnchor(input: {
  projectPath: string;
  anchorId: string;
  chapterId: string;
  from: number;
  to: number;
}) {
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
  const chapter = JSON.parse(await readFile(path, "utf8")) as unknown;
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
  if (!documentGraphemeBoundaries(parsed.data.content, input.from, input.to))
    throw new ApplicationError(
      "EDITORIAL_RANGE_INVALID",
      "Select complete Unicode graphemes when reattaching.",
    );
  return mutateEditorial(input.projectPath, "annotation", (state, now) => {
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
        ...anchor.segments.filter(
          (segment) => segment.chapterId !== input.chapterId,
        ),
        {
          chapterId: input.chapterId,
          chapterRevision: parsed.data.revision,
          documentHash: editorialDocumentHash(parsed.data.content),
          from: input.from,
          to: input.to,
          pointAffinity: "right",
        },
      ],
    });
    return { ...state, anchors };
  });
}

function documentNodeSize(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === "text")
    return typeof node.text === "string" ? node.text.length : 0;
  if (!Array.isArray(node.content)) return node.type === "doc" ? 0 : 1;
  const children = node.content.reduce<number>(
    (sum, child) => sum + documentNodeSize(child),
    0,
  );
  return node.type === "doc" ? children : children + 2;
}

function plainText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(plainText).join("");
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content)
    ? node.content.map(plainText).join("")
    : "";
}

function documentTextRange(
  document: unknown,
  from: number,
  to: number,
): string {
  let result = "";
  const visit = (value: unknown, position: number) => {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: unknown; text?: unknown; content?: unknown };
    if (node.type === "text" && typeof node.text === "string") {
      const start = Math.max(0, from - position);
      const end = Math.min(node.text.length, to - position);
      if (end > start) result += node.text.slice(start, end);
      return;
    }
    if (!Array.isArray(node.content)) return;
    let cursor = node.type === "doc" ? position : position + 1;
    for (const child of node.content) {
      visit(child, cursor);
      cursor += documentNodeSize(child);
    }
  };
  visit(document, 0);
  return result;
}

function documentGraphemeBoundaries(
  document: unknown,
  from: number,
  to: number,
): boolean {
  const valid = (target: number) => {
    let result = true;
    const visit = (value: unknown, position: number) => {
      if (!value || typeof value !== "object") return;
      const node = value as {
        type?: unknown;
        text?: unknown;
        content?: unknown;
      };
      if (node.type === "text" && typeof node.text === "string") {
        const end = position + node.text.length;
        if (target > position && target < end) {
          const relative = target - position;
          result = [
            ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(
              node.text,
            ),
          ].some((segment) => segment.index === relative);
          return;
        }
        return;
      }
      if (!Array.isArray(node.content)) return;
      let cursor = node.type === "doc" ? position : position + 1;
      for (const child of node.content) {
        visit(child, cursor);
        cursor += documentNodeSize(child);
      }
    };
    visit(document, 0);
    return result;
  };
  return valid(from) && valid(to);
}

async function commitState(
  projectPath: string,
  project: Extract<
    Awaited<ReturnType<typeof openProject>>["project"],
    { schemaVersion: 3 }
  >,
  update: (state: EditorialState) => EditorialState,
  kind: "annotation",
) {
  const path = join(projectPath, project.editorialFile);
  const current = EditorialStateSchema.parse(
    JSON.parse(await readFile(path, "utf8")) as unknown,
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
  return await commitEditorialTransaction({
    projectPath,
    projectId: project.projectId,
    kind,
    expectedGeneration: project.generation,
    changes: [
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
}

async function mutateEditorial(
  projectPath: string,
  kind: "annotation",
  update: (state: EditorialState, now: string) => EditorialState,
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
  );
  return { generation: result.generation };
}
