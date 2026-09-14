import { z } from "zod";

export const IPC = {
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

export const IpcRequestSchemas = {
  [IPC.PROJECT_CREATE]: z.undefined(),
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
    create(): Promise<void>;
    open(): Promise<void>;
  };
  dialog: {
    selectImage(): Promise<void>;
    selectExportLocation(): Promise<void>;
  };
}
