import { z } from "zod";
import { ProjectConfigSchema as V1 } from "./v1.js";
import {
  ProjectConfigV2Schema,
  ProjectFormatSchema as FormatV1,
} from "./v2.js";
import { ProjectConfigV3Schema, ProjectFormatV2Schema } from "../editorial.js";

export const ProjectConfigSchema = z.discriminatedUnion("schemaVersion", [
  V1,
  ProjectConfigV2Schema,
  ProjectConfigV3Schema,
]);
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export const ProjectFormatCurrentSchema = z.union([
  FormatV1,
  ProjectFormatV2Schema,
]);
