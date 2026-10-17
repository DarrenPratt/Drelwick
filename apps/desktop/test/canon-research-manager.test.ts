// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrelwickApi, ReferenceRecord } from "@drelwick/shared";
import {
  CanonResearchManager,
  type CanonResearchEditorHandle,
} from "../src/renderer/CanonResearchManager.js";

const projectId = "00000000-0000-4000-8000-000000000201";
const noteId = "00000000-0000-4000-8000-000000000202";
const fingerprint = "a".repeat(64);
const note: Extract<ReferenceRecord, { kind: "note" }> = {
  schemaVersion: 1,
  kind: "note",
  id: noteId,
  projectId,
  created: "2026-10-14T10:00:00.000Z",
  modified: "2026-10-14T10:00:00.000Z",
  revision: 1,
  deletedAt: null,
  title: "港町",
  body: "A sheltered port with a stone lighthouse.",
  source: "Offline notebook",
  tags: ["coast", "home"],
  links: [],
};
const execute = vi.fn<DrelwickApi["references"]["execute"]>();
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("drelwick", { references: { execute } });
  execute.mockReset().mockImplementation(async (request) => {
    if (request.operation === "list")
      return {
        ok: true,
        value: {
          type: "list",
          records: [
            {
              id: note.id,
              kind: "note",
              title: note.title,
              revision: note.revision,
              deletedAt: null,
            },
          ],
          diagnostics: [],
          readOnly: false,
        },
      };
    if (request.operation === "recovery-list")
      return {
        ok: true,
        value: { type: "recovery", candidates: [], diagnostics: [] },
      };
    if (request.operation === "read")
      return {
        ok: true,
        value: { type: "record", value: { record: note, fingerprint } },
      };
    return {
      ok: true,
      value: {
        type: "record",
        value: {
          record: {
            ...note,
            ...("content" in request ? request.content : {}),
            kind: "note",
            revision: note.revision + 1,
            deletedAt:
              request.operation === "delete"
                ? "2026-10-14T11:00:00.000Z"
                : null,
          } as typeof note,
          fingerprint: "b".repeat(64),
        },
      },
    };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render() {
  await act(async () => {
    root.render(
      createElement(CanonResearchManager, { projectId, kind: "note" }),
    );
  });
}

function field(id: string) {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#${id}`,
  )!;
}

async function change(id: string, value: string) {
  await act(async () => {
    const node = field(id);
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("loads, edits and persists all approved note fields including Unicode", async () => {
  await render();
  expect(field("note-title").value).toBe("港町");
  await change("note-title", "霧の港");
  await change("note-body", "A quiet quay with a signal tower.");
  await change("note-source", "The tide stairs flood at moonrise.");
  await change("note-tag-1", "secret");
  await act(async () => container.querySelector("form")!.requestSubmit());

  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "update",
      expectedRevision: 1,
      expectedFingerprint: fingerprint,
      content: {
        kind: "note",
        title: "霧の港",
        body: "A quiet quay with a signal tower.",
        source: "The tide stairs flood at moonrise.",
        tags: ["coast", "secret"],
        links: [],
      },
    }),
  );
  expect(container.textContent).toContain("Record saved.");
});

it("preserves unsaved edits and reports stale-save failures", async () => {
  await render();
  await change("note-title", "Unpublished note");
  execute.mockResolvedValueOnce({
    ok: false,
    error: {
      code: "REFERENCE_STALE",
      message: "The note changed elsewhere.",
    },
  });
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "New")!
      .click(),
  );
  expect(field("note-title").value).toBe("Unpublished note");

  execute.mockResolvedValueOnce({
    ok: false,
    error: {
      code: "REFERENCE_STALE",
      message: "The note changed elsewhere.",
    },
  });
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("The note changed elsewhere.");
  expect(container.textContent).toContain("Unsaved changes");
});

it("soft-deletes notes with explicit confirmation and uses restricted IPC", async () => {
  await render();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Delete")!
      .click(),
  );
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "delete",
      kind: "note",
      id: noteId,
      expectedFingerprint: fingerprint,
    }),
  );
  expect(container.textContent).toContain("Record deleted.");
  await click("Restore research note");
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "restore",
      expectedRevision: 2,
      expectedFingerprint: "b".repeat(64),
    }),
  );
  expect(container.textContent).toContain("Record restored.");
});

async function click(text: string) {
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === text)!
      .click(),
  );
}

it("validates drafts without IPC and blocks unload until explicitly discarded", async () => {
  await render();
  await change("note-title", " ");
  const calls = execute.mock.calls.length;
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenCalledTimes(calls);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Check the fields",
  );
  const unload = new Event("beforeunload", { cancelable: true });
  await act(async () => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(true);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await click("Discard changes");
  expect(field("note-title").value).toBe(note.title);
});

it("autosaves after 750ms and retains edits typed during the save", async () => {
  vi.useFakeTimers();
  await render();
  let resolve!: (value: Awaited<ReturnType<typeof execute>>) => void;
  execute.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await change("note-title", "First draft");
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(container.textContent).toContain("Saving…");
  await change("note-title", "Later draft");
  await act(async () =>
    resolve({
      ok: true,
      value: {
        type: "record",
        value: {
          record: { ...note, title: "First draft", revision: 2 },
          fingerprint: "b".repeat(64),
        },
      },
    }),
  );
  expect(field("note-title").value).toBe("Later draft");
  expect(container.textContent).toContain("Unsaved changes");
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "update",
      expectedRevision: 2,
      content: expect.objectContaining({ title: "Later draft" }),
      generation: 2,
    }),
  );
  vi.useRealTimers();
});

it("preserves whitespace, combining Unicode, comma/newline tags and existing links", async () => {
  const links = [
    {
      id: "00000000-0000-4000-8000-000000000203",
      target: { kind: "chapter" as const, id: noteId },
    },
  ];
  const implementation = execute.getMockImplementation()!;
  execute.mockImplementation(async (request) =>
    request.operation === "read"
      ? {
          ok: true,
          value: {
            type: "record",
            value: {
              record: { ...note, links, tags: ["a,b\nc"] },
              fingerprint,
            },
          },
        }
      : implementation(request),
  );
  await render();
  await change("note-source", "  e\u0301 港 🌊\n ");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        source: "  e\u0301 港 🌊\n ",
        links,
        tags: ["a,b\nc"],
      }),
    }),
  );
});

it("keeps failed writes dirty and allows retry without losing content", async () => {
  const handle = createRef<CanonResearchEditorHandle>();
  await act(async () =>
    root.render(
      createElement(CanonResearchManager, {
        projectId,
        kind: "note",
        ref: handle,
      }),
    ),
  );
  await change("note-source", "Keep this draft");
  execute.mockRejectedValueOnce(
    new Error("private detail should not be displayed"),
  );
  let saved: boolean | undefined;
  await act(async () => {
    saved = await handle.current!.flush();
  });
  expect(saved).toBe(false);
  expect(handle.current!.isDirty()).toBe(true);
  expect(container.textContent).not.toContain("private detail");
  expect(field("note-source").value).toBe("Keep this draft");
  await act(async () => {
    saved = await handle.current!.flush();
  });
  expect(saved).toBe(true);
  expect(handle.current!.isDirty()).toBe(false);
});

it("creates a new record, focuses New, and permits leaving creation mode", async () => {
  await render();
  await click("New");
  expect(document.activeElement).toBe(field("note-title"));
  expect(
    container.querySelector<HTMLSelectElement>("#note-record")!.disabled,
  ).toBe(false);
  await change("note-title", "New place");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "create",
      content: expect.objectContaining({ title: "New place" }),
    }),
  );
});

it("reports read-only diagnostics and rejected loading without enabling writes", async () => {
  execute.mockRejectedValueOnce(new Error("private path"));
  await render();
  expect(container.textContent).toContain("Unable to load references");
  expect(field("note-title").matches(":disabled")).toBe(true);
  execute.mockResolvedValueOnce({
    ok: true,
    value: {
      type: "list",
      records: [],
      readOnly: true,
      diagnostics: [{ code: "REFERENCE_UNSUPPORTED" }],
    },
  });
  await click("Retry loading");
  expect(container.textContent).toContain("Some story bible files need review");
  expect(field("note-title").matches(":disabled")).toBe(true);
});

it("shows an empty store and retains the draft on rejected deletion", async () => {
  execute.mockResolvedValueOnce({
    ok: true,
    value: { type: "list", records: [], diagnostics: [], readOnly: false },
  });
  await render();
  expect(container.textContent).toContain("No records yet");
  await change("note-title", "Created place");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({ operation: "create" }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  execute.mockRejectedValueOnce(new Error("private path"));
  await click("Delete");
  expect(container.textContent).toContain("Unable to change the reference");
  expect(field("note-title").value).toBe("Created place");
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Delete",
    )!.disabled,
  ).toBe(false);
});

it("keeps recovery candidates read-only before editing", async () => {
  const implementation = execute.getMockImplementation()!;
  execute.mockImplementation(async (request) =>
    request.operation === "recovery-list"
      ? {
          ok: true,
          value: {
            type: "recovery",
            candidates: [],
            diagnostics: [{ code: "REFERENCE_RECOVERY_REQUIRED" }],
          },
        }
      : implementation(request),
  );
  await render();
  expect(container.textContent).toContain("recovery needs review");
  expect(field("note-title").matches(":disabled")).toBe(true);
});

it("permits shutdown while an initial read-only list is still loading", async () => {
  const handle = createRef<CanonResearchEditorHandle>();
  execute.mockImplementationOnce(() => new Promise(() => undefined));
  await act(async () =>
    root.render(
      createElement(CanonResearchManager, {
        projectId,
        kind: "note",
        ref: handle,
      }),
    ),
  );
  expect(container.textContent).toContain("Loading references");
  expect(handle.current!.isDirty()).toBe(false);
  await expect(handle.current!.flush()).resolves.toBe(true);
});

const categories = [
  "character",
  "technology",
  "location",
  "history",
  "relationship",
  "terminology",
  "other",
] as const;
it.each(categories)(
  "creates and edits canon category %s with inert text and labelled controls",
  async (category) => {
    const implementation = execute.getMockImplementation()!;
    execute.mockImplementation(async (request) => {
      if (request.operation === "create" || request.operation === "update") {
        if (request.content.kind !== "canon") throw new Error("Wrong kind");
        const { body: _body, source: _source, ...envelope } = note;
        void _body;
        void _source;
        return {
          ok: true,
          value: {
            type: "record",
            value: {
              record: {
                ...envelope,
                ...request.content,
                links: [],
                revision: request.operation === "create" ? 1 : 2,
              },
              fingerprint,
            },
          },
        };
      }
      return implementation(request);
    });
    await act(async () =>
      root.render(
        createElement(CanonResearchManager, { projectId, kind: "canon" }),
      ),
    );
    const select =
      container.querySelector<HTMLSelectElement>("#canon-category")!;
    expect(Array.from(select.options, (option) => option.value)).toEqual(
      categories,
    );
    await change("canon-title", "<img src=x onerror=alert(1)>");
    await act(async () => {
      select.value = category;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await change("canon-statement", "  A rule.\n e\u0301 🌊");
    await change("canon-notes", "<script>private()</script>");
    await click("Add tag");
    await change("canon-tag-0", "a,b\nc");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "create",
        content: {
          kind: "canon",
          title: "<img src=x onerror=alert(1)>",
          category,
          statement: "  A rule.\n e\u0301 🌊",
          notes: "<script>private()</script>",
          tags: ["a,b\nc"],
          links: [],
        },
      }),
    );
    expect(container.querySelector("img, script")).toBeNull();
    for (const control of Array.from(
      container.querySelectorAll("input, select, textarea"),
    )) {
      expect(
        container.querySelector(`label[for="${control.id}"]`),
      ).not.toBeNull();
    }
    await change("canon-statement", "Changed rule");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "update",
        expectedRevision: 1,
        expectedFingerprint: fingerprint,
        content: expect.objectContaining({
          statement: "Changed rule",
          category,
        }),
      }),
    );
  },
);
it.each([
  ["note-body", "bad\0text"],
  ["note-source", "x".repeat(2001)],
  ["note-body", "x".repeat(100001)],
  ["note-title", "\ud800"],
  ["note-tag-1", "coast"],
])("rejects malformed %s and retains it without IPC", async (id, value) => {
  await render();
  await change(id, value);
  const calls = execute.mock.calls.length;
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenCalledTimes(calls);
  expect(field(id).value).toBe(value);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
