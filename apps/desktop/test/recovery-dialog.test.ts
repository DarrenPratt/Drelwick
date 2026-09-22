// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { SarelApi } from "@sarel/shared";
import { RecoveryStartup } from "../src/renderer/RecoveryStartup.js";
const candidate = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  chapterId: "chapter",
  title: "Chapter One",
  projectPath: "/books/book",
  created: "2026-09-18T16:05:00.000Z",
  source: "temporary" as const,
};
const list = vi.fn<SarelApi["recovery"]["list"]>();
const recover = vi.fn<SarelApi["recovery"]["recover"]>();
const discard = vi.fn<SarelApi["recovery"]["discard"]>();
const cancel = vi.fn<SarelApi["recovery"]["cancel"]>();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sarel", {
    onShutdownRequested: () => () => {},
    recovery: { list, recover, discard, cancel },
  });
  list.mockReset().mockResolvedValue({ ok: true, value: [candidate] });
  recover.mockReset().mockResolvedValue({ ok: true, value: [] });
  discard.mockReset().mockResolvedValue({ ok: true, value: [] });
  cancel.mockReset().mockResolvedValue({ ok: true, value: null });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
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
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(RecoveryStartup, {
          children: createElement("div", null, "Editor ready"),
        }),
      ),
    ),
  );
}
function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  )!;
}
it.each(["Recover", "Discard"])(
  "gates the editor until explicit %s succeeds",
  async (label) => {
    await render();
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(container.textContent).toContain("Chapter One");
    expect(container.textContent).not.toContain("Editor ready");
    expect(recover).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    await act(async () => button(label).click());
    expect(
      label === "Recover" ? recover : discard,
    ).toHaveBeenCalledExactlyOnceWith(candidate.id);
    expect(container.textContent).toBe("Editor ready");
  },
);
it("cancel startup and Escape do not make a recovery decision", async () => {
  await render();
  await act(async () => button("Cancel startup").click());
  expect(cancel).toHaveBeenCalledOnce();
  const event = new Event("cancel", { cancelable: true });
  await act(async () =>
    container.querySelector("dialog")!.dispatchEvent(event),
  );
  expect(event.defaultPrevented).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(recover).not.toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Editor ready");
});
it("keeps candidates on failure and allows retry", async () => {
  recover.mockResolvedValueOnce({
    ok: false,
    error: { code: "FAILED", message: "Original preserved. Retry." },
  });
  await render();
  await act(async () => button("Recover").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Original preserved",
  );
  expect(container.textContent).toContain("Chapter One");
  await act(async () => button("Recover").click());
  expect(container.textContent).toBe("Editor ready");
});
it("keeps the editor blocked on scan failure but permits cancellation", async () => {
  list.mockRejectedValue(new Error("unavailable"));
  await render();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Editor ready");
  await act(async () => button("Cancel startup").click());
  expect(cancel).toHaveBeenCalledOnce();
});
it("disables decisions during persistence and waits for all candidates", async () => {
  let resolve!: (
    value: Awaited<ReturnType<SarelApi["recovery"]["recover"]>>,
  ) => void;
  recover.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () => {
    button("Recover").click();
  });
  expect(
    Array.from(container.querySelectorAll("button")).every(
      (item) => item.disabled,
    ),
  ).toBe(true);
  await act(async () =>
    resolve({ ok: true, value: [{ ...candidate, id: "second" }] }),
  );
  expect(container.textContent).not.toContain("Editor ready");
  await act(async () => button("Discard").click());
  expect(discard).toHaveBeenCalledWith("second");
  expect(container.textContent).toBe("Editor ready");
});
it("shows post-commit warnings before continuing", async () => {
  recover.mockResolvedValueOnce({
    ok: true,
    value: [],
    warning: "Inspect the operation lock.",
  });
  await render();
  await act(async () => button("Recover").click());
  expect(container.textContent).toContain("Inspect the operation lock.");
  expect(container.textContent).not.toContain("Editor ready");
  await act(async () => button("Continue").click());
  expect(container.textContent).toBe("Editor ready");
});
it("starts the editor directly when no candidates exist", async () => {
  list.mockResolvedValue({ ok: true, value: [] });
  await render();
  expect(container.textContent).toBe("Editor ready");
});
