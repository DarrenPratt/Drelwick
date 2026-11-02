import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { copyFixture } from "../../../tests/helpers/fixture-projects.js";
import {
  captureNamedSnapshot,
  listManuscriptSnapshots,
  previewSnapshotRestore,
  restoreNamedSnapshot,
  openProjectForEditing,
  openProject,
  migrateProjectToEditorialV3,
  saveChapter,
  readPublication,
  savePublication,
  recoverEditorialTransactions,
} from "../src/index.js";
import { createUuid } from "@drelwick/shared";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
  };
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

it.each([
  "snapshot-copy",
  "manifest-sync",
  "safety-copy",
  "restore-publication",
  "restore-marker",
  "restore-asset-stage",
  "restore-asset-publication",
] as const)(
  "preserves originals after an actual %s filesystem failure",
  async (phase) => {
    const fixture = await copyFixture("public-example");
    cleanups.push(fixture.cleanup);
    const root = fixture.projectPath;
    await openProjectForEditing(root);
    await migrateProjectToEditorialV3(root);
    const session = await openProject(root),
      projectId = session.project.projectId,
      operationId = createUuid();
    let source = await listManuscriptSnapshots(root, projectId);
    const selected =
      phase.startsWith("restore") || phase === "safety-copy"
        ? await captureNamedSnapshot({
            projectPath: root,
            projectId,
            operationId: createUuid(),
            label: "Original",
            expected: source.source,
          })
        : null;
    if (selected)
      await saveChapter({
        projectPath: root,
        chapterId: session.project.manuscript.order[0]!,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Current retained original" }],
            },
          ],
        },
      });
    if (
      phase === "restore-asset-stage" ||
      phase === "restore-asset-publication"
    ) {
      for (const chapterId of session.project.manuscript.order)
        await saveChapter({
          projectPath: root,
          chapterId,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Current manuscript without images" },
                ],
              },
            ],
          },
        });
      const current = await openProject(root),
        publication = await readPublication(root, current);
      const data = { ...publication.data };
      delete data.coverAssetId;
      await savePublication(
        {
          projectPath: root,
          projectId,
          expectedRevision: publication.revision,
          data,
        },
        { allowCoverChange: true },
      );
      await fs.rm(
        join(root, "assets/images/00000000-0000-4000-8000-000000000903"),
        { recursive: true, force: true },
      );
    }
    source = await listManuscriptSnapshots(root, projectId);
    const beforeProject = await fs.readFile(join(root, "project.json")),
      beforeState = await fs.readFile(join(root, "editorial/state.json"));
    const chapterPath = join(
        root,
        "manuscript",
        `${session.project.manuscript.order[0]}.json`,
      ),
      beforeChapter = await fs.readFile(chapterPath);
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const fault = Object.assign(new Error("Synthetic disk error"), {
      code: "ENOSPC",
    });
    let injected = false,
      markers = 0;
    if (
      phase === "snapshot-copy" ||
      phase === "safety-copy" ||
      phase === "restore-asset-stage"
    )
      vi.mocked(fs.copyFile).mockImplementation(async (...args) => {
        const target = String(args[1]).replaceAll("\\", "/");
        if (
          !injected &&
          (target.includes(
            `/snapshots/manuscript/${operationId}/files/assets/`,
          ) ||
            (phase === "restore-asset-stage" &&
              target.includes(
                `/.editorial/transactions/${operationId}/after/assets/`,
              )))
        ) {
          injected = true;
          throw fault;
        }
        return actual.copyFile(...args);
      });
    else if (phase === "manifest-sync")
      vi.mocked(fs.open).mockImplementation(async (...args) => {
        const handle = await actual.open(...args);
        if (
          !injected &&
          String(args[0]).endsWith(join(operationId, "manifest.tmp"))
        ) {
          injected = true;
          vi.spyOn(handle, "sync").mockRejectedValueOnce(fault);
        }
        return handle;
      });
    else
      vi.mocked(fs.rename).mockImplementation(async (...args) => {
        const target = String(args[1]);
        if (target.endsWith(join(operationId, "transaction.json"))) markers++;
        if (
          !injected &&
          ((phase === "restore-publication" &&
            target === join(root, "book.json")) ||
            (phase === "restore-marker" && markers === 2) ||
            (phase === "restore-asset-publication" &&
              target ===
                join(
                  root,
                  "assets/images/00000000-0000-4000-8000-000000000903/original.png",
                )))
        ) {
          injected = true;
          throw fault;
        }
        return actual.rename(...args);
      });
    if (selected) {
      const preview = await previewSnapshotRestore(root, projectId, selected);
      await expect(
        restoreNamedSnapshot({
          projectPath: root,
          projectId,
          operationId,
          selection: selected,
          expected: preview.current,
        }),
      ).rejects.toThrow();
    } else
      await expect(
        captureNamedSnapshot({
          projectPath: root,
          projectId,
          operationId,
          label: "Failed capture",
          expected: source.source,
        }),
      ).rejects.toThrow();
    expect(injected).toBe(true);
    if (phase === "restore-asset-stage")
      await expect(recoverEditorialTransactions(root)).rejects.toMatchObject({
        code: "EDITORIAL_RECOVERY_REQUIRED",
      });
    else if (phase.startsWith("restore"))
      await recoverEditorialTransactions(root);
    expect(await fs.readFile(join(root, "project.json"))).toEqual(
      beforeProject,
    );
    expect(await fs.readFile(join(root, "editorial/state.json"))).toEqual(
      beforeState,
    );
    expect(await fs.readFile(chapterPath)).toEqual(beforeChapter);
    if (!selected || phase === "safety-copy")
      await expect(
        fs.readFile(
          join(root, "snapshots/manuscript", operationId, "snapshot.json"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    if (selected)
      expect(
        await fs.readFile(
          join(
            root,
            "snapshots/manuscript",
            selected.snapshotId,
            "snapshot.json",
          ),
        ),
      ).toBeDefined();
  },
  30_000,
);
