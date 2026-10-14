// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrelwickApi, ReferenceRecord } from "@drelwick/shared";
import { LocationManager } from "../src/renderer/LocationManager.js";

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
          record: { ...location, revision: location.revision + 1 },
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
  await change("location-tags", "coast, secret");
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
  vi.spyOn(window, "confirm").mockReturnValue(false);
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
});
