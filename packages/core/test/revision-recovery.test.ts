import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { revisionProject } from "../../../tests/helpers/revision-project.js";
import {
  readRevisionChapter,
  reviewRevisions,
  recoverEditorialTransactions,
} from "../src/index.js";

it.each(["prepared", "after-publication", "committed"])(
  "F01/F03/F04/F05 recovers a terminated revision review at %s",
  async (point) => {
    const f = await revisionProject();
    try {
      const input = {
        projectPath: f.projectPath,
        projectId: f.projectId,
        chapterId: f.chapterId,
        operationId: randomUUID(),
        expected: f.view.expected,
        ids: f.view.state.review.pending.map((g) => g.id),
        action: "reject" as const,
      };
      const paths = [
          f.chapterPath,
          f.editorialPath,
          join(f.projectPath, "project.json"),
        ],
        before = await Promise.all(paths.map((path) => readFile(path)));
      const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      const script = `import{pathToFileURL}from'node:url';const core=await import(pathToFileURL(process.argv[1]).href);await core.reviewRevisions(JSON.parse(process.argv[2]),{checkpoint:async p=>{if(p===process.argv[3])process.exit(73);}});`;
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            script,
            entry,
            JSON.stringify(input),
            point,
          ],
          { stdio: "ignore" },
        );
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Review checkpoint was not reached"));
        }, 20000);
        child.once("error", reject);
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      expect(code).toBe(73);
      await recoverEditorialTransactions(f.projectPath);
      await recoverEditorialTransactions(f.projectPath);
      if (point !== "committed") {
        expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(
          before,
        );
        expect(
          (await readRevisionChapter(f.projectPath, f.projectId, f.chapterId))
            .state,
        ).toEqual(f.view.state);
      } else {
        const after = await readRevisionChapter(
          f.projectPath,
          f.projectId,
          f.chapterId,
        );
        expect(after.state.review.pending).toEqual([]);
        expect(after.state.review.proposed).toEqual(f.view.state.content);
        const retry = await reviewRevisions(input);
        expect(retry.operationId).toBe(input.operationId);
        expect(retry.state).toEqual(after.state);
        expect(
          (await readRevisionChapter(f.projectPath, f.projectId, f.chapterId))
            .expected.generation,
        ).toBe(input.expected.generation + 1);
      }
    } finally {
      await f.cleanup();
    }
  },
  30000,
);

it("R06 rejects external same-generation byte changes and stale bulk group IDs without any partial write", async () => {
  const f = await revisionProject();
  try {
    const input = {
      projectPath: f.projectPath,
      projectId: f.projectId,
      chapterId: f.chapterId,
      operationId: randomUUID(),
      expected: f.view.expected,
      ids: f.view.state.review.pending.map((g) => g.id),
      action: "accept" as const,
    };
    await writeFile(
      f.chapterPath,
      Buffer.concat([await readFile(f.chapterPath), Buffer.from("\n")]),
    );
    const paths = [
        f.chapterPath,
        f.editorialPath,
        join(f.projectPath, "project.json"),
      ],
      before = await Promise.all(paths.map((path) => readFile(path)));
    await expect(reviewRevisions(input)).rejects.toMatchObject({
      code: "EDITORIAL_STALE",
    });
    const fresh = await readRevisionChapter(
      f.projectPath,
      f.projectId,
      f.chapterId,
    );
    await expect(
      reviewRevisions({
        ...input,
        operationId: randomUUID(),
        expected: fresh.expected,
        ids: [input.ids[0]!, randomUUID()],
      }),
    ).rejects.toMatchObject({ code: "EDITORIAL_STALE" });
    expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(
      before,
    );
  } finally {
    await f.cleanup();
  }
});
