export * from "./versions/v1.js";
export {
  MANUSCRIPT_HEADING_LEVELS,
  isSupportedManuscriptLink,
} from "./manuscript-document.js";
export {
  ProjectConfigSchema as ProjectConfigV1Schema,
  BookMetadataSchema as BookMetadataV1Schema,
  ChapterFileSchema as ChapterFileV1Schema,
} from "./versions/v1.js";
export * from "./versions/detection.js";
export * from "./versions/migrate-v1-v2.js";
export {
  ProjectConfigSchema,
  ProjectConfigV2Schema,
  ProjectFormatSchema,
  type ProjectConfig,
} from "./versions/v2.js";
export * from "./migration.js";
export * from "./image-assets.js";
export * from "./book-theme.js";
export * from "./manuscript-import.js";
export * from "./replacement-journal.js";
