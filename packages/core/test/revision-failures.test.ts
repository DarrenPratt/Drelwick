import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { revisionProject } from "../../../tests/helpers/revision-project.js";
import {
  reviewRevisions,
  readRevisionChapter,
  recoverEditorialTransactions,
} from "../src/index.js";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    copyFile: vi.fn(actual.copyFile),
  };
});
afterEach(() => vi.restoreAllMocks());
it.each([
  "safety-copy",
  "safety-sync",
  "draft-sync",
  "first-publication",
  "last-publication",
  "commit-marker",
] as const)(
  "F02 review preserves the previous complete pending bundle on real %s failure",
  async (phase) => {
    const f = await revisionProject(),
      operationId = randomUUID(),
      actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
    const paths = [
        f.chapterPath,
        f.editorialPath,
        join(f.projectPath, "project.json"),
      ],
      before = await Promise.all(paths.map((path) => actual.readFile(path)));
    let injected = false,
      markers = 0;
    const fault = Object.assign(new Error("Synthetic I/O fault"), {
      code: "EIO",
    });
    if (phase === "safety-copy")
      vi.mocked(fs.copyFile).mockImplementation(async (...args) => {
        if (!injected && String(args[1]).includes(operationId)) {
          injected = true;
          throw fault;
        }
        return actual.copyFile(...args);
      });
    else if (phase === "safety-sync" || phase === "draft-sync")
      vi.mocked(fs.open).mockImplementation(async (...args) => {
        const handle = await actual.open(...args),
          path = String(args[0]).replaceAll("\\", "/");
        if (
          !injected &&
          path.includes(operationId) &&
          (phase === "safety-sync"
            ? path.includes("/snapshots/manuscript/")
            : path.includes("/.editorial/drafts/"))
        ) {
          injected = true;
          vi.spyOn(handle, "sync").mockRejectedValueOnce(fault);
        }
        return handle;
      });
    else
      vi.mocked(fs.rename).mockImplementation(async (...args) => {
        const path = String(args[1]);
        if (path.endsWith(join(operationId, "transaction.json"))) markers++;
        if (
          !injected &&
          ((phase === "first-publication" && path === f.editorialPath) ||
            (phase === "last-publication" && path === paths[2]) ||
            (phase === "commit-marker" && markers === 2))
        ) {
          injected = true;
          throw fault;
        }
        return actual.rename(...args);
      });
    try {
      await expect(
        reviewRevisions({
          projectPath: f.projectPath,
          projectId: f.projectId,
          chapterId: f.chapterId,
          operationId,
          expected: f.view.expected,
          ids: f.view.state.review.pending.map((group) => group.id),
          action: "accept",
        }),
      ).rejects.toThrow();
      expect(injected).toBe(true);
      vi.restoreAllMocks();
      await recoverEditorialTransactions(f.projectPath).catch(() => undefined);
      expect(
        await Promise.all(paths.map((path) => actual.readFile(path))),
      ).toEqual(before);
      // Source bytes are inspectable even when incomplete safety evidence blocks automatic reopening.
      if (!phase.startsWith("safety"))
        expect(
          (await readRevisionChapter(f.projectPath, f.projectId, f.chapterId))
            .state.review.pending,
        ).toHaveLength(2);
    } finally {
      vi.restoreAllMocks();
      await f.cleanup();
    }
  },
);
