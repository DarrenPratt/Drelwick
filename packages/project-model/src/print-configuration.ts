import { z } from "zod";
import { PrintSettingsSchema } from "@drelwick/shared";
import { ProjectConfigSchema } from "./versions/v1.js";

/** Additive local component. Absence means deterministic defaults, without rewriting a project. */
export const PrintConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: ProjectConfigSchema.shape.projectId,
    settings: PrintSettingsSchema,
  })
  .strict();
export type PrintConfiguration = z.infer<typeof PrintConfigurationSchema>;
