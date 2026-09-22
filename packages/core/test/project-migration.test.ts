import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyFixture,
  type FixtureCopy,
  type FixtureName,
} from "../../../tests/helpers/fixture-projects.js";
import { MigrationStateSchema } from "@sarel/project-model";
import {
  MIGRATION_CHECKPOINTS,
  MIGRATION_RECOVERY_CHECKPOINTS,
  MIGRATION_DIRECTORY,
  migrateProject,
  openProject,
  openProjectForEditing,
  validateProjectFiles,
  scanRecoveryCandidates,
  createProjectArchive,
  restoreProjectArchive,
  type MigrationCheckpoint,
} from "../src/index.js";
import { inspectSnapshot, sameSnapshot } from "../src/project-snapshot.js";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function fixture(name: FixtureName = "unicode-book"): Promise<string> {
  const copy = await copyFixture(name);
  copies.push(copy);
  return copy.projectPath;
}
async function journal(root: string) {
  return MigrationStateSchema.parse(
    JSON.parse(
      await readFile(join(root, MIGRATION_DIRECTORY, "state.json"), "utf8"),
    ) as unknown,
  );
}
async function prose(root: string) {
  const entries = (await readdir(join(root, "manuscript"))).sort();
  return Promise.all(
    entries.map(async (name) => ({
      name,
      bytes: await readFile(join(root, "manuscript", name)),
    })),
  );
}
async function assertBackup(root: string) {
  const state = await journal(root);
  const backup = join(root, MIGRATION_DIRECTORY, state.backup);
  expect((await validateProjectFiles(backup)).project.schemaVersion).toBe(1);
  expect(sameSnapshot(state.snapshot!, await inspectSnapshot(backup))).toBe(
    true,
  );
  return backup;
}

describe("V1 -> V2 project migration", () => {
  it("recovers its own failed lock cleanup without discarding the successful migration", async () => {
    const root = await fixture();
    const before = await prose(root);
    await expect(
      migrateProject(root, {
        releaseLock: async () => {
          throw Object.assign(new Error("private filesystem payload"), {
            code: "EACCES",
          });
        },
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_RECOVERY_REQUIRED" });
    expect((await journal(root)).phase).toBe("complete");
    expect((await lstat(join(root, ".chapter-create.lock"))).isFile()).toBe(
      true,
    );
    expect((await openProjectForEditing(root)).project.schemaVersion).toBe(2);
    expect(await prose(root)).toEqual(before);
    await expect(
      lstat(join(root, ".chapter-create.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await assertBackup(root);
  });
  it("preserves historical chapter content and unknown envelope metadata without normalisation", async () => {
    const root = await fixture();
    const chapterName = (await readdir(join(root, "manuscript")))[0]!;
    const path = join(root, "manuscript", chapterName);
    const original = JSON.parse(await readFile(path, "utf8")) as {
      content: { content: unknown[] };
      [key: string]: unknown;
    };
    original.authorExtension = { synthetic: "留存 — preserve" };
    original.content.content.push({
      type: "unknownAuthorNode",
      text: "Synthetic recoverable text",
    });
    await writeFile(path, JSON.stringify(original));
    const bytes = await readFile(path);
    await openProjectForEditing(root);
    expect(await readFile(path)).toEqual(bytes);
    expect(
      await readFile(join(await assertBackup(root), "manuscript", chapterName)),
    ).toEqual(bytes);
  });

  it("repeated failures after manifest publication preserve one verified backup and all prose", async () => {
    const root = await fixture();
    const before = await prose(root);
    let backup: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        migrateProject(root, {
          checkpoint: async (point) => {
            if (point === "after-project-commit")
              throw new Error("repeated failure");
          },
        }),
      ).rejects.toBeDefined();
      const current = await assertBackup(root);
      backup ??= current;
      expect(current).toBe(backup);
      expect(await prose(root)).toEqual(before);
      await expect(openProject(root)).rejects.toMatchObject({
        code: "MIGRATION_RECOVERY_REQUIRED",
      });
    }
    expect((await openProjectForEditing(root)).project.schemaVersion).toBe(2);
    expect(await prose(root)).toEqual(before);
  });

  it("rejects newer component versions in a completed v2 project without mutation", async () => {
    const root = await fixture();
    await openProjectForEditing(root);
    const path = join(root, "format.json");
    const format = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      path,
      JSON.stringify({ ...format, chapterSchemaVersion: 99 }),
    );
    const before = await inspectSnapshot(root, true);
    const journalBefore = await readFile(
      join(root, MIGRATION_DIRECTORY, "state.json"),
    );
    await expect(openProjectForEditing(root)).rejects.toMatchObject({
      code: "PROJECT_SCHEMA_UNSUPPORTED",
    });
    expect(await inspectSnapshot(root, true)).toEqual(before);
    expect(
      await readFile(join(root, MIGRATION_DIRECTORY, "state.json")),
    ).toEqual(journalBefore);
  });

  it("never overwrites an unrelated descriptor that appears immediately before publication", async () => {
    const root = await fixture();
    const before = await prose(root);
    const unrelated = '{"synthetic":"external author data"}';
    await expect(
      migrateProject(root, {
        checkpoint: async (point) => {
          if (point === "before-format-commit")
            await writeFile(join(root, "format.json"), unrelated);
        },
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_COMMIT_FAILED" });
    expect(await readFile(join(root, "format.json"), "utf8")).toBe(unrelated);
    expect(await prose(root)).toEqual(before);
    await assertBackup(root);
  });
  it.each(MIGRATION_RECOVERY_CHECKPOINTS)(
    "recovers if recovery itself terminates at %s",
    async (point) => {
      const root = await fixture();
      const before = await prose(root);
      expect(await crashAt(root, "after-format-commit")).toBe(71);
      expect(await crashAt(root, point)).toBe(71);
      await openProjectForEditing(root);
      await openProjectForEditing(root);
      expect(await prose(root)).toEqual(before);
      await assertBackup(root);
    },
  );

  it("does not resume over externally changed manuscript bytes", async () => {
    const root = await fixture();
    await expect(
      migrateProject(root, {
        checkpoint: async (point) => {
          if (point === "after-format-commit") throw new Error("stop");
        },
      }),
    ).rejects.toBeDefined();
    const backup = await assertBackup(root);
    const original = await prose(backup);
    const path = join(root, "manuscript", original[0]!.name);
    await writeFile(
      path,
      original[0]!.bytes
        .toString("utf8")
        .replace("l’autrice", "External synthetic revision"),
    );
    const edited = await readFile(path);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(openProjectForEditing(root)).rejects.toMatchObject({
        code: "MIGRATION_STATE_INVALID",
      });
      expect(await readFile(path)).toEqual(edited);
      expect(await prose(backup)).toEqual(original);
    }
  });

  it("rejects concurrent callers while a migration owns the project", async () => {
    const root = await fixture();
    let release!: () => void;
    let ready!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const first = migrateProject(root, {
      checkpoint: async (point) => {
        if (point === "after-lock") {
          ready();
          await blocked;
        }
      },
    });
    await reached;
    try {
      await expect(migrateProject(root)).rejects.toMatchObject({
        code: "PROJECT_BUSY",
      });
    } finally {
      release();
    }
    await first;
    expect((await openProjectForEditing(root)).project.schemaVersion).toBe(2);
  });
  it.each([
    "minimal-book",
    "unicode-book",
    "formatted-book",
    "multi-chapter-book",
    "recovery-project",
  ] as const)(
    "migrates the actual %s fixture without rewriting chapters, metadata, history or ordering",
    async (name) => {
      const root = await fixture(name);
      const before = await inspectSnapshot(root);
      const original = await validateProjectFiles(root);
      const bytes = await prose(root);
      const opened = await openProjectForEditing(root);
      expect(opened.project.schemaVersion).toBe(2);
      expect(opened.project.manuscript.order).toEqual(
        original.project.manuscript.order,
      );
      expect(opened.chapters).toEqual(original.chapters);
      expect(await prose(root)).toEqual(bytes);
      const backup = await assertBackup(root);
      expect(await inspectSnapshot(backup)).toEqual(before);
      for (const file of before.files.filter(
        (file) => file.path !== "project.json",
      ))
        expect(await readFile(join(root, file.path))).toEqual(
          await readFile(join(backup, file.path)),
        );
      expect((await journal(root)).phase).toBe("complete");
      await openProjectForEditing(root);
      expect(await prose(root)).toEqual(bytes);
    },
  );

  it("backs up unknown author files, recovery temporaries and empty directories, preserving unknown JSON exactly", async () => {
    const root = await fixture();
    await mkdir(join(root, "author-notes", "empty"), { recursive: true });
    await writeFile(
      join(root, "author-notes", "notes.txt"),
      "Synthetic notes — 東京, café.\n",
    );
    await writeFile(
      join(root, "manuscript", "recoverable.json.tmp"),
      "Synthetic unsaved prose — preserve me.\n",
    );
    await writeFile(
      join(root, "format.json.tmp"),
      "Synthetic author recovery artifact.\n",
    );
    const manifest = await readFile(join(root, "project.json"), "utf8");
    const extra =
      ',"unknown":{"precise":90071992547409931234,"spelling":"\\u00e9","nested":{"schemaVersion":77}}';
    const enriched = manifest.replace(/}(\s*)$/, `${extra}}$1`);
    await writeFile(join(root, "project.json"), enriched);
    const before = await inspectSnapshot(root);
    await openProjectForEditing(root);
    const after = await readFile(join(root, "project.json"), "utf8");
    expect(after).toContain(extra);
    expect(await inspectSnapshot(await assertBackup(root))).toEqual(before);
    expect(
      await readFile(join(root, "author-notes", "notes.txt"), "utf8"),
    ).toContain("東京");
  });

  it.each(MIGRATION_CHECKPOINTS)(
    "recovers idempotently after a failure at %s",
    async (target) => {
      const root = await fixture();
      const before = await prose(root);
      let injected = false;
      await expect(
        migrateProject(root, {
          checkpoint: async (point) => {
            if (point === target && !injected) {
              injected = true;
              throw new Error("synthetic private payload");
            }
          },
        }),
      ).rejects.toBeDefined();
      expect(injected).toBe(true);
      expect(await prose(root)).toEqual(before);
      const state = await journal(root).catch(() => null);
      if (state?.snapshot && state.phase !== "preparing") {
        expect(await prose(await assertBackup(root))).toEqual(before);
      }
      if (state && state.phase !== "complete") {
        await expect(openProject(root)).rejects.toMatchObject({
          code: "MIGRATION_RECOVERY_REQUIRED",
        });
        await expect(scanRecoveryCandidates(root)).rejects.toMatchObject({
          code: "MIGRATION_RECOVERY_REQUIRED",
        });
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        expect((await openProjectForEditing(root)).project.schemaVersion).toBe(
          2,
        );
        expect(await prose(root)).toEqual(before);
        expect(await prose(await assertBackup(root))).toEqual(before);
      }
    },
  );

  it.each(MIGRATION_CHECKPOINTS)(
    "reopens after abrupt process termination at %s",
    async (target) => {
      const root = await fixture("formatted-book");
      const before = await prose(root);
      const status = await crashAt(root, target);
      expect(status).toBe(71);
      expect(await prose(root)).toEqual(before);
      for (let attempt = 0; attempt < 2; attempt++) {
        expect((await openProjectForEditing(root)).project.schemaVersion).toBe(
          2,
        );
        expect(await prose(root)).toEqual(before);
      }
      expect(await prose(await assertBackup(root))).toEqual(before);
    },
  );

  it.each(["project.json", "book.json", "chapter"])(
    "rejects a newer %s without any project mutation",
    async (file) => {
      const root = await fixture();
      const path =
        file === "chapter"
          ? join(
              root,
              "manuscript",
              (await readdir(join(root, "manuscript")))[0]!,
            )
          : join(root, file);
      const value = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(path, JSON.stringify({ ...value, schemaVersion: 999 }));
      const before = await inspectSnapshot(root);
      await expect(openProjectForEditing(root)).rejects.toMatchObject({
        code: "PROJECT_SCHEMA_UNSUPPORTED",
        message: expect.stringContaining("newer compatible"),
      });
      expect(await inspectSnapshot(root)).toEqual(before);
    },
  );

  it.each([undefined, null, "1", 0, -1, 1.5])(
    "rejects malformed version %s without mutation",
    async (version) => {
      const root = await fixture();
      await writeFile(
        join(root, "project.json"),
        JSON.stringify({ schemaVersion: version }),
      );
      const before = await inspectSnapshot(root);
      await expect(openProjectForEditing(root)).rejects.toMatchObject({
        code: "PROJECT_VERSION_MALFORMED",
      });
      expect(await inspectSnapshot(root)).toEqual(before);
    },
  );

  it("aborts on corrupt backup before any authoritative mutation", async () => {
    const root = await fixture();
    const before = await inspectSnapshot(root);
    await expect(
      migrateProject(root, {
        checkpoint: async (point) => {
          if (point !== "after-backup-copy") return;
          const state = await journal(root);
          await writeFile(
            join(root, MIGRATION_DIRECTORY, state.backup, "book.json"),
            "corrupt synthetic backup",
          );
        },
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_BACKUP_INVALID" });
    expect(await inspectSnapshot(root, true)).toEqual(before);
    await openProjectForEditing(root);
    await assertBackup(root);
  });

  it("never overwrites a verified backup that later becomes corrupt", async () => {
    const root = await fixture();
    const before = await prose(root);
    await expect(
      migrateProject(root, {
        checkpoint: async (point) => {
          if (point === "after-backup-journal") throw new Error("stop");
        },
      }),
    ).rejects.toBeDefined();
    const state = await journal(root);
    const path = join(root, MIGRATION_DIRECTORY, state.backup, "book.json");
    await writeFile(path, "corrupt");
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(openProjectForEditing(root)).rejects.toMatchObject({
        code: "MIGRATION_BACKUP_INVALID",
      });
      expect(await readFile(path, "utf8")).toBe("corrupt");
      expect(await prose(root)).toEqual(before);
    }
  });

  it("rejects corrupt staging before commit and resumes from the retained backup", async () => {
    const root = await fixture();
    const before = await inspectSnapshot(root);
    await expect(
      migrateProject(root, {
        checkpoint: async (point) => {
          if (point === "before-validation") {
            const state = await journal(root);
            await writeFile(
              join(root, MIGRATION_DIRECTORY, state.stage, "project.json"),
              "invalid staged data",
            );
          }
        },
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_STAGE_INVALID" });
    expect(await inspectSnapshot(root, true)).toEqual(before);
    await assertBackup(root);
    await openProjectForEditing(root);
  });

  it("resumes after a filesystem rename failure, with the backup and prose intact", async () => {
    const root = await fixture();
    const before = await prose(root);
    await expect(
      migrateProject(root, {
        replace: async () => {
          throw Object.assign(new Error("private payload"), { code: "ENOSPC" });
        },
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_COMMIT_FAILED" });
    expect(await prose(root)).toEqual(before);
    await assertBackup(root);
    expect((await openProjectForEditing(root)).project.schemaVersion).toBe(2);
  });

  it("blocks unknown migration state without logging or exposing its payload", async () => {
    const root = await fixture();
    await mkdir(join(root, MIGRATION_DIRECTORY));
    await writeFile(
      join(root, MIGRATION_DIRECTORY, "state.json"),
      '{"private manuscript":',
    );
    const before = await prose(root);
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await openProjectForEditing(root).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ code: "MIGRATION_STATE_INVALID" });
      expect(String(error)).not.toContain("private manuscript");
      expect(error).not.toHaveProperty("cause");
      expect(await prose(root)).toEqual(before);
    }
  });

  it("does not steal an existing operation directory lock", async () => {
    const root = await fixture();
    await mkdir(join(root, ".chapter-create.lock"));
    const before = await prose(root);
    await expect(openProjectForEditing(root)).rejects.toMatchObject({
      code: "PROJECT_BUSY",
    });
    expect(
      (await lstat(join(root, ".chapter-create.lock"))).isDirectory(),
    ).toBe(true);
    expect(await prose(root)).toEqual(before);
  });

  it("rejects a linked author directory without following it or changing prose", async () => {
    const root = await fixture();
    const other = await fixture("formatted-book");
    await symlink(other, join(root, "linked-notes"), "junction");
    const before = await prose(root);
    await expect(openProjectForEditing(root)).rejects.toMatchObject({
      code: "MIGRATION_BACKUP_FAILED",
    });
    expect(await prose(root)).toEqual(before);
  });

  it("rejects a pre-existing format file instead of dropping unknown author data", async () => {
    const root = await fixture();
    await writeFile(join(root, "format.json"), '{"author":"synthetic notes"}');
    const before = await inspectSnapshot(root);
    await expect(openProjectForEditing(root)).rejects.toMatchObject({
      code: "MIGRATION_TARGET_CONFLICT",
    });
    expect(await inspectSnapshot(root)).toEqual(before);
  });

  it("preserves subsequent edits on repeated opens of a completed migration", async () => {
    const root = await fixture();
    await openProjectForEditing(root);
    const chapter = (await readdir(join(root, "manuscript")))[0]!;
    const path = join(root, "manuscript", chapter);
    const source = await readFile(path, "utf8");
    await writeFile(
      path,
      source.replace("l’autrice", "The later synthetic revision"),
    );
    const revised = await readFile(path);
    await openProjectForEditing(root);
    await openProjectForEditing(root);
    expect(await readFile(path)).toEqual(revised);
    expect(
      await readFile(
        join(await assertBackup(root), "manuscript", chapter),
        "utf8",
      ),
    ).toBe(source);
  });

  it("includes the v2 descriptor in portable archives and restores a valid project", async () => {
    const root = await fixture();
    const parent = await fixture("minimal-book");
    // A sibling outside both projects supplies the existing archive API destination.
    const destination = join(parent, "..", "restored");
    await mkdir(destination);
    const archive = join(parent, "..", "migration.sarel.zip");
    await openProjectForEditing(root);
    await createProjectArchive({ projectPath: root, archivePath: archive });
    const restored = await restoreProjectArchive({
      archivePath: archive,
      destinationParent: destination,
    });
    expect(
      (await openProjectForEditing(restored.projectPath)).project.schemaVersion,
    ).toBe(2);
    expect(await prose(restored.projectPath)).toEqual(await prose(root));
    expect(await readdir(restored.projectPath)).not.toContain(
      MIGRATION_DIRECTORY,
    );
  });
});

async function crashAt(
  root: string,
  target: MigrationCheckpoint,
): Promise<number | null> {
  const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const script = `import { pathToFileURL } from 'node:url';
    const { migrateProject } = await import(pathToFileURL(process.argv[1]).href);
    await migrateProject(process.argv[2], { checkpoint: async (point) => {
      if (point === process.argv[3]) process.exit(71);
    } });`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, entry, root, target],
      { stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
}
