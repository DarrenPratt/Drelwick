// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  DrelwickApi,
  ReferenceRecord,
  ReferenceEdge,
} from "@drelwick/shared";
import {
  ChapterReferences,
  type ChapterReferencesHandle,
} from "../src/renderer/ChapterReferences.js";
const projectId = "00000000-0000-4000-8000-000000000001";
const chapterId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const referenceId = "00000000-0000-4000-8000-000000000004";
const linkId = "00000000-0000-4000-8000-000000000005";
let record: ReferenceRecord;
let edgeStatus: ReferenceEdge["status"];
const execute = vi.fn<DrelwickApi["references"]["execute"]>();
const flush = vi.fn<() => Promise<boolean>>();
const navigate = vi.fn<(id: string) => Promise<void>>();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  record = {
    schemaVersion: 1,
    id: referenceId,
    projectId,
    kind: "note",
    title: "Private research",
    body: "<script>inert</script>",
    tags: [],
    links: [{ id: linkId, target: { kind: "chapter", id: otherId } }],
    revision: 1,
    created: "2026-10-17T10:00:00.000Z",
    modified: "2026-10-17T10:00:00.000Z",
    deletedAt: null,
  };
  edgeStatus = "resolved";
  flush.mockReset().mockResolvedValue(true);
  navigate.mockReset().mockResolvedValue();
  execute.mockReset().mockImplementation(async (request) => {
    if (request.operation === "list")
      return {
        ok: true,
        value: {
          type: "list",
          records: [
            {
              id: record.id,
              kind: record.kind,
              title: "Private research",
              revision: record.revision,
              deletedAt: record.deletedAt,
            },
          ],
          diagnostics: [],
          readOnly: false,
        },
      };
    if (request.operation === "links") {
      const edges = record.links.map((link) => ({
        sourceId: referenceId,
        sourceKind: record.kind,
        link,
        status: edgeStatus,
      }));
      return {
        ok: true,
        value: {
          type: "links",
          incoming: edges.filter(
            (edge) => edge.link.target.id === request.target.id,
          ),
          outgoing: request.target.id === referenceId ? edges : [],
          diagnostics: [],
        },
      };
    }
    if (request.operation === "link-attach")
      record = {
        ...record,
        revision: record.revision + 1,
        links: [
          ...record.links,
          {
            id: "00000000-0000-4000-8000-000000000006",
            target: { kind: "chapter", id: request.chapterId },
          },
        ],
      };
    if (request.operation === "link-remove")
      record = {
        ...record,
        revision: record.revision + 1,
        links: record.links.filter((link) => link.id !== request.linkId),
      };
    if (request.operation === "link-retarget")
      record = {
        ...record,
        revision: record.revision + 1,
        links: record.links.map((link) =>
          link.id === request.linkId
            ? { ...link, target: { kind: "chapter", id: request.chapterId } }
            : link,
        ),
      };
    return {
      ok: true,
      value: { type: "record", value: { record, fingerprint: "a".repeat(64) } },
    };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      createElement(ChapterReferences, {
        projectId,
        chapterId,
        chapters: [
          { id: chapterId, title: "Current" },
          { id: otherId, title: "Other" },
        ],
        execute,
        disabled: false,
        flush,
        navigate,
      }),
    ),
  );
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function open() {
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = referenceId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("View reference and linked chapters");
}
it("uses the validated IPC for attach/remove and derives both views with inert content and keyboard focus", async () => {
  await render();
  await open();
  expect(document.activeElement?.textContent).toBe("Private research");
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain("Other - resolved");
  await click("Attach current chapter");
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "link-attach",
      chapterId,
      expectedRevision: 1,
      expectedFingerprint: "a".repeat(64),
    }),
  );
  expect(button("Open Private research")).toBeDefined();
  expect(button("Attach current chapter").disabled).toBe(true);
  await click("Remove chapter link");
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "link-remove", linkId }),
  );
  await click("Back to chapter links");
  expect(document.activeElement).toBe(container.querySelector("select"));
});
it("blocks both navigation directions on failed dirty-editor flush and permits retry", async () => {
  await render();
  flush.mockResolvedValue(false);
  await open();
  expect(
    container.querySelector('[aria-label="Linked reference details"]'),
  ).toBeNull();
  expect(container.textContent).toContain("Your current edits remain open");
  flush.mockResolvedValue(true);
  await open();
  flush.mockResolvedValue(false);
  await click("Open chapter Other");
  expect(navigate).not.toHaveBeenCalled();
  flush.mockResolvedValue(true);
  await click("Open chapter Other");
  expect(navigate).toHaveBeenCalledWith(otherId);
});
it.each(["missing", "invalid", "unsupported"] as const)(
  "keeps %s links visible and allows explicit retargeting",
  async (status) => {
    edgeStatus = status;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render();
    await open();
    expect(container.textContent).toContain(`Other - ${status}`);
    expect(button("Open chapter Other").disabled).toBe(true);
    await click("Retarget to current chapter");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "link-retarget",
        linkId,
        chapterId,
      }),
    );
  },
);
it("shows deleted references and retained chapter links without enabling mutations", async () => {
  record.deletedAt = record.modified;
  record.links[0]!.target.id = chapterId;
  await render();
  expect(container.textContent).toContain("deleted reference (link retained)");
  await click("Open Private research");
  expect(button("Remove chapter link").disabled).toBe(true);
});
it("retains the visible link on a failed metadata write and reports the failure", async () => {
  await render();
  await open();
  execute.mockResolvedValueOnce({
    ok: false,
    error: { code: "REFERENCE_FAILED", message: "Saved data preserved." },
  });
  await click("Remove chapter link");
  expect(container.textContent).toContain("Saved data preserved.");
  expect(container.textContent).toContain("Other - resolved");
});

it("reports in-flight link work to the shutdown guard", async () => {
  const ref = createRef<ChapterReferencesHandle>();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = execute.getMockImplementation()!;
  execute.mockImplementation(async (request) => {
    await blocked;
    return original(request);
  });
  await act(async () =>
    root.render(
      createElement(ChapterReferences, {
        ref,
        projectId,
        chapterId,
        chapters: [],
        execute,
        disabled: false,
        flush,
        navigate,
      }),
    ),
  );
  expect(ref.current?.isBusy()).toBe(true);
  await act(async () => release());
  expect(ref.current?.isBusy()).toBe(false);
});
