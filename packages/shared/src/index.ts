import { z } from "zod";

export * from "./dates.js";
export * from "./errors.js";
export * from "./identifiers.js";
export * from "./paths.js";
export * from "./result.js";

export const IPC = {
  PROJECT_SELECT_LOCATION: "project:select-location",
  PROJECT_CREATE: "project:create",
  PROJECT_OPEN: "project:open",
  RECENT_LIST: "project:recent-list",
  RECENT_OPEN: "project:recent-open",
  RECENT_REMOVE: "project:recent-remove",
  PROJECT_CLOSE: "project:close",
  PROJECT_LOAD_CHAPTER: "project:load-chapter",
  PROJECT_SAVE_CHAPTER: "project:save-chapter",
  CHAPTER_CREATE: "chapter:create",
  CHAPTER_RENAME: "chapter:rename",
  CHAPTER_DELETE: "chapter:delete",
  CHAPTER_REORDER: "chapter:reorder",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

const chapterId = z.string().trim().min(1);
const chapterTitle = z.string().trim().min(1).max(200);

export const CreateProjectRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    author: z.string().trim().min(1).max(500),
    language: z.string().trim().min(1).max(100),
    locationToken: z.string().uuid(),
  })
  .strict();
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export interface ProjectLocation {
  token: string;
  path: string;
}
export interface ProjectWorkspace {
  projectId: string;
  projectPath: string;
  title: string;
  author: string;
  language: string;
  chapters: { id: string; title: string; wordCount: number }[];
}
export interface RecentProject {
  id: string;
  path: string;
  title: string;
}
export type ProjectOperationResult<T> =
  | { ok: true; value: T; warning?: string }
  | { ok: false; error: { code: string; message: string } };

export const IpcRequestSchemas = {
  [IPC.PROJECT_CREATE]: CreateProjectRequestSchema,
  [IPC.PROJECT_SELECT_LOCATION]: z.undefined(),
  [IPC.PROJECT_OPEN]: z.undefined(),
  [IPC.RECENT_LIST]: z.undefined(),
  [IPC.RECENT_OPEN]: z.object({ id: z.string().uuid() }).strict(),
  [IPC.RECENT_REMOVE]: z.object({ id: z.string().uuid() }).strict(),
  [IPC.PROJECT_CLOSE]: z.undefined(),
  [IPC.PROJECT_LOAD_CHAPTER]: z.object({ chapterId }),
  [IPC.PROJECT_SAVE_CHAPTER]: z.object({
    chapterId,
    document: z.record(z.string(), z.unknown()),
  }),
  [IPC.CHAPTER_CREATE]: z.object({ title: chapterTitle }),
  [IPC.CHAPTER_RENAME]: z.object({ chapterId, title: chapterTitle }),
  [IPC.CHAPTER_DELETE]: z.object({ chapterId }),
  [IPC.CHAPTER_REORDER]: z.object({ chapterIds: z.array(chapterId).min(1) }),
} as const;

export type IpcRequestMap = {
  [Channel in IpcChannel]: z.input<(typeof IpcRequestSchemas)[Channel]>;
};

export function validateIpcPayload<Channel extends IpcChannel>(
  channel: Channel,
  payload: unknown,
): IpcRequestMap[Channel] {
  return IpcRequestSchemas[channel].parse(payload) as IpcRequestMap[Channel];
}

export interface BookEditorApi {
  project: {
    create(
      input: CreateProjectRequest,
    ): Promise<ProjectOperationResult<ProjectWorkspace>>;
    selectLocation(): Promise<ProjectOperationResult<ProjectLocation | null>>;
    open(): Promise<ProjectOperationResult<ProjectWorkspace | null>>;
    listRecent(): Promise<ProjectOperationResult<RecentProject[]>>;
    openRecent(
      id: string,
    ): Promise<ProjectOperationResult<ProjectWorkspace | null>>;
    removeRecent(id: string): Promise<ProjectOperationResult<RecentProject[]>>;
    renameChapter(
      input: RenameChapterRequest,
    ): Promise<ProjectOperationResult<ProjectWorkspace>>;
  };
  dialog: {
    selectImage(): Promise<void>;
    selectExportLocation(): Promise<void>;
  };
}

export interface RenameChapterRequest {
  chapterId: string;
  title: string;
}
