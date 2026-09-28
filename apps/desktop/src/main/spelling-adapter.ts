import { Worker } from "node:worker_threads";
import type { SpellingAdapter } from "@drelwick/core";
import type { SpellingWorkerRequest } from "./spelling-worker.js";

/** CPU-heavy suggestions run outside the main/UI thread with a bounded lifetime. */
export class BundledSpellingAdapter implements SpellingAdapter {
  private worker: Worker | undefined;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  dispose(): void {
    const worker = this.worker;
    this.worker = undefined;
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject();
    }
    this.pending.clear();
    if (worker) void worker.terminate();
  }

  private request<T>(
    operation: SpellingWorkerRequest["operation"],
    language: string,
    words: string[] = [],
  ): Promise<T> {
    if (!this.worker) {
      const worker = new Worker(
        new URL("./spelling-worker.js", import.meta.url),
      );
      this.worker = worker;
      worker.on(
        "message",
        (reply: { id: number; ok: boolean; value: unknown }) => {
          const task = this.pending.get(reply.id);
          if (!task) return;
          clearTimeout(task.timer);
          this.pending.delete(reply.id);
          if (reply.ok) task.resolve(reply.value);
          else task.reject();
        },
      );
      worker.on("error", () => {
        if (this.worker === worker) this.dispose();
      });
      worker.on("exit", () => {
        if (this.worker === worker) this.dispose();
      });
      worker.unref();
    }
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject: () =>
          reject(
            new Error(
              "Local spelling resources are unavailable. Editing remains available.",
            ),
          ),
        timer: setTimeout(() => this.dispose(), 5000),
      });
      this.worker!.postMessage({
        id,
        operation,
        language,
        words,
      } satisfies SpellingWorkerRequest);
    });
  }

  async available(language: string): Promise<boolean> {
    try {
      return await this.request<boolean>("available", language);
    } catch {
      return false;
    }
  }
  check(language: string, words: string[]): Promise<boolean[]> {
    return this.request("check", language, words);
  }
  suggest(language: string, word: string): Promise<string[]> {
    return this.request("suggest", language, [word]);
  }
}
