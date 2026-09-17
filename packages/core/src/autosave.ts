export const AUTOSAVE_DELAY_MS = 750;

export interface AutosaveCoordinator {
  /** Reset the idle deadline after a document edit. */
  edited(): void;
  /** Save immediately and drain newer edits through the same serialized writer. */
  flush(): Promise<boolean>;
  /** Stop scheduling work; an already-started write is allowed to finish. */
  dispose(): void;
}

export interface AutosaveOptions {
  isDirty(): boolean;
  /** Capture/acknowledge a revision and report failures to the user in this adapter. */
  save(): Promise<boolean>;
}

/** Host-independent scheduling; this module must remain safe to import in a renderer. */
export function createAutosaveCoordinator(
  options: AutosaveOptions,
): AutosaveCoordinator {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<boolean> | undefined;
  let requested = false;
  let disposed = false;

  function cancelTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function run(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (running) return running;
    requested = false;
    cancelTimer();
    // Defer the adapter until `running` is assigned, including synchronous adapters.
    running = Promise.resolve()
      .then(() =>
        disposed ? false : !options.isDirty() ? true : options.save(),
      )
      .catch(() => {
        // The adapter owns error reporting. Never leave an unhandled timer rejection.
        return false;
      })
      .finally(() => {
        running = undefined;
        // Only a newer edit's expired deadline queues another write. Preserve it
        // even on failure; the failed revision itself never starts a retry loop.
        if (requested && !disposed) void run();
      });
    return running;
  }

  return {
    edited() {
      if (disposed) return;
      cancelTimer();
      // A more recent edit supersedes an expired deadline while a write is running.
      requested = false;
      timer = setTimeout(() => {
        timer = undefined;
        requested = true;
        void run();
      }, AUTOSAVE_DELAY_MS);
    },
    async flush() {
      do {
        cancelTimer();
        if (!(await run())) return false;
      } while (!disposed && options.isDirty());
      return !disposed;
    },
    dispose() {
      disposed = true;
      cancelTimer();
      requested = false;
    },
  };
}
