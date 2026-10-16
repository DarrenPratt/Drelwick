// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrelwickApi, ReferenceRecord } from "@drelwick/shared";
import {
  LocationManager,
  type LocationEditorHandle,
} from "../src/renderer/LocationManager.js";

const projectId = "00000000-0000-4000-8000-000000000201";
const locationId = "00000000-0000-4000-8000-000000000202";
const fingerprint = "a".repeat(64);
const location: Extract<ReferenceRecord, { kind: "location" }> = {
  schemaVersion: 1,
  kind: "location",
  id: locationId,
  projectId,
  created: "2026-10-14T10:00:00.000Z",
  modified: "2026-10-14T10:00:00.000Z",
  revision: 1,
  deletedAt: null,
  name: "港町",
  type: "Harbour",
  description: "A sheltered port with a stone lighthouse.",
  notes: "Important features: tide stairs and an old bell.",
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
              id: location.id,
              kind: "location",
              title: location.name,
              revision: location.revision,
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
        value: { type: "record", value: { record: location, fingerprint } },
      };
    return {
      ok: true,
      value: {
        type: "record",
        value: {
          record: {
            ...location,
            ...("content" in request ? request.content : {}),
            kind: "location",
            revision: location.revision + 1,
            deletedAt:
              request.operation === "delete"
                ? "2026-10-14T11:00:00.000Z"
                : null,
          } as typeof location,
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
    root.render(createElement(LocationManager, { projectId }));
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

it("loads, edits and persists all approved location fields including Unicode", async () => {
  await render();
  expect(field("location-name").value).toBe("港町");
  await change("location-name", "霧の港");
  await change("location-type", "Hidden harbour");
  await change("location-description", "A quiet quay with a signal tower.");
  await change("location-notes", "The tide stairs flood at moonrise.");
  await change("location-tag-1", "secret");
  await act(async () => container.querySelector("form")!.requestSubmit());

  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "update",
      expectedRevision: 1,
      expectedFingerprint: fingerprint,
      content: {
        kind: "location",
        name: "霧の港",
        type: "Hidden harbour",
        description: "A quiet quay with a signal tower.",
        notes: "The tide stairs flood at moonrise.",
        tags: ["coast", "secret"],
        links: [],
      },
    }),
  );
  expect(container.textContent).toContain("Location saved.");
});

it("preserves unsaved edits and reports stale-save failures", async () => {
  await render();
  await change("location-name", "Unpublished location");
  execute.mockResolvedValueOnce({
    ok: false,
    error: {
      code: "REFERENCE_STALE",
      message: "The location changed elsewhere.",
    },
  });
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "New")!
      .click(),
  );
  expect(field("location-name").value).toBe("Unpublished location");

  execute.mockResolvedValueOnce({
    ok: false,
    error: {
      code: "REFERENCE_STALE",
      message: "The location changed elsewhere.",
    },
  });
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("The location changed elsewhere.");
  expect(container.textContent).toContain("Unsaved changes");
});

it("soft-deletes locations with explicit confirmation and uses restricted IPC", async () => {
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
      kind: "location",
      id: locationId,
      expectedFingerprint: fingerprint,
    }),
  );
  expect(container.textContent).toContain("Location deleted.");
  await click("Restore location");
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "restore",
      expectedRevision: 2,
      expectedFingerprint: "b".repeat(64),
    }),
  );
  expect(container.textContent).toContain("Location restored.");
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
  await change("location-name", " ");
  const calls = execute.mock.calls.length;
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenCalledTimes(calls);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Check the location fields",
  );
  const unload = new Event("beforeunload", { cancelable: true });
  await act(async () => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(true);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await click("Discard changes");
  expect(field("location-name").value).toBe(location.name);
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
  await change("location-name", "First draft");
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(container.textContent).toContain("Saving…");
  await change("location-name", "Later draft");
  await act(async () =>
    resolve({
      ok: true,
      value: {
        type: "record",
        value: {
          record: { ...location, name: "First draft", revision: 2 },
          fingerprint: "b".repeat(64),
        },
      },
    }),
  );
  expect(field("location-name").value).toBe("Later draft");
  expect(container.textContent).toContain("Unsaved changes");
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "update",
      expectedRevision: 2,
      content: expect.objectContaining({ name: "Later draft" }),
      generation: 2,
    }),
  );
  vi.useRealTimers();
});

it("preserves whitespace, combining Unicode, comma/newline tags and existing links", async () => {
  const links = [
    {
      id: "00000000-0000-4000-8000-000000000203",
      target: { kind: "chapter" as const, id: locationId },
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
              record: { ...location, links, tags: ["a,b\nc"] },
              fingerprint,
            },
          },
        }
      : implementation(request),
  );
  await render();
  await change("location-notes", "  e\u0301 港 🌊\n ");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        notes: "  e\u0301 港 🌊\n ",
        links,
        tags: ["a,b\nc"],
      }),
    }),
  );
});

it("keeps failed writes dirty and allows retry without losing content", async () => {
  const handle = createRef<LocationEditorHandle>();
  await act(async () =>
    root.render(createElement(LocationManager, { projectId, ref: handle })),
  );
  await change("location-notes", "Keep this draft");
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
  expect(field("location-notes").value).toBe("Keep this draft");
  await act(async () => {
    saved = await handle.current!.flush();
  });
  expect(saved).toBe(true);
  expect(handle.current!.isDirty()).toBe(false);
});

it("creates a new record, focuses New, and permits leaving creation mode", async () => {
  await render();
  await click("New");
  expect(document.activeElement).toBe(field("location-name"));
  expect(
    container.querySelector<HTMLSelectElement>("#location-record")!.disabled,
  ).toBe(false);
  await change("location-name", "New place");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "create",
      content: expect.objectContaining({ name: "New place" }),
    }),
  );
});

it("reports read-only diagnostics and rejected loading without enabling writes", async () => {
  execute.mockRejectedValueOnce(new Error("private path"));
  await render();
  expect(container.textContent).toContain("Unable to load locations");
  expect(field("location-name").matches(":disabled")).toBe(true);
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
  expect(field("location-name").matches(":disabled")).toBe(true);
});

it("shows an empty store and retains the draft on rejected deletion", async () => {
  execute.mockResolvedValueOnce({
    ok: true,
    value: { type: "list", records: [], diagnostics: [], readOnly: false },
  });
  await render();
  expect(container.textContent).toContain("No locations yet");
  await change("location-name", "Created place");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({ operation: "create" }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  execute.mockRejectedValueOnce(new Error("private path"));
  await click("Delete");
  expect(container.textContent).toContain("Unable to change the location");
  expect(field("location-name").value).toBe("Created place");
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
  expect(field("location-name").matches(":disabled")).toBe(true);
});

it("permits shutdown while an initial read-only list is still loading", async () => {
  const handle = createRef<LocationEditorHandle>();
  execute.mockImplementationOnce(() => new Promise(() => undefined));
  await act(async () =>
    root.render(createElement(LocationManager, { projectId, ref: handle })),
  );
  expect(container.textContent).toContain("Loading locations");
  expect(handle.current!.isDirty()).toBe(false);
  await expect(handle.current!.flush()).resolves.toBe(true);
});
