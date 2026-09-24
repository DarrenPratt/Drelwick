import { z } from "zod";
import { isSafeRelativePath } from "@drelwick/shared";
import {
  ProjectConfigSchema,
  ProjectArchiveManifestSchema,
} from "./versions/v1.js";

const path = z
  .string()
  .max(1024)
  .refine(
    (value) =>
      isSafeRelativePath(value) &&
      value
        .split("/")
        .every((part) => part !== "." && !/[\\:*?"<>|]/.test(part)) &&
      ![".drelwick-migration", ".chapter-create.lock"].includes(
        value.split("/")[0] ?? "",
      ),
  );
export const ProjectSnapshotSchema = z
  .object({
    directories: z.array(path),
    files: ProjectArchiveManifestSchema.shape.files.element
      .extend({ path })
      .array()
      .max(10000),
  })
  .strict();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export const MigrationStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    from: z.literal(1),
    to: z.literal(2),
    projectId: ProjectConfigSchema.shape.projectId,
    phase: z.enum([
      "preparing",
      "backup-verified",
      "staging",
      "validated",
      "committing",
      "committed",
      "complete",
    ]),
    backup: z.string().regex(/^backup-[a-f0-9-]{36}$/),
    stage: z.string().regex(/^stage-[a-f0-9-]{36}$/),
    snapshot: ProjectSnapshotSchema.nullable(),
    staged: z
      .array(
        z
          .object({
            path: z.enum(["format.json", "project.json"]),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(2),
    committedFiles: z.number().int().min(0).max(2),
  })
  .strict();
export type MigrationState = z.infer<typeof MigrationStateSchema>;

export const MigrationLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    token: ProjectConfigSchema.shape.projectId,
    pid: z.number().int().positive(),
    host: z.string().min(1),
  })
  .strict();
