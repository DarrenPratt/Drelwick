import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  EditorialStateSchema,
  ProjectConfigV3Schema,
  parseEditorialJson,
} from "@drelwick/project-model";
import { ApplicationError } from "@drelwick/shared";
import { openProject, type OpenedProject } from "./index.js";
import { boundedRead } from "./image-assets.js";
import {
  commitPreparedEditorialTransaction,
  type EditorialChange,
} from "./editorial-transactions.js";

const contextFiles = [
  "book.json",
  "format.json",
  "presentation.json",
  "print.json",
  "publication.json",
] as const;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** Publication context is part of a v3 saved generation, not an independent save. */
export async function saveEditorialContext<T>(
  projectPath: string,
  projectId: string,
  prepare: (
    root: string,
    session: OpenedProject,
  ) => Promise<{ changes: EditorialChange[]; result: T }>,
): Promise<{ result: T; warning?: string }> {
  const committed = await commitPreparedEditorialTransaction(
    projectPath,
    async (root) => {
      const projectBytes = await boundedRead(
        join(root, "project.json"),
        8 * 1024 ** 2,
      );
      const project = ProjectConfigV3Schema.parse(
        parseEditorialJson(projectBytes),
      );
      if (project.projectId !== projectId)
        throw new ApplicationError(
          "PROJECT_NOT_OPEN",
          "The active project changed. Reopen it before saving.",
        );
      const stateBytes = await boundedRead(
        join(root, "editorial/state.json"),
        8 * 1024 ** 2,
      );
      const state = EditorialStateSchema.parse(parseEditorialJson(stateBytes));
      const expectedBefore: Record<string, string | null> = {
        "project.json": hash(projectBytes),
        "editorial/state.json": hash(stateBytes),
      };
      for (const path of [
        ...contextFiles,
        ...project.manuscript.order.map((id) => `manuscript/${id}.json`),
      ]) {
        try {
          await lstat(join(root, path));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          expectedBefore[path] = null;
          continue;
        }
        expectedBefore[path] = hash(
          await boundedRead(join(root, path), 64 * 1024 ** 2),
        );
      }
      const session = await openProject(root);
      const prepared = await prepare(root, session);
      if (!prepared.changes.length)
        return { transaction: null, result: prepared.result };
      if (
        prepared.changes.some(
          (change) =>
            !["presentation.json", "print.json", "publication.json"].includes(
              change.path,
            ),
        )
      )
        throw new ApplicationError(
          "EDITORIAL_INVALID",
          "Invalid publication context change.",
        );
      const generation = project.generation + 1;
      const bytes = (value: unknown) =>
        Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      return {
        result: prepared.result,
        transaction: {
          projectId,
          kind: "edit" as const,
          expectedGeneration: project.generation,
          expectedBefore,
          changes: [
            ...prepared.changes,
            {
              path: "project.json",
              after: bytes({
                ...project,
                generation,
                modified: new Date().toISOString(),
              }),
            },
            {
              path: "editorial/state.json",
              after: bytes({ ...state, generation }),
            },
          ],
        },
      };
    },
  );
  const warning = committed.warning ?? committed.receipt?.warning;
  return { result: committed.result, ...(warning ? { warning } : {}) };
}
