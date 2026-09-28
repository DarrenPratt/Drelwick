import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  workers: [] as {
    emit(name: string, ...args: unknown[]): boolean;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => 0);
    unref() {}
    constructor() {
      super();
      state.workers.push(this);
    }
  },
}));
import { BundledSpellingAdapter } from "../src/main/spelling-adapter.js";
afterEach(() => {
  vi.useRealTimers();
  state.workers.length = 0;
});

it("bounds a stalled worker, rejects pending work safely and starts a fresh worker on retry", async () => {
  vi.useFakeTimers();
  const adapter = new BundledSpellingAdapter();
  const available = adapter.available("en-US");
  const suggestion = expect(
    adapter.suggest("en-US", "privateword"),
  ).rejects.toThrow("Local spelling resources are unavailable");
  await vi.advanceTimersByTimeAsync(5000);
  expect(await available).toBe(false);
  await suggestion;
  expect(state.workers[0]!.terminate).toHaveBeenCalledOnce();
  const retry = adapter.available("en-US");
  const worker = state.workers[1]!;
  const [{ id }] = worker.postMessage.mock.calls[0] as [{ id: number }];
  worker.emit("message", { id, ok: true, value: true });
  expect(await retry).toBe(true);
  adapter.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["error", "exit"])(
  "handles worker %s without leaking manuscript input",
  async (event) => {
    const adapter = new BundledSpellingAdapter();
    const checked = expect(
      adapter.check("en-US", ["privateword"]),
    ).rejects.toThrow("Local spelling resources are unavailable");
    state.workers[0]!.emit(event, new Error("privateword"));
    await checked;
    expect(state.workers[0]!.terminate).toHaveBeenCalledOnce();
    adapter.dispose();
  },
);
