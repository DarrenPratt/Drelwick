import {
  PrintSaveRequestSchema,
  PrintExportRequestSchema,
  type PrintExportReceipt,
  type PrintConfigurationState,
  type PrintPreview,
} from "./print-contracts.js";
export * from "./print-contracts.js";
import { z } from "zod";
import {
  ReferenceRequestSchema,
  type ReferenceRequest,
  type ReferenceResponse,
} from "./reference-contracts.js";
export * from "./reference-contracts.js";
export * from "./global-search-contracts.js";
import type { DocxExportReceipt } from "./docx-contracts.js";
import type { EpubExportReceipt } from "./epub-contracts.js";
export * from "./docx-contracts.js";
export * from "./epub-contracts.js";
import {
  SpellingCheckSchema,
  SpellingSuggestSchema,
  SpellingUpdateSchema,
  type SpellingCheck,
  type SpellingState,
  type SpellingUpdate,
} from "./spelling-contracts.js";
export * from "./spelling-contracts.js";
import {
  PublicationSaveRequestSchema,
  PublicationCoverRequestSchema,
  type PublicationState,
} from "./publication-contracts.js";
export * from "./publication-contracts.js";
import {
  BuiltinThemeIdSchema,
  type BuiltinThemeId,
  type BookThemeSelection,
} from "./theme-contracts.js";
export * from "./theme-contracts.js";
import {
  ReplacementRequestSchema,
  type ReplacementRequest,
} from "./search-contracts.js";
export * from "./search-contracts.js";
import {
  ImportInspectRequestSchema,
  ImportCommitRequestSchema,
  type ImportReview,
  ImportTokenRequestSchema,
  type ImportInspection,
} from "./import-contracts.js";
export * from "./import-contracts.js";

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

const organisationBase = {
  projectId: z.string().uuid(),
  expectedOrder: z.array(z.string().uuid()),
};
export const ChapterOrganisationRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        ...organisationBase,
        operation: z.literal("duplicate"),
        chapterId: z.string().uuid(),
      })
      .strict(),
    z
      .object({
        ...organisationBase,
        operation: z.literal("split"),
        chapterId: z.string().uuid(),
        position: z.number().int().nonnegative(),
        expectedContent: z.record(z.string(), z.unknown()),
      })
      .strict(),
    z
      .object({
        ...organisationBase,
        operation: z.literal("merge"),
        chapterIds: z.tuple([z.string().uuid(), z.string().uuid()]),
        confirmed: z.literal(true),
      })
      .strict(),
    z
      .object({
        ...organisationBase,
        operation: z.literal("status"),
        chapterId: z.string().uuid(),
        status: ChapterStatusSchema,
      })
      .strict(),
  ],
);
export type ChapterOrganisationRequest = z.infer<
  typeof ChapterOrganisationRequestSchema
>;

export const IPC = {
  REFERENCE_EXECUTE: "reference:execute",
  DOCX_EXPORT: "docx:export",
  EPUB_EXPORT: "epub:export",
  SPELLING_GET: "spelling:get",
  SPELLING_UPDATE: "spelling:update",
  SPELLING_CHECK: "spelling:check",
  SPELLING_SUGGEST: "spelling:suggest",
  PUBLICATION_GET: "publication:get",
  PUBLICATION_SAVE: "publication:save",
  PUBLICATION_COVER: "publication:cover",
  PRINT_GET: "book:print-get",
  PRINT_EXPORT: "book:print-export",
  PRINT_EXPORT_CANCEL: "book:print-export-cancel",
  PRINT_EXPORT_STATUS: "book:print-export-status",
  PRINT_PREVIEW: "book:print-preview",
  PRINT_SAVE: "book:print-save",
  BOOK_THEME_GET: "book:theme-get",
  BOOK_THEME_SET: "book:theme-set",
  BOOK_PREVIEW: "book:preview",
  BOOK_PREVIEW_SIMULATE: "book:preview-simulate",
  BOOK_PREVIEW_STATUS: "book:preview-status",
  HISTORY_LIST: "history:list",
  HISTORY_PREVIEW: "history:preview",
  HISTORY_RESTORE: "history:restore",
  CHAPTER_ORGANISE: "chapter:organise",
  MANUSCRIPT_REPLACE: "manuscript:replace",
  MANUSCRIPT_CANCEL_REPLACE: "manuscript:cancel-replace",
  IMPORT_INSPECT: "import:inspect",
  IMPORT_COMMIT: "import:commit",
  IMPORT_OPEN: "import:open",
  IMPORT_CANCEL: "import:cancel",
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
  "import-manuscript",
  "find-manuscript",
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
/** Passive preview data only. No project paths or callable capabilities. */
export interface BookPreview {
  theme: BookThemeSelection;
  revision: string;
  document: string;
  complete: boolean;
  diagnostics: readonly {
    code: string;
    severity: "error" | "warning";
    chapterId: string;
    path: readonly number[];
    assetId?: string;
  }[];
}
/** Ephemeral reader presentation. Never persisted as book settings. */
export const EbookSimulationSchema = z
  .object({
    fontSize: z.number().int().min(12).max(32),
    appearance: z.enum(["light", "dark"]),
  })
  .strict();
export type EbookSimulation = z.infer<typeof EbookSimulationSchema>;
const PreviewIdentitySchema = z
  .object({
    projectId: z.string().uuid(),
    revision: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export interface RecentProject {
  id: string;
  path: string;
  title: string;
}
export type ProjectOperationResult<T> =
  | { ok: true; value: T; warning?: string }
  | { ok: false; error: { code: string; message: string } };

export const IpcRequestSchemas = {
  [IPC.REFERENCE_EXECUTE]: ReferenceRequestSchema,
  [IPC.PRINT_GET]: z.object({ projectId: z.string().uuid() }).strict(),
  [IPC.PRINT_EXPORT]: PrintExportRequestSchema,
  [IPC.PRINT_EXPORT_CANCEL]: z
    .object({ projectId: z.string().uuid() })
    .strict(),
  [IPC.PRINT_EXPORT_STATUS]: z
    .object({ projectId: z.string().uuid() })
    .strict(),
  [IPC.PRINT_PREVIEW]: z.object({ projectId: z.string().uuid() }).strict(),
  [IPC.PRINT_SAVE]: PrintSaveRequestSchema,
  [IPC.SPELLING_GET]: z.undefined(),
  [IPC.SPELLING_UPDATE]: SpellingUpdateSchema,
  [IPC.SPELLING_CHECK]: SpellingCheckSchema,
  [IPC.SPELLING_SUGGEST]: SpellingSuggestSchema,
  [IPC.PUBLICATION_GET]: z.object({ projectId: z.string().uuid() }).strict(),
  [IPC.PUBLICATION_SAVE]: PublicationSaveRequestSchema,
  [IPC.PUBLICATION_COVER]: PublicationCoverRequestSchema,
  [IPC.BOOK_THEME_GET]: z.object({ projectId: z.string().uuid() }).strict(),
  [IPC.BOOK_THEME_SET]: z
    .object({
      projectId: z.string().uuid(),
      themeId: BuiltinThemeIdSchema,
      previewRevision: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    })
    .strict(),
  [IPC.BOOK_PREVIEW]: z.object({ projectId: z.string().uuid() }).strict(),
  [IPC.DOCX_EXPORT]: z.object({ projectId: z.string().uuid() }).strict(),
  [IPC.EPUB_EXPORT]: z.object({ projectId: z.string().uuid() }).strict(),
  [IPC.BOOK_PREVIEW_SIMULATE]: PreviewIdentitySchema.extend({
    simulation: EbookSimulationSchema,
  }).strict(),
  [IPC.BOOK_PREVIEW_STATUS]: PreviewIdentitySchema,
  [IPC.HISTORY_LIST]: z
    .object({ projectId: z.string().uuid(), chapterId: z.string().uuid() })
    .strict(),
  [IPC.HISTORY_PREVIEW]: z
    .object({
      projectId: z.string().uuid(),
      chapterId: z.string().uuid(),
      snapshotId: z.string().uuid(),
    })
    .strict(),
  [IPC.HISTORY_RESTORE]: z
    .object({
      projectId: z.string().uuid(),
      chapterId: z.string().uuid(),
      snapshotId: z.string().uuid(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      document: z.record(z.string(), z.unknown()),
      confirmed: z.literal(true),
    })
    .strict(),
  [IPC.CHAPTER_ORGANISE]: ChapterOrganisationRequestSchema,
  [IPC.MANUSCRIPT_REPLACE]: ReplacementRequestSchema,
  [IPC.MANUSCRIPT_CANCEL_REPLACE]: z.undefined(),
  [IPC.IMPORT_INSPECT]: ImportInspectRequestSchema,
  [IPC.IMPORT_OPEN]: ImportTokenRequestSchema,
  [IPC.IMPORT_COMMIT]: ImportCommitRequestSchema,
  [IPC.IMPORT_CANCEL]: ImportTokenRequestSchema,
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

export interface DrelwickApi {
  references: {
    execute(
      input: ReferenceRequest,
    ): Promise<ProjectOperationResult<ReferenceResponse>>;
  };
  spelling: {
    get(): Promise<ProjectOperationResult<SpellingState>>;
    update(
      input: SpellingUpdate,
    ): Promise<ProjectOperationResult<SpellingState>>;
    check(
      input: z.infer<typeof SpellingCheckSchema>,
    ): Promise<ProjectOperationResult<SpellingCheck>>;
    suggest(
      input: z.infer<typeof SpellingSuggestSchema>,
    ): Promise<ProjectOperationResult<string[]>>;
  };
  imports: {
    inspect(
      input: z.infer<typeof ImportInspectRequestSchema>,
    ): Promise<ProjectOperationResult<ImportInspection | null>>;
    open(
      operationId: string,
    ): Promise<ProjectOperationResult<ProjectWorkspace | null>>;
    commit(
      operationId: string,
      review: ImportReview,
    ): Promise<ProjectOperationResult<{ projectId: string } | null>>;
    cancel(operationId: string): Promise<ProjectOperationResult<null>>;
  };
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
    getPublication(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<PublicationState>>;
    savePublication(
      input: z.infer<typeof PublicationSaveRequestSchema>,
    ): Promise<ProjectOperationResult<PublicationState>>;
    selectPublicationCover(
      input: z.infer<typeof PublicationCoverRequestSchema>,
    ): Promise<ProjectOperationResult<PublicationState | null>>;
    getPrintConfiguration(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<PrintConfigurationState>>;
    savePrintConfiguration(
      input: z.infer<typeof PrintSaveRequestSchema>,
    ): Promise<ProjectOperationResult<PrintConfigurationState>>;
    getBookTheme(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<BookThemeSelection>>;
    setBookTheme(input: {
      projectId: string;
      themeId: BuiltinThemeId;
      previewRevision?: string;
    }): Promise<
      ProjectOperationResult<{
        selection: BookThemeSelection;
        preview?: BookPreview;
      }>
    >;
    previewBook(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<BookPreview>>;
    exportPrint(
      input: z.infer<typeof PrintExportRequestSchema>,
    ): Promise<ProjectOperationResult<PrintExportReceipt>>;
    cancelPrintExport(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<null>>;
    printExportStatus(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<string>>;
    previewPrint(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<PrintPreview>>;
    exportDocx(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<DocxExportReceipt>>;
    exportEpub(input: {
      projectId: string;
    }): Promise<ProjectOperationResult<EpubExportReceipt>>;
    simulateBookPreview(input: {
      projectId: string;
      revision: string;
      simulation: EbookSimulation;
    }): Promise<ProjectOperationResult<BookPreview>>;
    bookPreviewStatus(input: {
      projectId: string;
      revision: string;
    }): Promise<ProjectOperationResult<{ stale: boolean }>>;
    listHistory(
      input: HistoryRequest,
    ): Promise<ProjectOperationResult<ChapterHistory>>;
    previewHistory(
      input: HistorySelection,
    ): Promise<ProjectOperationResult<HistoryPreview>>;
    restoreHistory(
      input: HistorySelection & {
        fingerprint: string;
        document: Record<string, unknown>;
        confirmed: true;
      },
    ): Promise<ProjectOperationResult<ChapterContent>>;
    organiseChapter(
      input: ChapterOrganisationRequest,
    ): Promise<
      ProjectOperationResult<{ workspace: ProjectWorkspace; chapterId: string }>
    >;
    replaceManuscript(
      input: ReplacementRequest,
    ): Promise<ProjectOperationResult<{ matches: number; chapters: number }>>;
    cancelReplacement(): Promise<ProjectOperationResult<null>>;
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

export interface HistoryRequest {
  projectId: string;
  chapterId: string;
}
export interface HistorySelection extends HistoryRequest {
  snapshotId: string;
}
export interface ChapterHistory {
  chapterId: string;
  title: string | null;
  entries: { id: string; chapterId: string; created: string }[];
  unavailable: number;
}
export interface HistoryPreview {
  content: Record<string, unknown>;
  fingerprint: string;
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
