import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  rename,
  symlink,
  open,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createProject,
  RecoveryService,
  writeJsonAtomicallyAt,
  CHAPTER_CREATION_LOCK,
  scanRecoveryCandidates,
  writeJsonAtomically,
} from "../src/index.js";
import { createUuid } from "@bookeditor/shared";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bookeditor-recovery-"));
  directories.push(root);
  const chapterId = createUuid();
  const project = await createProject({
    projectPath: root,
    title: "Recovery",
    author: "Author",
    language: "en-GB",
  });
  const chapter = {
    schemaVersion: 1,
    id: chapterId,
    type: "chapter",
    title: "Chapter",
    status: "draft",
    created: project.project.created,
    modified: "2026-09-18T16:00:00.000Z",
    content: { type: "doc", content: [{ type: "paragraph" }] },
  };
  await writeJsonAtomically(join(root, "project.json"), {
    ...project.project,
    manuscript: { order: [chapterId] },
  });
  await writeJsonAtomically(
    join(root, "manuscript", `${chapterId}.json`),
    chapter,
  );
  return { root, chapterId, chapter };
}

it("identifies newer valid temporary and history documents", async () => {
  const { root, chapterId, chapter } = await fixture();
  const temporary = {
    ...chapter,
    modified: "2026-09-18T16:05:00.000Z",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "temp" }] },
      ],
    },
  };
  await writeFile(
    join(root, "manuscript", `${chapterId}.json.tmp`),
    JSON.stringify(temporary),
    "utf8",
  );
  const historyPath = join(root, ".history", "snapshots", chapterId);
  await mkdir(historyPath, { recursive: true });
  await writeJsonAtomically(join(historyPath, `${createUuid()}.json`), {
    schemaVersion: 1,
    id: createUuid(),
    chapterId,
    created: "2026-09-18T16:10:00.000Z",
    reason: "manual",
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });

  const result = await scanRecoveryCandidates(root);
  expect(result.candidates.map(({ source }) => source)).toEqual([
    "history",
    "temporary",
  ]);
  expect(
    result.candidates.every((candidate) => candidate.chapterId === chapterId),
  ).toBe(true);
});

it("ignores invalid, tied, and older recovery data", async () => {
  const { root, chapterId, chapter } = await fixture();
  await writeFile(
    join(root, "manuscript", `${chapterId}.json.tmp`),
    "{ invalid",
    "utf8",
  );
  await writeFile(
    join(root, "manuscript", "not-a-uuid.json.tmp"),
    "{}",
    "utf8",
  );
  const historyPath = join(root, ".history", "snapshots", chapterId);
  await mkdir(historyPath, { recursive: true });
  for (const [index, created] of [
    "2026-09-18T15:59:00.000Z",
    "2026-09-18T16:00:00.000Z",
  ].entries()) {
    await writeJsonAtomically(join(historyPath, `${createUuid()}.json`), {
      schemaVersion: 1,
      id: createUuid(),
      chapterId,
      created,
      reason: "manual",
      content: chapter.content,
      index,
    });
  }

  await expect(scanRecoveryCandidates(root)).resolves.toEqual({
    candidates: [],
  });
});

it.each([
  ["2026-09-18T15:59:59.999Z", false],
  ["2026-09-18T16:00:00.000Z", false],
  ["2026-09-18T16:00:00.001Z", true],
] as const)(
  "offers a temporary document dated %s only when strictly newer",
  async (modified, expected) => {
    const { root, chapterId, chapter } = await fixture();
    const path = join(root, "manuscript", `${chapterId}.json.tmp`);
    const temporary = JSON.stringify({
      ...chapter,
      modified,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Recovered draft" }],
          },
        ],
      },
    });
    await writeFile(path, temporary, "utf8");

    const { candidates } = await scanRecoveryCandidates(root);
    expect(candidates).toHaveLength(expected ? 1 : 0);
    if (expected)
      expect(candidates[0]).toMatchObject({ chapterId, source: "temporary" });
    expect(await readFile(path, "utf8")).toBe(temporary);
  },
);

it("does not modify the authoritative manuscript", async () => {
  const { root, chapterId } = await fixture();
  const path = join(root, "manuscript", `${chapterId}.json`);
  const before = await readFile(path, "utf8");
  await writeFile(
    `${path}.tmp`,
    JSON.stringify({
      schemaVersion: 1,
      id: chapterId,
      type: "chapter",
      title: "Chapter",
      status: "draft",
      created: "2026-09-18T16:00:00.000Z",
      modified: "2026-09-18T16:05:00.000Z",
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }),
    "utf8",
  );
  await scanRecoveryCandidates(root);
  expect(await readFile(path, "utf8")).toBe(before);
});

async function pendingRecovery(source: "temporary" | "history" = "temporary") {
  const fixtureData = await fixture();
  const { root, chapterId, chapter } = fixtureData;
  const path = join(root, "manuscript", `${chapterId}.json`);
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Recovered text" }],
      },
    ],
  };
  const directory = join(root, ".history", "snapshots", chapterId);
  await mkdir(directory, { recursive: true });
  const candidatePath =
    source === "temporary"
      ? `${path}.tmp`
      : join(directory, `${createUuid()}.json`);
  await writeFile(
    candidatePath,
    JSON.stringify(
      source === "temporary"
        ? {
            ...chapter,
            content: document,
            modified: "2026-09-18T16:05:00.000Z",
          }
        : {
            schemaVersion: 1,
            id: createUuid(),
            chapterId,
            content: document,
            created: "2026-09-18T16:05:00.000Z",
            reason: "manual",
          },
    ),
  );
  const service = new RecoveryService();
  const { candidates } = await service.scanProject(root);
  const candidate = candidates[0]!;
  return {
    ...fixtureData,
    path,
    directory,
    candidatePath,
    document,
    service,
    candidate,
  };
}

it.each(["temporary", "history"] as const)(
  "recovers %s data only after preserving the original in history",
  async (source) => {
    const {
      service,
      candidate,
      path,
      directory,
      chapter,
      candidatePath,
      document,
      root,
    } = await pendingRecovery(source);
    // A recent snapshot must not suppress the mandatory backup.
    await writeJsonAtomically(join(directory, `${createUuid()}.json`), {
      schemaVersion: 1,
      id: createUuid(),
      chapterId: chapter.id,
      created: new Date().toISOString(),
      reason: "interval",
      content: chapter.content,
    });
    const original = { ...chapter, customMetadata: { keep: true } };
    await writeFile(path, JSON.stringify(original));
    const writeRecovery = vi.fn(async (destination: string, value: unknown) => {
      const history = await Promise.all(
        (await readdir(directory)).map(async (name) =>
          JSON.parse(await readFile(join(directory, name), "utf8")),
        ),
      );
      expect(history).toContainEqual(
        expect.objectContaining({
          reason: "before-recovery",
          content: chapter.content,
        }),
      );
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(original);
      await writeJsonAtomicallyAt(
        destination,
        `${destination}.recovery.tmp`,
        value,
      );
    });
    await service.recoverCandidate(candidate.id, { writeRecovery });
    expect(writeRecovery).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      ...original,
      content: document,
      modified: expect.any(String),
    });
    await expect(readFile(candidatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(service.getCandidates()).toEqual([]);
    expect((await scanRecoveryCandidates(root)).candidates).toEqual([]);
  },
);

it.each(["temporary", "history"] as const)(
  "discards only the selected %s candidate",
  async (source) => {
    const { service, candidate, path, candidatePath, directory } =
      await pendingRecovery(source);
    const before = await readFile(path, "utf8");
    await service.discardCandidate(candidate.id);
    expect(await readFile(path, "utf8")).toBe(before);
    await expect(readFile(candidatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(directory)).toEqual([]);
    expect(service.getCandidates()).toEqual([]);
  },
);

it.each(["snapshot", "replacement"])(
  "preserves the original and candidate on %s failure and supports retry",
  async (stage) => {
    const { service, candidate, path, candidatePath } = await pendingRecovery();
    const original = await readFile(path, "utf8");
    const recovery = await readFile(candidatePath, "utf8");
    const fail = async () => {
      throw new Error("private manuscript payload");
    };
    const overrides =
      stage === "snapshot"
        ? { writeJson: fail }
        : {
            writeRecovery: (destination: string, value: unknown) =>
              writeJsonAtomicallyAt(
                destination,
                `${destination}.recovery.tmp`,
                value,
                { open, unlink, rename: fail },
              ),
          };
    await expect(
      service.recoverCandidate(candidate.id, overrides),
    ).rejects.not.toThrow("private manuscript payload");
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readFile(candidatePath, "utf8")).toBe(recovery);
    expect(service.getCandidates()).toHaveLength(1);
    await service.recoverCandidate(candidate.id);
    expect(service.getCandidates()).toEqual([]);
  },
);

it("reports post-commit cleanup failure as a warning and allows discard retry", async () => {
  const { service, candidate, path, document } = await pendingRecovery();
  const result = await service.recoverCandidate(candidate.id, {
    unlink: async () => {
      throw new Error("denied");
    },
  });
  expect(result.warning).toContain("was recovered");
  expect(JSON.parse(await readFile(path, "utf8")).content).toEqual(document);
  await expect(service.recoverCandidate(candidate.id)).rejects.toMatchObject({
    code: "RECOVERY_STALE",
  });
  await service.discardCandidate(candidate.id);
  expect(service.getCandidates()).toEqual([]);
});

it("retains a candidate when discard fails", async () => {
  const { service, candidate, path, candidatePath } = await pendingRecovery();
  const original = await readFile(path, "utf8");
  await expect(
    service.discardCandidate(candidate.id, {
      unlink: async () => {
        throw new Error("denied");
      },
    }),
  ).rejects.toMatchObject({ code: "RECOVERY_DISCARD_FAILED" });
  expect(await readFile(path, "utf8")).toBe(original);
  expect(await readFile(candidatePath, "utf8")).toBeTruthy();
  expect(service.getCandidates()).toHaveLength(1);
});

it("rejects forged IDs and changed candidate identities/content", async () => {
  const { service, candidate, candidatePath, chapter, path } =
    await pendingRecovery();
  const original = await readFile(path, "utf8");
  await expect(service.recoverCandidate(createUuid())).rejects.toMatchObject({
    code: "RECOVERY_CANDIDATE_NOT_FOUND",
  });
  await writeFile(
    candidatePath,
    JSON.stringify({
      ...chapter,
      id: createUuid(),
      modified: candidate.created,
    }),
  );
  await expect(service.recoverCandidate(candidate.id)).rejects.toMatchObject({
    code: "RECOVERY_CANDIDATE_CHANGED",
  });
  await expect(service.discardCandidate(candidate.id)).rejects.toMatchObject({
    code: "RECOVERY_CANDIDATE_CHANGED",
  });
  expect(await readFile(path, "utf8")).toBe(original);
});

it("rejects stale candidates and chapters removed from the manifest", async () => {
  const { service, candidate, path, chapter, root } = await pendingRecovery();
  await writeFile(
    path,
    JSON.stringify({ ...chapter, modified: candidate.created }),
  );
  await expect(service.recoverCandidate(candidate.id)).rejects.toMatchObject({
    code: "RECOVERY_STALE",
  });
  const projectPath = join(root, "project.json");
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  await writeFile(
    projectPath,
    JSON.stringify({ ...project, manuscript: { order: [] } }),
  );
  await expect(service.recoverCandidate(candidate.id)).rejects.toMatchObject({
    code: "CHAPTER_NOT_FOUND",
  });
});

it("does not steal an existing chapter operation lock", async () => {
  const { service, candidate, root } = await pendingRecovery();
  await mkdir(join(root, CHAPTER_CREATION_LOCK));
  await expect(service.recoverCandidate(candidate.id)).rejects.toMatchObject({
    code: "PROJECT_BUSY",
  });
  expect(await readdir(root)).toContain(CHAPTER_CREATION_LOCK);
});

it("rejects linked history ancestors during recovery and scanning", async () => {
  const { service, candidate, root, path } = await pendingRecovery();
  const before = await readFile(path, "utf8");
  const history = join(root, ".history");
  const moved = join(root, "moved-history");
  await rename(history, moved);
  await symlink(
    moved,
    history,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(service.recoverCandidate(candidate.id)).rejects.toMatchObject({
    code: "RECOVERY_PATH_INVALID",
  });
  await expect(scanRecoveryCandidates(root)).rejects.toMatchObject({
    code: "RECOVERY_SCAN_FAILED",
  });
  expect(await readFile(path, "utf8")).toBe(before);
});

it("serializes recovery decisions", async () => {
  const { service, candidate } = await pendingRecovery();
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const operation = service.discardCandidate(candidate.id, {
    unlink: async (path) => {
      await gate;
      await unlink(path);
    },
  });
  await expect(service.discardCandidate(candidate.id)).rejects.toMatchObject({
    code: "RECOVERY_BUSY",
  });
  resume();
  await operation;
});
