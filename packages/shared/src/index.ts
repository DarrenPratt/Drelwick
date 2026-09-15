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
export type ProjectOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export const IpcRequestSchemas = {
  [IPC.PROJECT_CREATE]: CreateProjectRequestSchema,
  [IPC.PROJECT_SELECT_LOCATION]: z.undefined(),
  [IPC.PROJECT_OPEN]: z.undefined(),
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
  };
  dialog: {
    selectImage(): Promise<void>;
    selectExportLocation(): Promise<void>;
  };
}
