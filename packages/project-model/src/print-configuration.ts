import { z } from "zod";
import {
  PrintSettingsSchema,
  PrintEditionSchema,
  PrintEditionsSchema,
} from "@drelwick/shared";
import { ProjectConfigSchema } from "./versions/v1.js";

/** Additive local component. Absence means deterministic defaults, without rewriting a project. */
const PrintConfigurationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: ProjectConfigSchema.shape.projectId,
    settings: PrintSettingsSchema,
  })
  .strict();
export const PrintConfigurationV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    projectId: ProjectConfigSchema.shape.projectId,
    edition: PrintEditionSchema,
    editions: PrintEditionsSchema,
  })
  .strict();
export const PrintConfigurationSchema = z.union([
  PrintConfigurationV1Schema,
  PrintConfigurationV2Schema,
]);
export type PrintConfiguration = z.infer<typeof PrintConfigurationSchema>;
