import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { editorialProject } from "../../../tests/helpers/editorial-project.js";
import {
  commitEditorialTransaction,
  recoverEditorialTransactions,
} from "../src/editorial-transactions.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});
afterEach(() => vi.restoreAllMocks());

it.each([
  "safety-write",
  "draft-sync",
  "first-publication",
  "last-publication",
  "commit-marker",
] as const)(
  "F02 preserves the previous complete bundle when the actual %s file operation fails",
  async (phase) => {
    const fixture = await editorialProject();
    const root = fixture.projectPath;
    const projectPath = join(root, "project.json");
    const beforeProject = await fs.readFile(projectPath);
    const beforeState = await fs.readFile(fixture.editorialPath);
    const project = JSON.parse(beforeProject.toString());
    const state = JSON.parse(beforeState.toString());
    const operationId = "00000000-0000-4000-8000-000000000091";
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const fault = Object.assign(new Error("Synthetic disk fault"), {
      code: "EIO",
    });
    let injected = false;
    let manifests = 0;
    if (phase === "safety-write" || phase === "draft-sync") {
      vi.mocked(fs.open).mockImplementation(async (...args) => {
        const handle = await actual.open(...args);
        const path = String(args[0]).replaceAll("\\", "/");
        if (
          !injected &&
          path.includes(operationId) &&
          (phase === "safety-write"
            ? path.includes("/before/")
            : path.includes("/.editorial/drafts/"))
        ) {
          injected = true;
          if (phase === "safety-write")
            vi.spyOn(handle, "writeFile").mockRejectedValueOnce(fault);
          else vi.spyOn(handle, "sync").mockRejectedValueOnce(fault);
        }
        return handle;
      });
    } else {
      vi.mocked(fs.rename).mockImplementation(async (...args) => {
        const destination = String(args[1]);
        if (destination.endsWith(join(operationId, "transaction.json")))
          manifests++;
        if (
          !injected &&
          ((phase === "first-publication" &&
            destination === fixture.editorialPath) ||
            (phase === "last-publication" && destination === projectPath) ||
            (phase === "commit-marker" && manifests === 2))
        ) {
          injected = true;
          throw fault;
        }
        return actual.rename(...args);
      });
    }
    try {
      await expect(
        commitEditorialTransaction({
          projectPath: root,
          projectId: project.projectId,
          operationId,
          kind: "annotation",
          expectedGeneration: project.generation,
          changes: [
            {
              path: "project.json",
              after: Buffer.from(
                JSON.stringify({
                  ...project,
                  generation: project.generation + 1,
                }),
              ),
            },
            {
              path: "editorial/state.json",
              after: Buffer.from(
                JSON.stringify({ ...state, generation: state.generation + 1 }),
              ),
            },
          ],
        }),
      ).rejects.toThrow();
      expect(injected).toBe(true);
      vi.restoreAllMocks();
      if (phase === "safety-write") {
        // No descriptor was published: incomplete safety images remain blocked
        // for inspection, and no authoritative file has changed.
        await expect(recoverEditorialTransactions(root)).rejects.toThrow();
      } else {
        await recoverEditorialTransactions(root);
        await recoverEditorialTransactions(root);
      }
      expect(await fs.readFile(projectPath)).toEqual(beforeProject);
      expect(await fs.readFile(fixture.editorialPath)).toEqual(beforeState);
    } finally {
      vi.restoreAllMocks();
      await fixture.cleanup();
    }
  },
);
