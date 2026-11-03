// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ManuscriptComparison } from "../src/renderer/ManuscriptComparison.js";
import type {
  ComparisonAction,
  ComparisonSourceToken,
  ComparisonV1,
  SnapshotSummary,
} from "@drelwick/shared";

const projectId = "00000000-0000-4000-8000-000000000001",
  snapshotId = "00000000-0000-4000-8000-000000000002";
const source: ComparisonSourceToken = {
  kind: "snapshot",
  id: snapshotId,
  projectId,
  generation: 3,
  inventoryHash: "a".repeat(64),
  manifestHash: "b".repeat(64),
  label: "Baseline",
  created: "2026-11-01T00:00:00.000Z",
  projection: "proposed",
};
const snapshot: SnapshotSummary = {
  snapshotId,
  manifestHash: source.manifestHash!,
  generation: 3,
  label: source.label,
  created: source.created,
  chapters: 1,
  bytes: 100,
  reason: "manual",
  deleted: false,
};
const result: ComparisonV1 = {
  schemaVersion: 1,
  algorithm: "semantic-grapheme-v1",
  left: source,
  right: {
    ...source,
    kind: "captured-current",
    label: "Saved current",
    generation: 4,
  },
  complete: true,
  diagnostics: [],
  chapters: [{ id: snapshotId, title: "Arrival" }],
  changes: [0, 1].map((ordinal) => ({
    ordinal,
    kind: "mark-change",
    chapterId: snapshotId,
    oldLocation: { nodePath: [0, 0], from: 1, to: 4 },
    newLocation: { nodePath: [0, 0], from: 1, to: 4 },
    before: {
      type: "slice",
      value: {
        content: [{ type: "text", text: "fox" }],
        openStart: 0,
        openEnd: 0,
      },
    },
    after: {
      type: "slice",
      value: {
        content: [{ type: "text", text: "fox", marks: [{ type: "bold" }] }],
        openStart: 0,
        openEnd: 0,
      },
    },
  })),
};
it("flushes current edits, labels versions, navigates read-only semantic changes, reports staleness and drops cancelled responses", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container),
    flush = vi.fn(async () => false);
  let resolveCompare: ((value: unknown) => void) | undefined;
  let delayed = false,
    stale = false;
  const api = vi.fn(async (action: ComparisonAction): Promise<unknown> => {
    if (action.operation === "capture")
      return {
        ok: true,
        value: {
          token: crypto.randomUUID(),
          source: {
            ...source,
            kind: action.source.kind,
            projection: action.source.projection,
          },
        },
      };
    if (action.operation === "compare")
      return delayed
        ? new Promise((resolve) => {
            resolveCompare = resolve;
          })
        : { ok: true, value: result };
    if (action.operation === "status") return { ok: true, value: { stale } };
    return { ok: true, value: null };
  });
  vi.stubGlobal("drelwick", { project: { comparison: api } });
  const button = (name: string) => {
    const node = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent === name,
    );
    if (!node) throw new Error(name);
    return node;
  };
  const wait = async (assertion: () => void) =>
    vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assertion();
    });
  try {
    await act(async () =>
      root.render(
        createElement(ManuscriptComparison, {
          projectId,
          snapshots: [snapshot],
          flush,
        }),
      ),
    );
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = snapshotId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Compare versions").click());
    expect(container.textContent).toContain("drafts were retained");
    expect(api).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "capture" }),
    );
    flush.mockResolvedValue(true);
    await act(async () => button("Compare versions").click());
    await wait(() =>
      expect(container.textContent).toContain(
        "2 changes. Comparison complete.",
      ),
    );
    expect(container.textContent).toContain("Baseline");
    expect(container.textContent).toContain("generation 4");
    expect(container.querySelector("article strong")?.textContent).toBe("fox");
    await act(async () => button("Next change").click());
    expect(container.querySelector("article h4")?.textContent).toBe(
      "2: mark-change",
    );
    expect(document.activeElement).toBe(container.querySelector("article"));
    expect(
      Array.from(container.querySelectorAll("button")).map(
        (node) => node.textContent,
      ),
    ).not.toContain("Apply change");
    stale = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await wait(() =>
      expect(container.textContent).toContain("comparison is stale"),
    );
    delayed = true;
    await act(async () => button("Compare versions").click());
    await wait(() => expect(resolveCompare).toBeDefined());
    await act(async () => button("Cancel comparison").click());
    await act(async () => resolveCompare!({ ok: true, value: result }));
    await wait(() => expect(button("Compare versions").disabled).toBe(false));
    expect(container.textContent).not.toContain("Comparison complete.");
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "cancel" }),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
