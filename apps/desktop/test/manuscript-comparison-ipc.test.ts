import { afterEach, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { createUuid, IPC } from "@drelwick/shared";
import { copyFixture } from "../../../tests/helpers/fixture-projects.js";
import {
  openProjectForEditing,
  migrateProjectToEditorialV3,
  openProject,
  saveChapter,
} from "@drelwick/core";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle } }));
import { registerComparisonHandler } from "../src/main/ipc/comparison-handler.js";

type Reply = {
  ok: boolean;
  value?: { token: string; source: unknown };
  error?: { code: string; message: string };
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
  handle.mockReset();
});
it("scopes read-only tokens to the active project/session/frame, rejects paths and stale generations, and sanitizes source failures", async () => {
  const fixture = await copyFixture("multi-chapter-book");
  cleanups.push(fixture.cleanup);
  await openProjectForEditing(fixture.projectPath);
  await migrateProjectToEditorialV3(fixture.projectPath);
  const opened = await openProject(fixture.projectPath),
    projectId = opened.project.projectId;
  let epoch = 1;
  const owner = {} as IpcMainInvokeEvent["senderFrame"];
  const event = { senderFrame: owner } as IpcMainInvokeEvent;
  let trusted = true;
  const control = registerComparisonHandler({
    trusted: (source) => trusted && source.senderFrame === owner,
    session: () => ({ projectPath: fixture.projectPath, projectId, epoch }),
    settle: async () => {},
  });
  cleanups.push(async () => control.clear());
  const handler = handle.mock.calls.find(
    ([channel]) => channel === IPC.COMPARISON_ACTION,
  )![1] as (event: IpcMainInvokeEvent, payload: unknown) => Promise<Reply>;
  const invoke = (payload: Record<string, unknown>, source = event) =>
    handler(source, { projectId, ...payload });
  const capture = () =>
    invoke({
      operation: "capture",
      source: { kind: "captured-current", projection: "proposed" },
    });
  expect(
    (
      await invoke({
        operation: "capture",
        source: {
          kind: "captured-current",
          projection: "proposed",
          path: "PRIVATE PATH",
        },
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await handler(event, {
        operation: "capture",
        projectId: createUuid(),
        source: { kind: "captured-current", projection: "proposed" },
      })
    ).error!.code,
  ).toBe("PROJECT_NOT_OPEN");
  expect(
    (
      await invoke(
        {
          operation: "capture",
          source: { kind: "captured-current", projection: "proposed" },
        },
        { senderFrame: {} } as IpcMainInvokeEvent,
      )
    ).error!.code,
  ).toBe("PROJECT_ACCESS_DENIED");
  const a = (await capture()).value!,
    b = (await capture()).value!;
  expect(a.source).toMatchObject({
    kind: "captured-current",
    projection: "proposed",
    projectId,
  });
  const compared = await invoke({
    operation: "compare",
    requestId: createUuid(),
    left: a.token,
    right: b.token,
  });
  expect(compared.value!).toMatchObject({ complete: true, changes: [] });
  expect(JSON.stringify(compared)).not.toContain(fixture.projectPath);
  await saveChapter({
    projectPath: fixture.projectPath,
    chapterId: opened.chapters[0]!.id,
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Saved later" }] },
      ],
    },
  });
  expect(
    (await invoke({ operation: "status", token: a.token })).value!,
  ).toEqual({ stale: true });
  expect(
    (
      await invoke({
        operation: "compare",
        requestId: createUuid(),
        left: a.token,
        right: b.token,
      })
    ).error!.code,
  ).toBe("COMPARISON_STALE");
  epoch++;
  expect(
    (
      await invoke({
        operation: "compare",
        requestId: createUuid(),
        left: a.token,
        right: b.token,
      })
    ).error!.code,
  ).toBe("COMPARISON_STALE");
  const path = join(
      fixture.projectPath,
      "manuscript",
      `${opened.chapters[0]!.id}.json`,
    ),
    original = await readFile(path);
  await writeFile(path, "PRIVATE MANUSCRIPT ERROR PAYLOAD");
  const failed = await capture();
  expect(failed.ok).toBe(false);
  expect(JSON.stringify(failed)).not.toMatch(
    /PRIVATE|drelwick-fixture|manuscript\//,
  );
  expect(await readFile(path, "utf8")).toBe("PRIVATE MANUSCRIPT ERROR PAYLOAD");
  await writeFile(path, original);
  trusted = false;
  expect((await capture()).error!.code).toBe("PROJECT_ACCESS_DENIED");
});

it("accepts cancellation during actual comparison work and never returns an obsolete result", async () => {
  const fixture = await copyFixture("minimal-book");
  cleanups.push(fixture.cleanup);
  await openProjectForEditing(fixture.projectPath);
  await migrateProjectToEditorialV3(fixture.projectPath);
  const opened = await openProject(fixture.projectPath),
    projectId = opened.project.projectId;
  const owner = {} as IpcMainInvokeEvent["senderFrame"],
    event = { senderFrame: owner } as IpcMainInvokeEvent;
  registerComparisonHandler({
    trusted: (source) => source.senderFrame === owner,
    session: () => ({ projectPath: fixture.projectPath, projectId, epoch: 1 }),
    settle: async () => {},
  });
  const handler = handle.mock.calls.find(
    ([channel]) => channel === IPC.COMPARISON_ACTION,
  )![1] as (event: IpcMainInvokeEvent, payload: unknown) => Promise<Reply>;
  const capture = async () =>
    (
      await handler(event, {
        operation: "capture",
        projectId,
        source: { kind: "captured-current", projection: "proposed" },
      })
    ).value!;
  const a = await capture(),
    b = await capture(),
    requestId = createUuid();
  const pending = handler(event, {
    operation: "compare",
    projectId,
    requestId,
    left: a.token,
    right: b.token,
  });
  expect(
    await handler(event, { operation: "cancel", projectId, requestId }),
  ).toEqual({ ok: true, value: null });
  expect((await pending).error!.code).toBe("COMPARISON_CANCELLED");
});
