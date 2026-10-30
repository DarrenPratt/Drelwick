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
export { ProjectConfigV2Schema, ProjectFormatSchema } from "./versions/v2.js";
export {
  ProjectConfigSchema,
  ProjectFormatCurrentSchema,
  type ProjectConfig,
} from "./versions/current.js";
export * from "./migration.js";
export * from "./image-assets.js";
export * from "./book-theme.js";
export * from "./publication.js";
export * from "./manuscript-import.js";
export * from "./replacement-journal.js";
export * from "./spelling-settings.js";

export * from "./print-configuration.js";
export * from "./reference.js";

export * from "./editorial.js";

export * from "./editorial-codec.js";
