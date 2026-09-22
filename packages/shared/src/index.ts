import { z } from "zod";

export * from "./dates.js";
export * from "./errors.js";
export * from "./identifiers.js";
export * from "./logging.js";
export * from "./paths.js";
export * from "./result.js";
export * from "./word-count.js";

export const ChapterStatusSchema = z.enum([
  "draft",
  "revising",
  "review",
  "final",
]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const IPC = {
  RECOVERY_LIST: "recovery:list",
  RECOVERY_RECOVER: "recovery:recover",
  RECOVERY_DISCARD: "recovery:discard",
  RECOVERY_CANCEL: "recovery:cancel",
  PROJECT_SELECT_LOCATION: "project:select-location",
  PROJECT_CREATE: "project:create",
  PROJECT_OPEN: "project:open",
  RECENT_LIST: "project:recent-list",
  RECENT_OPEN: "project:recent-open",
  RECENT_REMOVE: "project:recent-remove",
  PROJECT_CLOSE: "project:close",
  PROJECT_BACKUP: "project:backup",
  PROJECT_RESTORE: "project:restore",
  PROJECT_LOAD_CHAPTER: "project:load-chapter",
  PROJECT_SAVE_CHAPTER: "project:save-chapter",
  IMAGE_IMPORT: "image:import",
  IMAGE_READ: "image:read",
  CHAPTER_CREATE: "chapter:create",
  CHAPTER_RENAME: "chapter:rename",
  CHAPTER_DELETE: "chapter:delete",
  CHAPTER_REORDER: "chapter:reorder",
  APPLICATION_RENDERER_ERROR: "application:renderer-error",
  APPLICATION_SHUTDOWN_READY: "application:shutdown-ready",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// Main-to-renderer notifications are separate from validated invoke requests.
export const SAVE_COMMAND_CHANNEL = "command:save";
export const APPLICATION_MENU_COMMAND_CHANNEL = "command:application-menu";
export const SHUTDOWN_REQUEST_CHANNEL = "application:shutdown-request";
export const ApplicationMenuCommandSchema = z.enum([
  "new-project",
  "open-project",
  "close-project",
  "backup-project",
  "restore-project",
]);
export type ApplicationMenuCommand = z.infer<
  typeof ApplicationMenuCommandSchema
>;

const chapterId = z.string().trim().min(1);
const chapterTitle = z.string().trim().min(1).max(200);
export const RendererErrorNameSchema = z.enum([
  "AggregateError",
  "ApplicationError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "UnknownError",
]);
export type RendererErrorName = z.infer<typeof RendererErrorNameSchema>;

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
  chapters: {
    id: string;
    title: string;
    status: ChapterStatus;
    wordCount: number;
  }[];
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
  [IPC.IMAGE_IMPORT]: z
    .object({ projectId: z.string().uuid(), chapterId: z.string().uuid() })
    .strict(),
  [IPC.IMAGE_READ]: z
    .object({
      projectId: z.string().uuid(),
      assetId: z
        .string()
        .regex(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
    })
    .strict(),
  [IPC.RECOVERY_LIST]: z.undefined(),
  [IPC.RECOVERY_CANCEL]: z.undefined(),
  [IPC.RECOVERY_RECOVER]: z.object({ id: z.string().uuid() }).strict(),
  [IPC.RECOVERY_DISCARD]: z.object({ id: z.string().uuid() }).strict(),
  [IPC.PROJECT_CREATE]: CreateProjectRequestSchema,
  [IPC.PROJECT_SELECT_LOCATION]: z.undefined(),
  [IPC.PROJECT_OPEN]: z.undefined(),
  [IPC.RECENT_LIST]: z.undefined(),
  [IPC.RECENT_OPEN]: z.object({ id: z.string().uuid() }).strict(),
  [IPC.RECENT_REMOVE]: z.object({ id: z.string().uuid() }).strict(),
  [IPC.PROJECT_CLOSE]: z.undefined(),
  [IPC.PROJECT_BACKUP]: z.object({ includeHistory: z.boolean() }).strict(),
  [IPC.PROJECT_RESTORE]: z.undefined(),
  [IPC.PROJECT_LOAD_CHAPTER]: z
    .object({ chapterId: z.string().uuid() })
    .strict(),
  [IPC.PROJECT_SAVE_CHAPTER]: z
    .object({
      chapterId: z.string().uuid(),
      document: z.record(z.string(), z.unknown()),
      source: z.enum(["autosave", "manual"]).default("autosave"),
    })
    .strict(),
  [IPC.CHAPTER_CREATE]: z.object({ title: chapterTitle }),
  [IPC.CHAPTER_RENAME]: z.object({ chapterId, title: chapterTitle }),
  [IPC.CHAPTER_DELETE]: z.object({ chapterId }),
  [IPC.CHAPTER_REORDER]: z.object({ chapterIds: z.array(chapterId).min(1) }),
  [IPC.APPLICATION_RENDERER_ERROR]: z
    .object({ errorName: RendererErrorNameSchema })
    .strict(),
  [IPC.APPLICATION_SHUTDOWN_READY]: z.object({ saved: z.boolean() }).strict(),
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

export interface RecoveryCandidateSummary {
  id: string;
  projectPath: string;
  chapterId: string;
  title: string;
  created: string;
  source: "temporary" | "history";
}

export interface BookEditorApi {
  reportRendererError(input: RendererErrorReport): Promise<void>;
  recovery: {
    list(): Promise<ProjectOperationResult<RecoveryCandidateSummary[]>>;
    recover(
      id: string,
    ): Promise<ProjectOperationResult<RecoveryCandidateSummary[]>>;
    discard(
      id: string,
    ): Promise<ProjectOperationResult<RecoveryCandidateSummary[]>>;
    cancel(): Promise<ProjectOperationResult<null>>;
  };

  onSaveRequested(callback: () => void): () => void;
  onApplicationMenuCommand(
    callback: (command: ApplicationMenuCommand) => void,
  ): () => void;
  onShutdownRequested(callback: () => Promise<boolean>): () => void;
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
    close(): Promise<ProjectOperationResult<null>>;
    backup(input: {
      includeHistory: boolean;
    }): Promise<ProjectOperationResult<{ created: boolean }>>;
    restore(): Promise<ProjectOperationResult<ProjectWorkspace | null>>;
    removeRecent(id: string): Promise<ProjectOperationResult<RecentProject[]>>;
    renameChapter(
      input: RenameChapterRequest,
    ): Promise<ProjectOperationResult<ProjectWorkspace>>;
    createChapter(
      input: CreateChapterRequest,
    ): Promise<ProjectOperationResult<ProjectWorkspace>>;
    deleteChapter(
      input: DeleteChapterRequest,
    ): Promise<ProjectOperationResult<ProjectWorkspace>>;
    reorderChapters(
      input: ReorderChaptersRequest,
    ): Promise<ProjectOperationResult<ProjectWorkspace>>;
    saveChapter(
      input: SaveChapterRequest,
    ): Promise<ProjectOperationResult<ChapterSaveReceipt>>;
    loadChapter(
      input: LoadChapterRequest,
    ): Promise<ProjectOperationResult<ChapterContent>>;
  };
  dialog: {
    selectImage(input: {
      projectId: string;
      chapterId: string;
    }): Promise<ProjectOperationResult<{ assetId: string } | null>>;
    selectExportLocation(): Promise<void>;
  };
  images: {
    read(input: {
      projectId: string;
      assetId: string;
    }): Promise<ProjectOperationResult<{ dataUrl: string }>>;
  };
}

export interface RendererErrorReport {
  errorName: RendererErrorName;
}

export interface RenameChapterRequest {
  chapterId: string;
  title: string;
}

export interface CreateChapterRequest {
  title: string;
}

export interface DeleteChapterRequest {
  chapterId: string;
}

export interface ReorderChaptersRequest {
  chapterIds: string[];
}

export interface LoadChapterRequest {
  chapterId: string;
}

export interface ChapterContent {
  id: string;
  content: Record<string, unknown>;
}

export interface SaveChapterRequest {
  chapterId: string;
  document: Record<string, unknown>;
  source?: "autosave" | "manual";
}

export interface ChapterSaveReceipt {
  id: string;
  modified: string;
}
