import { join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import {
  IPC,
  type ProjectOperationResult,
  type ProjectWorkspace,
  type PublicationState,
  type BookPreview,
} from "@drelwick/shared";
import {
  copyFixture,
  type FixtureCopy,
} from "../../../tests/helpers/fixture-projects.js";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";
const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle }, dialog: {} }));
import { registerProjectHandlers } from "../src/main/ipc/project-handlers.js";

const copies: FixtureCopy[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => copy.cleanup()));
});
async function setup() {
  handle.mockReset();
  const copy = await copyFixture("minimal-book");
  copies.push(copy);
  const source = join(copy.projectPath, "synthetic.png");
  await writeFile(source, await syntheticImage());
  const frame = { url: "file:///app/index.html" };
  const contents = { mainFrame: frame };
  const window = {
    isDestroyed: () => false,
    webContents: contents,
  } as unknown as BrowserWindow;
  const event = {
    sender: contents,
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const picker = vi.fn(async (): Promise<string | null> => source);
  const history = {
    scheduleSnapshot: vi.fn(),
    scheduleRetention: vi.fn(),
    settleProject: vi.fn(async (): Promise<void> => undefined),
    closeProject: async () => undefined,
    settleAll: async () => undefined,
    shutdown: async () => undefined,
  };
  registerProjectHandlers(() => window, frame.url, {
    selectExistingFolder: async () => copy.projectPath,
    selectImage: picker,
    history,
  });
  const invoke = async (
    channel: string,
    payload?: unknown,
    sender = event,
  ): Promise<ProjectOperationResult<unknown>> => {
    const handler = handle.mock.calls.find(
      ([name]) => name === channel,
    )?.[1] as (
      event: IpcMainInvokeEvent,
      payload: unknown,
    ) => Promise<ProjectOperationResult<unknown>>;
    return handler(sender, payload);
  };
  const opened = (await invoke(
    IPC.PROJECT_OPEN,
  )) as ProjectOperationResult<ProjectWorkspace>;
  if (!opened.ok) throw new Error("Fixture open failed");
  return {
    invoke,
    picker,
    history,
    event,
    source,
    projectPath: copy.projectPath,
    projectId: opened.value.projectId,
    chapterId: opened.value.chapters[0]!.id,
  };
}
it("imports through the native picker and exposes only managed bytes and identity", async () => {
  const f = await setup();
  const result = await f.invoke(IPC.IMAGE_IMPORT, {
    projectId: f.projectId,
    chapterId: f.chapterId,
  });
  expect(result).toEqual({ ok: true, value: { assetId: expect.any(String) } });
  if (!result.ok) throw new Error("Import failed");
  expect(JSON.stringify(result)).not.toContain(f.source);
  const value = result.value as { assetId: string };
  expect(
    await f.invoke(IPC.IMAGE_READ, {
      projectId: f.projectId,
      assetId: value.assetId,
    }),
  ).toEqual({
    ok: true,
    value: {
      dataUrl: `data:image/png;base64,${(await syntheticImage()).toString("base64")}`,
    },
  });
  f.picker.mockResolvedValueOnce(null);
  expect(
    await f.invoke(IPC.IMAGE_IMPORT, {
      projectId: f.projectId,
      chapterId: f.chapterId,
    }),
  ).toEqual({ ok: true, value: null });
});

it("authorizes theme requests and restyles a cached revision without reading or rewriting chapters", async () => {
  const f = await setup();
  const input = { projectId: f.projectId, themeId: "modern" };
  for (const channel of [IPC.BOOK_THEME_GET, IPC.BOOK_THEME_SET]) {
    expect(
      await f.invoke(channel, input, {
        ...f.event,
        senderFrame: { url: "about:srcdoc" },
      } as unknown as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
    expect(
      await f.invoke(channel, {
        projectId: "00000000-0000-4000-8000-000000000999",
        ...(channel === IPC.BOOK_THEME_SET ? { themeId: "classic" } : {}),
      }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_OPEN" } });
  }
  for (const themeId of [
    "../secret",
    "file:///secret",
    "url(https://example.invalid)",
    "unknown-theme",
  ])
    expect(
      await f.invoke(IPC.BOOK_THEME_SET, { ...input, themeId }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(
    await f.invoke(IPC.BOOK_THEME_SET, { ...input, css: "body{}" }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(
    await f.invoke(IPC.BOOK_THEME_SET, {
      ...input,
      previewRevision: "a".repeat(64),
    }),
  ).toMatchObject({ ok: false, error: { code: "BOOK_PREVIEW_EXPIRED" } });
  const preview = await f.invoke(IPC.BOOK_PREVIEW, { projectId: f.projectId });
  if (!preview.ok) throw new Error("Preview failed");
  const first = preview.value as { revision: string; document: string };
  const path = join(f.projectPath, "manuscript", `${f.chapterId}.json`);
  const bytes = await readFile(path, "utf8");
  // A different valid persisted revision cannot change the already-open snapshot.
  const chapter = JSON.parse(bytes);
  chapter.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Later revision" }],
      },
    ],
  };
  const later = JSON.stringify(chapter);
  await writeFile(path, later);
  const switched = await f.invoke(IPC.BOOK_THEME_SET, {
    ...input,
    previewRevision: first.revision,
  });
  expect(switched).toMatchObject({
    ok: true,
    value: {
      selection: { themeId: "modern" },
      preview: { revision: first.revision },
    },
  });
  if (!switched.ok) throw new Error("Switch failed");
  const next = (switched.value as { preview: { document: string } }).preview;
  expect(next.document).not.toBe(first.document);
  expect(next.document.split("<body>")[1]).toBe(
    first.document.split("<body>")[1],
  );
  expect(next.document).not.toContain("Later revision");
  expect(await readFile(path, "utf8")).toBe(later);
  expect(
    await f.invoke(IPC.BOOK_THEME_GET, { projectId: f.projectId }),
  ).toMatchObject({ ok: true, value: { themeId: "modern" } });
  await f.invoke(IPC.PROJECT_CLOSE);
  expect(await f.invoke(IPC.BOOK_THEME_SET, input)).toMatchObject({
    ok: false,
    error: { code: "PROJECT_NOT_OPEN" },
  });
  await f.invoke(IPC.PROJECT_OPEN);
  expect(
    await f.invoke(IPC.BOOK_THEME_SET, {
      ...input,
      previewRevision: first.revision,
    }),
  ).toMatchObject({ ok: false, error: { code: "BOOK_PREVIEW_EXPIRED" } });
});

it("authorizes book preview by main frame and active identity and rejects arbitrary paths", async () => {
  const f = await setup();
  const input = { projectId: f.projectId };
  expect(
    await f.invoke(IPC.BOOK_PREVIEW, input, {
      ...f.event,
      senderFrame: { url: "about:srcdoc" },
    } as unknown as IpcMainInvokeEvent),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  expect(
    await f.invoke(IPC.BOOK_PREVIEW, { ...input, path: "file:///secret" }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(
    await f.invoke(IPC.BOOK_PREVIEW, {
      projectId: "00000000-0000-4000-8000-000000000999",
    }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_OPEN" } });
  const result = await f.invoke(IPC.BOOK_PREVIEW, input);
  expect(result).toMatchObject({
    ok: true,
    value: {
      complete: true,
      revision: expect.any(String),
      document: expect.stringContaining("default-src &apos;none&apos;"),
    },
  });
  expect(JSON.stringify(result)).not.toContain(f.source);
});

it("simulates only the captured revision, detects stale sources and preserves the cache after failed refresh", async () => {
  const f = await setup();
  const result = await f.invoke(IPC.BOOK_PREVIEW, { projectId: f.projectId });
  if (!result.ok) throw new Error("Preview failed");
  const original = result.value as BookPreview;
  const identity = { projectId: f.projectId, revision: original.revision };
  const simulation = { fontSize: 24, appearance: "dark" };
  for (const channel of [IPC.BOOK_PREVIEW_STATUS, IPC.BOOK_PREVIEW_SIMULATE]) {
    const input = {
      ...identity,
      ...(channel === IPC.BOOK_PREVIEW_SIMULATE ? { simulation } : {}),
    };
    expect(
      await f.invoke(channel, input, {
        ...f.event,
        senderFrame: { url: "about:srcdoc" },
      } as unknown as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
    expect(
      await f.invoke(channel, { ...input, path: "file:///secret" }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
    expect(
      await f.invoke(channel, { ...input, revision: "a".repeat(64) }),
    ).toMatchObject({ ok: false, error: { code: "BOOK_PREVIEW_EXPIRED" } });
    expect(
      await f.invoke(channel, {
        ...input,
        projectId: "00000000-0000-4000-8000-000000000999",
      }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_OPEN" } });
  }
  for (const invalid of [
    { fontSize: 500, appearance: "dark" },
    { fontSize: 16, appearance: "url(https://remote.invalid)" },
    { ...simulation, css: "body{}" },
  ])
    expect(
      await f.invoke(IPC.BOOK_PREVIEW_SIMULATE, {
        ...identity,
        simulation: invalid,
      }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(await f.invoke(IPC.BOOK_PREVIEW_STATUS, identity)).toEqual({
    ok: true,
    value: { stale: false },
  });
  const path = join(f.projectPath, "manuscript", `${f.chapterId}.json`);
  const chapter = JSON.parse(await readFile(path, "utf8"));
  chapter.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Later saved revision" }],
      },
    ],
  };
  const later = JSON.stringify(chapter);
  await writeFile(path, later);
  expect(await f.invoke(IPC.BOOK_PREVIEW_STATUS, identity)).toEqual({
    ok: true,
    value: { stale: true },
  });
  const simulated = await f.invoke(IPC.BOOK_PREVIEW_SIMULATE, {
    ...identity,
    simulation,
  });
  if (!simulated.ok) throw new Error("Simulation failed");
  const passive = simulated.value as BookPreview;
  expect(passive.revision).toBe(original.revision);
  expect(passive.theme).toEqual(original.theme);
  expect(passive.document.split("<body>")[1]).toBe(
    original.document.split("<body>")[1],
  );
  expect(passive.document).toContain("font-size: 24px");
  expect(passive.document).toContain("color-scheme: dark");
  expect(passive.document).not.toContain("Later saved revision");
  expect(await readFile(path, "utf8")).toBe(later);
  await writeFile(path, "invalid private manuscript data");
  expect(
    await f.invoke(IPC.BOOK_PREVIEW, { projectId: f.projectId }),
  ).toMatchObject({ ok: false, error: { code: "BOOK_PREVIEW_FAILED" } });
  expect(
    await f.invoke(IPC.BOOK_PREVIEW_SIMULATE, { ...identity, simulation }),
  ).toEqual(simulated);
  expect(await readFile(path, "utf8")).toBe("invalid private manuscript data");
  await writeFile(path, later);
  const refreshed = await f.invoke(IPC.BOOK_PREVIEW, {
    projectId: f.projectId,
  });
  expect(refreshed).toMatchObject({
    ok: true,
    value: { document: expect.stringContaining("Later saved revision") },
  });
  expect(
    await f.invoke(IPC.BOOK_PREVIEW_SIMULATE, { ...identity, simulation }),
  ).toMatchObject({ ok: false, error: { code: "BOOK_PREVIEW_EXPIRED" } });
});

it("queues explicit refresh behind an in-flight currency check instead of failing busy", async () => {
  const f = await setup();
  const preview = await f.invoke(IPC.BOOK_PREVIEW, { projectId: f.projectId });
  if (!preview.ok) throw new Error("Preview failed");
  let finish!: () => void;
  f.history.settleProject.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const status = f.invoke(IPC.BOOK_PREVIEW_STATUS, {
    projectId: f.projectId,
    revision: (preview.value as BookPreview).revision,
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const refresh = f.invoke(IPC.BOOK_PREVIEW, { projectId: f.projectId });
  finish();
  expect(await status).toEqual({ ok: true, value: { stale: false } });
  expect(await refresh).toMatchObject({ ok: true });
});

it("restricts publication operations to the active main frame and validates metadata, semantic pages and cover selection", async () => {
  const f = await setup();
  const input = { projectId: f.projectId };
  for (const channel of [
    IPC.PUBLICATION_GET,
    IPC.PUBLICATION_SAVE,
    IPC.PUBLICATION_COVER,
  ]) {
    expect(
      await f.invoke(channel, input, {
        ...f.event,
        senderFrame: { url: "about:srcdoc" },
      } as unknown as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  }
  expect(
    await f.invoke(IPC.PUBLICATION_GET, { ...input, path: "file:///secret" }),
  ).toMatchObject({ ok: false });
  expect(
    await f.invoke(IPC.PUBLICATION_GET, {
      projectId: "00000000-0000-4000-8000-000000000999",
    }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_OPEN" } });
  const loaded = await f.invoke(IPC.PUBLICATION_GET, input);
  if (!loaded.ok) throw new Error("Publication unavailable");
  const state = loaded.value as PublicationState;
  const unsafe = {
    ...state.data,
    metadata: { ...state.data.metadata, language: "javascript:alert(1)" },
  };
  expect(
    await f.invoke(IPC.PUBLICATION_SAVE, {
      ...input,
      expectedRevision: state.revision,
      data: unsafe,
    }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  const metadata = {
    ...state.data.metadata,
    title: '<script>alert("metadata")</script>',
    author: "Tom & Jane",
    description: '" < > & 日本語',
  };
  const saved = await f.invoke(IPC.PUBLICATION_SAVE, {
    ...input,
    expectedRevision: state.revision,
    data: { ...state.data, metadata },
  });
  expect(saved).toMatchObject({ ok: true, value: { data: { metadata } } });
  if (!saved.ok) throw new Error("Save failed");
  const current = saved.value as PublicationState;
  expect(
    await f.invoke(IPC.PUBLICATION_COVER, {
      ...input,
      expectedRevision: current.revision,
      sourcePath: f.source,
    }),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(f.picker).not.toHaveBeenCalled();
  f.picker.mockResolvedValueOnce(null);
  expect(
    await f.invoke(IPC.PUBLICATION_COVER, {
      ...input,
      expectedRevision: current.revision,
    }),
  ).toEqual({ ok: true, value: null });
  const cover = await f.invoke(IPC.PUBLICATION_COVER, {
    ...input,
    expectedRevision: current.revision,
  });
  expect(cover).toMatchObject({
    ok: true,
    value: { data: { coverAssetId: expect.any(String) } },
  });
  expect(JSON.stringify(cover)).not.toContain(f.source);
  const preview = await f.invoke(IPC.BOOK_PREVIEW, input);
  if (!preview.ok) throw new Error("Preview failed");
  const document = (preview.value as { document: string }).document;
  expect(document).toContain(
    "&lt;script&gt;alert(&quot;metadata&quot;)&lt;/script&gt;",
  );
  expect(document).toContain("Tom &amp; Jane");
  expect(document).not.toContain("<script>");
});
it("rejects untrusted frames, paths, crafted IDs, foreign projects and unknown chapters before selection", async () => {
  const f = await setup();
  const input = { projectId: f.projectId, chapterId: f.chapterId };
  expect(
    await f.invoke(IPC.IMAGE_IMPORT, input, {
      ...f.event,
      senderFrame: { url: "https://untrusted.invalid" },
    } as IpcMainInvokeEvent),
  ).toMatchObject({ ok: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  for (const payload of [
    { ...input, sourcePath: f.source },
    { ...input, projectId: "00000000-0000-4000-8000-000000000099" },
    { ...input, chapterId: "00000000-0000-4000-8000-000000000099" },
  ])
    expect(await f.invoke(IPC.IMAGE_IMPORT, payload)).toMatchObject({
      ok: false,
    });
  expect(f.picker).not.toHaveBeenCalled();
  for (const assetId of [
    "../file",
    "C:\\image.png",
    "https://remote.invalid/x",
    "\\\\host\\x",
  ])
    expect(
      await f.invoke(IPC.IMAGE_READ, { projectId: f.projectId, assetId }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_INPUT_INVALID" } });
  expect(
    await f.invoke(IPC.IMAGE_READ, {
      projectId: f.projectId,
      assetId: "00000000-0000-4000-8000-000000000099",
    }),
  ).toMatchObject({ ok: false, error: { code: "IMAGE_UNAVAILABLE" } });
});
it("does not leak external paths or raw failure payloads", async () => {
  const f = await setup();
  f.picker.mockRejectedValueOnce(new Error(`private path ${f.source}`));
  const result = await f.invoke(IPC.IMAGE_IMPORT, {
    projectId: f.projectId,
    chapterId: f.chapterId,
  });
  expect(result).toMatchObject({ ok: false });
  expect(JSON.stringify(result)).not.toContain(f.source);
});
