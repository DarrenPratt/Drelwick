import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  IPC,
  type ReferenceResponse,
  type ProjectOperationResult,
  type SafeLogger,
} from "@drelwick/shared";
import { openProject } from "@drelwick/core";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle }, dialog: {} }));
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";
const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((c) => c.cleanup()));
});
async function setup() {
  handle.mockReset();
  const copy = await copyFixture("public-example");
  copies.push(copy);
  const projectId = (await openProject(copy.projectPath)).project.projectId;
  const frame = { url: "file:///app/index.html" },
    webContents = { mainFrame: {} };
  webContents.mainFrame = frame;
  const window = {
    webContents,
    isDestroyed: () => false,
  } as unknown as BrowserWindow;
  const event = {
    sender: webContents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies SafeLogger;
  const runtime = registerProjectHandlers(() => window, frame.url, {
    selectExistingFolder: async () => copy.projectPath,
    logger,
  });
  const invoke = async (channel: string, payload?: unknown, source = event) => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )![1] as (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ) => Promise<ProjectOperationResult<ReferenceResponse>>;
    return handler(source, payload);
  };
  return { ...copy, projectId, frame, event, invoke, logger, runtime };
}
it("authorizes the active project/top frame and validates typed reference payloads without logging content", async () => {
  const f = await setup();
  try {
    const request = { operation: "list", projectId: f.projectId };
    expect(await f.invoke(IPC.REFERENCE_EXECUTE, request)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_NOT_OPEN" },
    });
    await f.invoke(IPC.PROJECT_OPEN);
    for (const source of [
      { ...f.event, sender: {} },
      { ...f.event, senderFrame: { url: f.frame.url } },
    ])
      expect(
        await f.invoke(
          IPC.REFERENCE_EXECUTE,
          request,
          source as IpcMainInvokeEvent,
        ),
      ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
    expect(
      await f.invoke(IPC.REFERENCE_EXECUTE, {
        ...request,
        projectId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_OPEN" } });
    for (const invalid of [
      { ...request, projectPath: f.projectPath },
      {
        operation: "read",
        projectId: f.projectId,
        kind: "note",
        id: "../../book",
      },
      {
        operation: "create",
        projectId: f.projectId,
        generation: 1,
        content: {
          kind: "note",
          title: "SECRET_PRIVATE_TEXT",
          body: "private",
          tags: [],
          links: [],
          future: true,
        },
      },
    ])
      expect(await f.invoke(IPC.REFERENCE_EXECUTE, invalid)).toMatchObject({
        ok: false,
        error: { code: "REFERENCE_INPUT_INVALID" },
      });
    const response = await f.invoke(IPC.REFERENCE_EXECUTE, {
      operation: "create",
      projectId: f.projectId,
      generation: 1,
      content: {
        kind: "note",
        title: "Research",
        body: "SECRET_PRIVATE_TEXT",
        tags: [],
        links: [],
      },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.value.type !== "record")
      throw new Error("Expected saved reference");
    const saved = response.value.value;
    expect(
      JSON.parse(
        await readFile(
          join(f.projectPath, "reference", "notes", `${saved.record.id}.json`),
          "utf8",
        ),
      ),
    ).toEqual(saved.record);
    expect(
      await f.invoke(IPC.REFERENCE_EXECUTE, {
        operation: "delete",
        projectId: f.projectId,
        kind: "note",
        id: saved.record.id,
        generation: 2,
        expectedRevision: saved.record.revision,
        expectedFingerprint: saved.fingerprint,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        type: "record",
        value: { record: { revision: 2, deletedAt: expect.any(String) } },
      },
    });
    expect(
      JSON.stringify(
        Object.values(f.logger).flatMap((mock) => mock.mock.calls),
      ),
    ).not.toContain("SECRET_PRIVATE_TEXT");
    f.frame.url = "https://untrusted.invalid";
    expect(await f.invoke(IPC.REFERENCE_EXECUTE, request)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ACCESS_DENIED" },
    });
  } finally {
    await f.runtime.stopHistory();
  }
});

it("validates and authorizes chapter-link mutations through the restricted IPC", async () => {
  const f = await setup();
  try {
    await f.invoke(IPC.PROJECT_OPEN);
    const result = await f.invoke(IPC.REFERENCE_EXECUTE, {
      operation: "create",
      projectId: f.projectId,
      generation: 1,
      content: {
        kind: "note",
        title: "Private",
        body: "PRIVATE_LINK_CONTENT",
        tags: [],
        links: [],
      },
    });
    if (!result.ok || result.value.type !== "record")
      throw new Error("Expected reference");
    const saved = result.value.value;
    const chapterId = (await openProject(f.projectPath)).project.manuscript
      .order[0]!;
    const command = {
      operation: "link-attach",
      projectId: f.projectId,
      kind: "note",
      id: saved.record.id,
      expectedRevision: saved.record.revision,
      expectedFingerprint: saved.fingerprint,
      chapterId,
      generation: 2,
    };
    for (const request of [
      { ...command, chapterId: "../book" },
      { ...command, path: f.projectPath },
      { ...command, expectedFingerprint: "invalid" },
    ])
      expect(await f.invoke(IPC.REFERENCE_EXECUTE, request)).toMatchObject({
        ok: false,
        error: { code: "REFERENCE_INPUT_INVALID" },
      });
    expect(
      await f.invoke(IPC.REFERENCE_EXECUTE, command, {
        ...f.event,
        sender: {},
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
    expect(
      await f.invoke(IPC.REFERENCE_EXECUTE, {
        ...command,
        projectId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_OPEN" } });
    expect(await f.invoke(IPC.REFERENCE_EXECUTE, command)).toMatchObject({
      ok: true,
      value: {
        type: "record",
        value: {
          record: { links: [{ target: { kind: "chapter", id: chapterId } }] },
        },
      },
    });
    expect(
      JSON.stringify(
        Object.values(f.logger).map((method) => method.mock.calls),
      ),
    ).not.toContain("PRIVATE_LINK_CONTENT");
  } finally {
    await f.runtime.stopHistory();
  }
});
