import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  openProject,
  writeJsonAtomically,
} from "@bookeditor/core";
import {
  ApplicationError,
  createUuid,
  IPC,
  type ProjectOperationResult,
  type ProjectWorkspace,
  type SafeLogger,
} from "@bookeditor/shared";

const { handle, showOpenDialog } = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle },
  dialog: { showOpenDialog },
}));
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";

const rendererUrl = "file:///app/index.html";
const directories: string[] = [];
beforeEach(() => {
  handle.mockReset();
  showOpenDialog.mockReset();
});
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function setup() {
  const frame = { url: rendererUrl };
  const webContents = { mainFrame: frame };
  const window = {
    isDestroyed: () => false,
    webContents,
  } as unknown as BrowserWindow;
  const event = {
    sender: webContents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const open = vi.fn(openProject);
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies SafeLogger;
  registerProjectHandlers(() => window, rendererUrl, { open, logger });
  const invoke = (
    payload?: unknown,
    source = event,
    channel: string = IPC.PROJECT_OPEN,
  ): Promise<ProjectOperationResult<ProjectWorkspace | null>> => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )?.[1] as (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ) => Promise<ProjectOperationResult<ProjectWorkspace | null>>;
    return handler(source, payload);
  };
  return { frame, event, window, open, invoke, logger };
}

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "bookeditor-open-ui-"));
  directories.push(path);
  const created = await createProject({
    projectPath: path,
    title: "Existing book",
    author: "Writer",
    language: "en-GB",
  });
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] });
  return { path, ...created };
}

describe("existing project IPC", () => {
  it("uses native folder selection and returns validated metadata and body-free chapter summaries", async () => {
    const { invoke, window, logger } = setup();
    const { path, project } = await fixture();
    const id = createUuid();
    await writeJsonAtomically(join(path, "project.json"), {
      ...project,
      manuscript: { order: [id] },
    });
    await writeJsonAtomically(join(path, "manuscript", `${id}.json`), {
      schemaVersion: 1,
      id,
      title: "Beginning",
      type: "chapter",
      status: "review",
      created: project.created,
      modified: project.modified,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Synthetic text" }],
          },
        ],
      },
    });
    const before = await readFile(join(path, "project.json"), "utf8");
    expect(await invoke()).toMatchObject({
      ok: true,
      value: {
        title: "Existing book",
        author: "Writer",
        projectPath: path,
        chapters: [{ id, title: "Beginning", status: "review", wordCount: 2 }],
      },
    });
    expect(showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        properties: ["openDirectory"],
        buttonLabel: "Open project",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "project.opened",
      expect.objectContaining({
        projectId: project.projectId,
        source: "folder_picker",
        durationMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "Synthetic text",
    );
    expect(await readFile(join(path, "project.json"), "utf8")).toBe(before);
    expect(JSON.stringify(await invoke())).not.toContain("Synthetic text");
  });

  it("returns cancellation without calling the loader", async () => {
    const { invoke, open } = setup();
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke()).toEqual({ ok: true, value: null });
    expect(open).not.toHaveBeenCalled();
  });

  it("clears privileged project access when the trusted renderer closes a project", async () => {
    const { invoke, event } = setup();
    await fixture();
    expect((await invoke()).ok).toBe(true);

    expect(await invoke(undefined, event, IPC.PROJECT_CLOSE)).toEqual({
      ok: true,
      value: null,
    });
    expect(
      await invoke(
        { chapterId: createUuid() },
        event,
        IPC.PROJECT_LOAD_CHAPTER,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "PROJECT_NOT_OPEN" },
    });
  });

  it.each(["missing", "malformed", "unsupported"])(
    "reports a real %s project clearly",
    async (kind) => {
      const { invoke } = setup();
      const { path } = await fixture();
      const manifest = join(path, "project.json");
      if (kind === "missing") await rm(manifest);
      else
        await writeFile(
          manifest,
          kind === "malformed" ? "{ private text" : '{"schemaVersion":99}',
          "utf8",
        );
      const result = await invoke();
      expect(result).toMatchObject({
        ok: false,
        error: {
          code:
            kind === "missing"
              ? "PROJECT_FILE_MISSING"
              : kind === "malformed"
                ? "PROJECT_JSON_INVALID"
                : "PROJECT_SCHEMA_UNSUPPORTED",
        },
      });
      expect(JSON.stringify(result)).not.toContain("private text");
    },
  );

  it.each([
    "PROJECT_SCHEMA_INVALID",
    "PROJECT_ORDER_INVALID",
    "PROJECT_PATH_INVALID",
    "PROJECT_PATH_ACCESS_FAILED",
    "PROJECT_FILE_READ_FAILED",
    "PROJECT_CHANGED_DURING_OPEN",
  ])("maps %s to a safe message", async (code) => {
    const { invoke, open } = setup();
    await fixture();
    open.mockRejectedValue(new ApplicationError(code, "private contents"));
    const result = await invoke();
    expect(result).toMatchObject({
      ok: false,
      error: { code, message: expect.any(String) },
    });
    expect(JSON.stringify(result)).not.toContain("private contents");
  });

  it("rejects renderer paths, foreign senders and child frames before the picker", async () => {
    const { invoke, event, open } = setup();
    expect(await invoke({ path: "/unapproved" })).toMatchObject({
      ok: false,
      error: { code: "PROJECT_INPUT_INVALID" },
    });
    for (const source of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: rendererUrl } },
    ]) {
      expect(
        await invoke(undefined, source as IpcMainInvokeEvent),
      ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
    }
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("rechecks authorization after selection and after loading", async () => {
    const { invoke, frame, open } = setup();
    const { path } = await fixture();
    showOpenDialog.mockImplementationOnce(async () => {
      frame.url = "https://untrusted.example/";
      return { canceled: false, filePaths: [path] };
    });
    expect(await invoke()).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ACCESS_DENIED" },
    });
    expect(open).not.toHaveBeenCalled();
    frame.url = rendererUrl;
    open.mockImplementationOnce(async (path) => {
      const project = await openProject(path);
      frame.url = "https://untrusted.example/";
      return project;
    });
    expect(await invoke()).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ACCESS_DENIED" },
    });
  });

  it("serializes opening with folder selection and releases the guard after failure", async () => {
    const { invoke, open, event } = setup();
    await fixture();
    let reject!: (error: Error) => void;
    open.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const first = invoke();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(await invoke()).toMatchObject({
      ok: false,
      error: { code: "PROJECT_BUSY" },
    });
    expect(
      await invoke(undefined, event, IPC.PROJECT_SELECT_LOCATION),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_BUSY" } });
    reject(new Error("private details"));
    expect(await first).toMatchObject({
      ok: false,
      error: { code: "PROJECT_OPEN_FAILED" },
    });
    expect(await invoke()).toMatchObject({ ok: true });
  });

  it("handles native picker failures without forwarding raw errors", async () => {
    const { invoke, open } = setup();
    showOpenDialog.mockRejectedValue(new Error("private details"));
    expect(await invoke()).toEqual({
      ok: false,
      error: {
        code: "PROJECT_OPEN_FAILED",
        message:
          "Unable to open the project. Check that the folder is available and try again.",
      },
    });
    expect(open).not.toHaveBeenCalled();
  });
});
