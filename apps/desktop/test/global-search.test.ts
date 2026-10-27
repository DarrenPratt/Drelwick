// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  DrelwickApi,
  GlobalSearchEntry,
  GlobalSearchSnapshot,
} from "@drelwick/shared";
import {
  GlobalSearch,
  type GlobalSearchHandle,
} from "../src/renderer/GlobalSearch.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const reference: GlobalSearchEntry = {
  kind: "note",
  id: "00000000-0000-4000-8000-000000000002",
  title: "Research",
  fingerprint: "a".repeat(64),
  fields: [{ name: "body", text: "needle <script>private</script>" }],
};
const chapter: GlobalSearchEntry = {
  kind: "chapter",
  id: "00000000-0000-4000-8000-000000000003",
  title: "Chapter",
  fingerprint: "b".repeat(64),
  fields: [{ name: "text · passage 1", text: "needle chapter", from: 1 }],
};
const execute = vi.fn<DrelwickApi["references"]["execute"]>();
const flush = vi.fn<() => Promise<boolean>>();
const navigate = vi.fn();
const handle = createRef<GlobalSearchHandle>();
let snapshot: GlobalSearchSnapshot;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  snapshot = { entries: [chapter, reference], incomplete: false };
  execute.mockReset().mockImplementation(async (request) => {
    if (request.operation === "search-snapshot")
      return { ok: true, value: { type: "search-snapshot", snapshot } };
    if (request.operation === "search-resolve")
      return {
        ok: true,
        value: {
          type: "search-entry",
          entry: request.target.kind === "chapter" ? chapter : reference,
        },
      };
    throw new Error("Unexpected request");
  });
  flush.mockReset().mockResolvedValue(true);
  navigate.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(sourceVersion = "0", disabled = false) {
  await act(async () =>
    root.render(
      createElement(GlobalSearch, {
        ref: handle,
        projectId,
        sourceVersion,
        disabled,
        execute,
        flush,
        navigate,
      }),
    ),
  );
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent === text,
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function tick(ms = 500) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function query(text: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const hits = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("ol button"));
async function start() {
  await render();
  await click("Search project");
  await tick();
  await query("needle");
  await tick();
}

it("flushes first, exposes loading/empty/results, renders inert context and keyboard-navigable record detail", async () => {
  await render();
  await click("Search project");
  expect(container.textContent).toContain("Saving edits and loading");
  await tick();
  expect(container.textContent).toContain("Enter text");
  expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
    execute.mock.invocationCallOrder[0]!,
  );
  await query("absent");
  await tick();
  expect(container.textContent).toContain("No matching results");
  await query("needle");
  await tick();
  expect(hits()).toHaveLength(2);
  expect(container.querySelector("script")).toBeNull();
  const input = container.querySelector("input")!;
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(hits()[0]);
  await act(async () =>
    hits()[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(hits()[1]);
  await act(async () => hits()[1]!.click());
  await tick();
  expect(document.activeElement?.textContent).toBe("Research");
  expect(container.textContent).toContain("Read-only saved record");
  expect(container.querySelector("script")).toBeNull();
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await tick();
  expect(document.activeElement).toBe(button("Search project"));
});

it("filters types, navigates validated chapter ranges and preserves ordinary find behaviour", async () => {
  await start();
  await act(async () => hits()[0]!.click());
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ id: chapter.id, from: 1, to: 7 }),
    chapter,
  );
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "note";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(hits()).toHaveLength(0);
  await tick();
  expect(hits()).toHaveLength(1);
  expect(hits()[0]?.textContent).toContain("Research");
});

it("retains drafts on failed flush and refuses stale/deleted targets", async () => {
  flush.mockResolvedValue(false);
  await start();
  expect(execute).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Your drafts remain open");
  flush.mockResolvedValue(true);
  await click("Refresh search");
  await tick();
  await tick();
  expect(hits()).toHaveLength(2);
  flush.mockResolvedValue(false);
  await act(async () => hits()[0]!.click());
  expect(navigate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Navigation cancelled");
  flush.mockResolvedValue(true);
  await click("Refresh search");
  await tick();
  await tick();
  execute.mockResolvedValueOnce({
    ok: false,
    error: { code: "REFERENCE_STALE", message: "Unavailable" },
  });
  await act(async () => hits()[0]!.click());
  expect(navigate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("result changed");
});

it("invalidates on edits and saved changes, rebuilding without overwriting editor state", async () => {
  await start();
  expect(hits()).toHaveLength(2);
  await act(async () => handle.current?.invalidate());
  expect(hits()).toHaveLength(0);
  snapshot = { entries: [], incomplete: false };
  await render("1");
  await tick();
  await tick();
  expect(container.textContent).toContain("No matching results");
  expect(
    execute.mock.calls.filter(
      ([request]) => request.operation === "search-snapshot",
    ),
  ).toHaveLength(2);
  expect(
    execute.mock.calls.every(([request]) =>
      ["search-snapshot", "search-resolve"].includes(request.operation),
    ),
  ).toBe(true);
});

it("suppresses rapid queries, cancelled work and late source responses", async () => {
  await start();
  await query("absent");
  await query("needle");
  await query("private");
  await tick();
  expect(hits()).toHaveLength(1);
  expect(hits()[0]?.textContent).toContain("Research");
  await click("Cancel search");
  await tick();
  expect(hits()).toHaveLength(0);
  expect(container.textContent).toContain("Search cancelled");
  let release!: (
    value: Awaited<ReturnType<DrelwickApi["references"]["execute"]>>,
  ) => void;
  execute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await click("Refresh search");
  await tick();
  await click("Cancel search");
  await act(async () =>
    release({ ok: true, value: { type: "search-snapshot", snapshot } }),
  );
  await tick();
  expect(hits()).toHaveLength(0);
});

it("surfaces incomplete indexes and errors, and rebuilds when closed/reopened", async () => {
  snapshot.incomplete = true;
  await start();
  expect(container.textContent).toContain("Search is incomplete");
  await click("Close search");
  execute.mockRejectedValueOnce(new Error("private payload must not render"));
  await click("Search project");
  await tick();
  expect(container.textContent).toContain("Unable to read search sources");
  expect(container.textContent).not.toContain("private payload");
  expect(
    execute.mock.calls.filter(
      ([request]) => request.operation === "search-snapshot",
    ),
  ).toHaveLength(2);
});
