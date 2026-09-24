import { expect, it, vi } from "vitest";
import { createHistorySnapshot } from "@drelwick/core";
import type { SafeLogger } from "@drelwick/shared";
import { HistoryRuntime } from "../src/main/history-runtime.js";

function logger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies SafeLogger;
}

it("serializes snapshots and retention for the same project", async () => {
  const logs = logger();
  let finishSnapshot!: () => void;
  const snapshot = vi.fn<typeof createHistorySnapshot>(
    () =>
      new Promise((resolve) => {
        finishSnapshot = () => resolve(null);
      }),
  );
  const retain = vi.fn().mockResolvedValue({ removed: 1, retained: 2 });
  const runtime = new HistoryRuntime({
    snapshot,
    retain,
    logger: logs,
  });

  runtime.scheduleSnapshot({
    projectPath: "/project",
    projectId: "project-id",
    chapterId: "chapter",
    document: { type: "doc", content: [{ type: "paragraph" }] },
  });
  runtime.scheduleRetention({
    projectPath: "/project",
    projectId: "project-id",
  });
  await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
  expect(retain).not.toHaveBeenCalled();

  finishSnapshot();
  await runtime.settleProject("/project");
  expect(retain).toHaveBeenCalledOnce();
  expect(logs.info).toHaveBeenCalledWith("history.retention_completed", {
    projectId: "project-id",
  });
  await runtime.shutdown();
});

it("isolates snapshot and retention failures and logs classification only", async () => {
  const logs = logger();
  const runtime = new HistoryRuntime({
    snapshot: vi.fn().mockRejectedValue(new Error("private manuscript text")),
    retain: vi.fn().mockRejectedValue(new Error("private manuscript text")),
    logger: logs,
  });

  runtime.scheduleSnapshot({
    projectPath: "/project",
    projectId: "project-id",
    chapterId: "chapter",
    document: {
      type: "doc",
      content: [{ type: "text", text: "private manuscript text" }],
    },
  });
  runtime.scheduleRetention({
    projectPath: "/project",
    projectId: "project-id",
  });
  await expect(runtime.settleAll()).resolves.toBeUndefined();

  expect(logs.error).toHaveBeenNthCalledWith(1, "history.snapshot_failed", {
    projectId: "project-id",
    chapterId: "chapter",
    errorName: "Error",
  });
  expect(logs.error).toHaveBeenNthCalledWith(2, "history.retention_failed", {
    projectId: "project-id",
    errorName: "Error",
  });
  expect(JSON.stringify(logs.error.mock.calls)).not.toContain(
    "private manuscript text",
  );
  await runtime.shutdown();
});

it("serializes project work independently and settles all pending work", async () => {
  const logs = logger();
  let finishFirst!: () => void;
  const snapshot = vi
    .fn<typeof createHistorySnapshot>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve(null);
        }),
    )
    .mockResolvedValue(null);
  const runtime = new HistoryRuntime({ snapshot, logger: logs });
  const input = {
    projectId: "project-id",
    chapterId: "chapter",
    document: {},
  };

  runtime.scheduleSnapshot({ ...input, projectPath: "/first" });
  runtime.scheduleSnapshot({ ...input, projectPath: "/second" });
  await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
  const settled = runtime.settleAll();
  finishFirst();
  await settled;
  expect(snapshot).toHaveBeenCalledTimes(2);
  await runtime.shutdown();
});

it("takes interval snapshots from the latest saved document and cancels on close", async () => {
  vi.useFakeTimers();
  const logs = logger();
  const snapshot = vi
    .fn<typeof createHistorySnapshot>()
    .mockResolvedValue(null);
  const runtime = new HistoryRuntime({ snapshot, logger: logs });
  const input = {
    projectPath: "/project",
    projectId: "project-id",
    chapterId: "chapter",
  };
  try {
    runtime.scheduleSnapshot({
      ...input,
      document: { text: "first" },
    });
    await runtime.settleProject(input.projectPath);
    expect(snapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    runtime.scheduleSnapshot({
      ...input,
      document: { text: "latest saved" },
    });
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await runtime.settleProject(input.projectPath);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(snapshot.mock.calls[1]?.[0].document).toEqual({
      text: "latest saved",
    });

    await runtime.closeProject(input.projectPath);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(snapshot).toHaveBeenCalledTimes(2);
  } finally {
    await runtime.shutdown();
    vi.useRealTimers();
  }
});
