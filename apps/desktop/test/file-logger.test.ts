import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { safeErrorContext, type SafeLogContext } from "@bookeditor/shared";
import {
  FileLogger,
  LOG_DIRECTORY_NAME,
  LOG_FILE_NAME,
  installProcessErrorHandling,
} from "../src/main/logging/file-logger.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(
  options: ConstructorParameters<typeof FileLogger>[1] = {},
) {
  const userData = await mkdtemp(join(tmpdir(), "bookeditor-logging-"));
  directories.push(userData);
  return {
    logger: new FileLogger(userData, options),
    path: join(userData, LOG_DIRECTORY_NAME, LOG_FILE_NAME),
  };
}

it("writes structured UTF-8 logs beneath application data without manuscript bodies", async () => {
  const sentinel = "SENTINEL MANUSCRIPT PROSE";
  const { logger, path } = await fixture({
    now: () => new Date("2026-09-21T10:00:00.000Z"),
  });

  logger.info("chapter.saved", {
    projectId: "project-id",
    chapterId: "chapter-id",
    source: "autosave",
  });
  logger.error("chapter.save_failed", {
    chapterId: "chapter-id",
    ...safeErrorContext(new Error(sentinel)),
  });
  logger.info("recovery.recovered", {
    candidateId: "candidate-id",
    source: "history",
  });
  logger.error("unsafe.input", {
    document: { type: "doc", content: sentinel },
    manuscriptText: sentinel,
    payload: JSON.stringify({ content: sentinel }),
  } as unknown as SafeLogContext);

  const contents = await readFile(path, "utf8");
  const records = contents
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records[0]).toEqual({
    timestamp: "2026-09-21T10:00:00.000Z",
    level: "info",
    event: "chapter.saved",
    context: {
      projectId: "project-id",
      chapterId: "chapter-id",
      source: "autosave",
    },
  });
  expect(records.map(({ event }) => event)).toEqual([
    "chapter.saved",
    "chapter.save_failed",
    "recovery.recovered",
    "unsafe.input",
  ]);
  expect(contents).not.toContain(sentinel);
  expect(contents).not.toContain('"type":"doc"');
  expect(records[3]).not.toHaveProperty("context");
});

it("rotates logs at the configured size and bounds retained files", async () => {
  const { logger, path } = await fixture({ maxBytes: 240, backups: 2 });
  for (let sequence = 0; sequence < 12; sequence += 1)
    logger.info("rotation.check", {
      durationMs: sequence,
      projectId: "x".repeat(40),
    });

  const directory = join(path, "..");
  const files = (await readdir(directory)).sort();
  expect(files).toEqual([
    LOG_FILE_NAME,
    `${LOG_FILE_NAME}.1`,
    `${LOG_FILE_NAME}.2`,
  ]);
  for (const file of files)
    expect((await stat(join(directory, file))).size).toBeLessThanOrEqual(240);
});

it("captures unhandled process errors without their message or stack", () => {
  const listeners = new Map<string, (...args: never[]) => void>();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const onFatalError = vi.fn();
  installProcessErrorHandling(logger, onFatalError, {
    on: (event: string, listener: (...args: never[]) => void) =>
      listeners.set(event, listener),
  } as never);

  listeners.get("uncaughtException")?.(
    new Error("SENTINEL MANUSCRIPT PROSE") as never,
    "unhandledRejection" as never,
  );
  listeners.get("unhandledRejection")?.(
    new Error("SENTINEL MANUSCRIPT PROSE") as never,
  );
  const unsafeName = new Error("failure");
  unsafeName.name = "SENTINEL MANUSCRIPT PROSE";
  listeners.get("unhandledRejection")?.(unsafeName as never);

  expect(logger.error).toHaveBeenNthCalledWith(
    1,
    "application.uncaught_exception",
    { origin: "unhandledRejection", errorName: "Error" },
  );
  expect(logger.error).toHaveBeenNthCalledWith(
    2,
    "application.unhandled_rejection",
    { errorName: "Error" },
  );
  expect(logger.error).toHaveBeenNthCalledWith(
    3,
    "application.unhandled_rejection",
    { errorName: "UnknownError" },
  );
  expect(onFatalError).toHaveBeenNthCalledWith(1, "uncaught_exception");
  expect(onFatalError).toHaveBeenNthCalledWith(2, "unhandled_rejection");
  expect(onFatalError).toHaveBeenNthCalledWith(3, "unhandled_rejection");
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SENTINEL");
});
