import { z } from "zod";
import { ProjectConfigSchema as V1 } from "./v1.js";

// V2 separates the project envelope from independently versioned components.
// It introduces no publishing settings and leaves every chapter in its V1 format.
export const ProjectConfigV2Schema = V1.extend({
  schemaVersion: z.literal(2),
  formatFile: z.literal("format.json"),
});

export const ProjectFormatSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: V1.shape.projectId,
    bookSchemaVersion: z.literal(1),
    chapterSchemaVersion: z.literal(1),
  })
  .strict();

/** Readers retain V1 support for backups, history and explicit migration input. */
export const ProjectConfigSchema = z.discriminatedUnion("schemaVersion", [
  V1,
  ProjectConfigV2Schema,
]);
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
