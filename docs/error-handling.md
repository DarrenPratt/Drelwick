# Global error handling

BookEditor handles unexpected failures at both Electron process boundaries so a
renderer exception does not leave a blank window and a fatal main-process error
does not end silently.

## Renderer boundary

The React root has a global `RendererErrorBoundary` covering startup and the
application. The authoring workspace also renders its view inside a boundary
owned below `App`. Because `App` retains the document reducer and its immediate
dirty-state reference, a child rendering failure replaces the failed view while
the current manuscript state remains mounted. **Try interface again** remounts
the failed subtree from that same state so the author can save the chapter.

The fallback never reloads, closes, saves, clears or replaces project data
automatically. It distinguishes preserved in-memory workspace edits from the
root fallback, which promises only that saved project files were not changed.

Renderer failures cross the restricted preload boundary as a validated error
name only. Error messages, stacks, component stacks, props, document payloads,
paths and manuscript text are neither sent through IPC nor written to the
structured application log.

## Main-process failures

The main process handles uncaught exceptions and unhandled promise rejections by
first writing the sanitized error classification through the application logger.
It then shows a native error message explaining that saved project files were
preserved and exits with a failure status. The session is not marked clean, so
the existing recovery scan runs at the next startup.

Only the first fatal process failure shows the dialog and starts exit. This
prevents repeated errors during shutdown from producing duplicate dialogs or
exit attempts.
