import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaveCoordinator } from "../src/autosave.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture() {
  let revision = 0;
  let savedRevision = 0;
  const write = vi
    .fn<(revision: number) => Promise<boolean>>()
    .mockResolvedValue(true);
  const coordinator = createAutosaveCoordinator({
    isDirty: () => revision !== savedRevision,
    save: async () => {
      const captured = revision;
      const success = await write(captured);
      if (success) savedRevision = captured;
      return success;
    },
  });
  const edit = () => {
    revision++;
    coordinator.edited();
  };
  return { coordinator, write, edit, dirty: () => revision !== savedRevision };
}

describe("autosave scheduling", () => {
  it("writes only after 750 ms idle and coalesces rapid edits", async () => {
    const { write, edit, dirty } = fixture();
    edit();
    await vi.advanceTimersByTimeAsync(749);
    expect(write).not.toHaveBeenCalled();
    edit();
    await vi.advanceTimersByTimeAsync(749);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledExactlyOnceWith(2);
    expect(dirty()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("serializes expired autosaves behind an in-flight write", async () => {
    const { write, edit, dirty } = fixture();
    let finish!: (value: boolean) => void;
    write.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    edit();
    await vi.advanceTimersByTimeAsync(750);
    edit();
    await vi.advanceTimersByTimeAsync(750);
    expect(write).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(write.mock.calls).toEqual([[1], [2]]);
    expect(dirty()).toBe(false);
  });

  it("keeps the latest idle deadline when more edits supersede an expired timer", async () => {
    const { write, edit } = fixture();
    let finish!: (value: boolean) => void;
    write.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    edit();
    await vi.advanceTimersByTimeAsync(750);
    edit();
    await vi.advanceTimersByTimeAsync(750);
    edit();
    finish(true);
    await vi.advanceTimersByTimeAsync(749);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(write.mock.calls).toEqual([[1], [3]]);
  });

  it("leaves newer edits dirty until their own idle deadline", async () => {
    const { write, edit, dirty } = fixture();
    let finish!: (value: boolean) => void;
    write.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    edit();
    await vi.advanceTimersByTimeAsync(750);
    edit();
    finish(true);
    await vi.advanceTimersByTimeAsync(749);
    expect(dirty()).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dirty()).toBe(false);
  });

  it("flushes immediately, drains newer edits and shares concurrent flush requests", async () => {
    const { coordinator, write, edit, dirty } = fixture();
    let finish!: (value: boolean) => void;
    write.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    edit();
    const first = coordinator.flush();
    await vi.advanceTimersByTimeAsync(0);
    edit();
    const second = coordinator.flush();
    expect(write).toHaveBeenCalledTimes(1);
    finish(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(write.mock.calls).toEqual([[1], [2]]);
    expect(dirty()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each([false, "reject"])(
    "retains failed edits without a retry loop (%s)",
    async (failure) => {
      const { coordinator, write, edit, dirty } = fixture();
      if (failure === "reject")
        write.mockRejectedValueOnce(new Error("failure"));
      else write.mockResolvedValueOnce(false);
      edit();
      expect(await coordinator.flush()).toBe(false);
      expect(dirty()).toBe(true);
      await vi.advanceTimersByTimeAsync(30000);
      expect(write).toHaveBeenCalledTimes(1);
      expect(await coordinator.flush()).toBe(true);
      expect(dirty()).toBe(false);
    },
  );

  it("retries after a new edit following a failed autosave", async () => {
    const { write, edit, dirty } = fixture();
    write.mockResolvedValueOnce(false);
    edit();
    await vi.advanceTimersByTimeAsync(750);
    expect(dirty()).toBe(true);
    edit();
    await vi.advanceTimersByTimeAsync(750);
    expect(write.mock.calls).toEqual([[1], [2]]);
    expect(dirty()).toBe(false);
  });

  it.each([100, 750])(
    "preserves a newer edit's autosave when an older write fails after %i ms",
    async (elapsed) => {
      const { write, edit, dirty } = fixture();
      let finish!: (value: boolean) => void;
      write.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      edit();
      await vi.advanceTimersByTimeAsync(750);
      edit();
      await vi.advanceTimersByTimeAsync(elapsed);
      finish(false);
      await vi.advanceTimersByTimeAsync(0);
      if (elapsed < 750) {
        expect(dirty()).toBe(true);
        expect(write).toHaveBeenCalledTimes(1);
      }
      await vi.advanceTimersByTimeAsync(750 - elapsed);
      expect(write.mock.calls).toEqual([[1], [2]]);
      expect(dirty()).toBe(false);
      await vi.advanceTimersByTimeAsync(30000);
      expect(write).toHaveBeenCalledTimes(2);
    },
  );

  it("does not save clean documents or disposed sessions", async () => {
    const { coordinator, write, edit } = fixture();
    expect(await coordinator.flush()).toBe(true);
    expect(write).not.toHaveBeenCalled();
    edit();
    coordinator.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    edit();
    expect(await coordinator.flush()).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("allows a started write to finish but cancels queued writes on disposal", async () => {
    const { coordinator, write, edit } = fixture();
    let finish!: (value: boolean) => void;
    write.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    edit();
    const flushed = coordinator.flush();
    await vi.advanceTimersByTimeAsync(0);
    edit();
    await vi.advanceTimersByTimeAsync(750);
    coordinator.dispose();
    finish(true);
    expect(await flushed).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
