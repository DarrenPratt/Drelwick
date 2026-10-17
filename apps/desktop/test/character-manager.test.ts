// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrelwickApi, ReferenceRecord } from "@drelwick/shared";
import { CharacterManager } from "../src/renderer/CharacterManager.js";

const projectId = "00000000-0000-4000-8000-000000000101";
const characterId = "00000000-0000-4000-8000-000000000102";
const fingerprint = "a".repeat(64);
const character: Extract<ReferenceRecord, { kind: "character" }> = {
  schemaVersion: 1,
  kind: "character",
  id: characterId,
  projectId,
  created: "2026-10-14T10:00:00.000Z",
  modified: "2026-10-14T10:00:00.000Z",
  revision: 1,
  deletedAt: null,
  name: "Mara Venn",
  aliases: ["Mara"],
  role: "Navigator",
  description: "A careful navigator.",
  appearance: "",
  personality: "",
  background: "",
  notes: "",
  tags: ["crew"],
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
              id: character.id,
              kind: "character",
              title: character.name,
              revision: character.revision,
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
        value: { type: "record", value: { record: character, fingerprint } },
      };
    return {
      ok: true,
      value: {
        type: "record",
        value: {
          record: { ...character, revision: character.revision + 1 },
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
    root.render(createElement(CharacterManager, { projectId }));
  });
}

function input(id: string) {
  return container.querySelector<HTMLInputElement>(`#${id}`)!;
}

async function change(id: string, value: string) {
  await act(async () => {
    const node = input(id);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("loads a character, saves edits, and exposes aliases and tags", async () => {
  await render();
  expect(input("character-name").value).toBe("Mara Venn");
  await change("character-name", "Mara Venn II");
  await change("character-aliases", "Mara, The Navigator");
  await change("character-tags", "crew, protagonist");
  await act(async () => container.querySelector("form")!.requestSubmit());

  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "update",
      expectedRevision: 1,
      expectedFingerprint: fingerprint,
      content: expect.objectContaining({
        name: "Mara Venn II",
        aliases: ["Mara", "The Navigator"],
        tags: ["crew", "protagonist"],
      }),
    }),
  );
  expect(container.textContent).toContain("Character saved.");
});

it("keeps unsaved edits when switching is cancelled and reports save failures", async () => {
  await render();
  await change("character-name", "Unpublished name");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "New")!
      .click();
  });
  expect(input("character-name").value).toBe("Unpublished name");

  execute.mockResolvedValueOnce({
    ok: false,
    error: {
      code: "REFERENCE_STALE",
      message: "The character changed elsewhere.",
    },
  });
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("The character changed elsewhere.");
  expect(container.textContent).toContain("Unsaved changes");
});

it("soft-deletes the selected character after explicit confirmation", async () => {
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
      id: characterId,
      expectedFingerprint: fingerprint,
    }),
  );
  expect(container.textContent).toContain("Character deleted.");
});

it("preserves chapter link identities when editing a character", async () => {
  const links = [
    {
      id: "00000000-0000-4000-8000-000000000107",
      target: {
        kind: "chapter" as const,
        id: "00000000-0000-4000-8000-000000000108",
      },
    },
  ];
  const original = execute.getMockImplementation()!;
  execute.mockImplementation(async (request) =>
    request.operation === "read"
      ? {
          ok: true,
          value: {
            type: "record",
            value: { record: { ...character, links }, fingerprint },
          },
        }
      : original(request),
  );
  await render();
  await change("character-name", "Renamed");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "update",
      content: expect.objectContaining({ links }),
    }),
  );
});
