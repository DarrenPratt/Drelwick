// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultPrintSettings, type DrelwickApi } from "@drelwick/shared";
import { PrintSettingsDialog } from "../src/renderer/PrintSettingsDialog.js";
const save = vi.fn<DrelwickApi["project"]["savePrintConfiguration"]>();
const close = vi.fn();
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("drelwick", {
    onSaveRequested: () => () => {},
    project: { savePrintConfiguration: save },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  save.mockReset().mockImplementation(async (input) => ({
    ok: true,
    value: { settings: input.settings, revision: "b".repeat(64) },
  }));
  close.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(PrintSettingsDialog, {
        initial: { settings: defaultPrintSettings(), revision: "a".repeat(64) },
        projectId: "00000000-0000-4000-8000-000000000101",
        onClose: close,
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function field(label: string) {
  return Array.from(container.querySelectorAll("label"))
    .find((node) => node.textContent?.startsWith(label))!
    .querySelector("input,select") as HTMLInputElement | HTMLSelectElement;
}
async function change(label: string, value: string) {
  const node = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLSelectElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLInputElement ? "input" : "change", {
        bubbles: true,
      }),
    );
  });
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("loads defaults, changes units without drift, selects presets and saves all semantic options", async () => {
  expect(field("Trim width").value).toBe("6");
  for (let i = 0; i < 10; i++) {
    await change("Measurement units", "mm");
    await change("Measurement units", "in");
  }
  expect(field("Additional gutter").value).toBe("0.125");
  await change("Trim size", "a5");
  await change("Measurement units", "mm");
  expect(field("Trim width").value).toBe("148");
  await change("Chapter starts", "recto");
  await change("Left-hand page header", "chapter-title");
  await change("Page number position", "footer-outside");
  await change("Front matter numbering", "none");
  await submit();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: "a".repeat(64),
      settings: expect.objectContaining({
        unit: "mm",
        trim: { preset: "a5", width: 148000, height: 210000 },
        chapterStart: "recto",
        headers: expect.objectContaining({ verso: "chapter-title" }),
        pageNumbers: expect.objectContaining({
          position: "footer-outside",
          frontMatter: "none",
        }),
      }),
    }),
  );
  expect(container.textContent).toContain("Print settings saved.");
});
it("rejects empty/invalid dimensions and impossible margins without IPC, preserves the draft on save failure", async () => {
  await change("Trim size", "custom");
  for (const value of ["", "-1", "0", "Infinity", "NaN", "1e4", "500"]) {
    await change("Trim width", value);
    await submit();
    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  }
  await change("Trim width", "6.125");
  await change("Inside margin", "3.5");
  await change("Outside margin", "3.5");
  await submit();
  expect(container.textContent).toContain("content width");
  expect(save).not.toHaveBeenCalled();
  await change("Inside margin", "0.75");
  await change("Outside margin", "0.75");
  save.mockResolvedValueOnce({
    ok: false,
    error: { code: "FAILED", message: "Synthetic save failure" },
  });
  await submit();
  expect(container.textContent).toContain("Synthetic save failure");
  expect(field("Trim width").value).toBe("6.125");
  expect(container.textContent).toContain("Unsaved print settings");
  await submit();
  expect(save.mock.calls[1]?.[0].expectedRevision).toBe("a".repeat(64));
  expect(container.textContent).toContain("Print settings saved.");
});
it("requires explicit discard on Escape and keeps the draft when discard is refused", async () => {
  await change("Chapter starts", "recto");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () =>
    container
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true })),
  );
  expect(confirm).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await act(async () =>
    container
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true })),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

it("saves through the ordinary keyboard shortcut without propagating to manuscript save", async () => {
  await change("Chapter starts", "recto");
  const outer = vi.fn();
  window.addEventListener("keydown", outer);
  try {
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => field("Chapter starts").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("keydown", outer);
  }
});
