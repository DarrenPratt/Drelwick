import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { copyFixture } from "../../../tests/helpers/fixture-projects.js";
import { inspectSnapshot } from "../src/project-snapshot.js";
import {
  migrateProjectToEditorialV3,
  recoverEditorialTransactions,
} from "../src/editorial-transactions.js";
import { openProject } from "../src/index.js";

it("M01 migrates Unicode, assets, references and history without changing bytes outside versioned envelopes", async () => {
  const fixture = await copyFixture("public-example");
  try {
    const before = await inspectSnapshot(fixture.projectPath, true);
    const saved = new Map(
      await Promise.all(
        before.files.map(
          async (file) =>
            [
              file.path,
              await readFile(join(fixture.projectPath, file.path)),
            ] as const,
        ),
      ),
    );
    const migrated = await migrateProjectToEditorialV3(fixture.projectPath);
    const project = await openProject(fixture.projectPath);
    expect(project.project.schemaVersion).toBe(3);
    for (const [path, bytes] of saved) {
      expect(
        await readFile(join(fixture.projectPath, migrated.backupPath, path)),
        path,
      ).toEqual(bytes);
      const after = await readFile(join(fixture.projectPath, path));
      if (path.startsWith("manuscript/")) {
        const old = JSON.parse(bytes.toString());
        const current = JSON.parse(after.toString());
        expect(current.content, path).toEqual(old.content);
        expect(current.review).toEqual({
          schemaVersion: 1,
          mode: "off",
          proposed: old.content,
          pending: [],
        });
      } else if (!["project.json", "format.json"].includes(path))
        expect(after, path).toEqual(bytes);
    }
  } finally {
    await fixture.cleanup();
  }
});

it.each([
  "backup-image",
  "backup-verified",
  "after-images",
  "prepared",
  "after-publication",
  "committed",
])(
  "M01 preserves coherent migration state after interruption at %s",
  async (boundary) => {
    const fixture = await copyFixture("public-example");
    try {
      const before = await readFile(join(fixture.projectPath, "project.json"));
      await expect(
        migrateProjectToEditorialV3(fixture.projectPath, {
          checkpoint: async (point) => {
            if (point === boundary) throw new Error("Synthetic interruption");
          },
        }),
      ).rejects.toThrow("Synthetic interruption");
      if (boundary === "after-images") {
        // No transaction descriptor: manual inspection is required and the
        // intact v2 manifest must never be interpreted as a completed upgrade.
        await expect(
          recoverEditorialTransactions(fixture.projectPath),
        ).rejects.toThrow();
        expect(
          await readFile(join(fixture.projectPath, "project.json")),
        ).toEqual(before);
      } else {
        await recoverEditorialTransactions(fixture.projectPath);
        await recoverEditorialTransactions(fixture.projectPath);
        const project = await openProject(fixture.projectPath);
        expect(project.project.schemaVersion).toBe(
          boundary === "committed" ? 3 : 2,
        );
        if (boundary !== "committed")
          expect(
            await readFile(join(fixture.projectPath, "project.json")),
          ).toEqual(before);
      }
    } finally {
      await fixture.cleanup();
    }
  },
);

it("M01 rejects an unsupported chapter extension and preserves its exact bytes", async () => {
  const fixture = await copyFixture("public-example");
  try {
    const projectPath = join(fixture.projectPath, "project.json");
    const projectBytes = await readFile(projectPath);
    const project = JSON.parse(projectBytes.toString());
    const chapterPath = join(
      fixture.projectPath,
      "manuscript",
      `${project.manuscript.order[0]}.json`,
    );
    const chapter = JSON.parse(await readFile(chapterPath, "utf8"));
    const bytes = Buffer.from(
      JSON.stringify({
        ...chapter,
        unsupportedExtension: { retained: "Synthetic Unicode 🌱" },
      }),
    );
    await writeFile(chapterPath, bytes);
    await expect(
      migrateProjectToEditorialV3(fixture.projectPath),
    ).rejects.toMatchObject({ code: "EDITORIAL_UNSUPPORTED" });
    expect(await readFile(chapterPath)).toEqual(bytes);
    expect(await readFile(projectPath)).toEqual(projectBytes);
  } finally {
    await fixture.cleanup();
  }
});
