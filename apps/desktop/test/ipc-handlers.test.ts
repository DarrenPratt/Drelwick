import { beforeEach, describe, expect, it, vi } from "vitest";

const handle = vi.fn();

vi.mock("electron", () => ({
  ipcMain: { handle },
}));

describe("IPC handler registration", () => {
  beforeEach(() => {
    handle.mockReset();
  });

  it("validates payloads before dispatching handlers", async () => {
    const { registerIpcHandlers } =
      await import("../src/main/ipc/register-ipc-handlers.js");
    const handler = vi.fn(() => "created");

    registerIpcHandlers({
      "chapter:create": handler,
    });

    const registeredHandler = handle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => string;
    expect(registeredHandler({}, { title: "New chapter" })).toBe("created");
    expect(() => registeredHandler({}, { title: "" })).toThrow();
    expect(handler).toHaveBeenCalledOnce();
  });
});
