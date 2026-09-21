# Existing project open workflow

Issue #17 adds **Open project** to the welcome screen and project workspace.
The native picker selects the existing project root (the folder containing
`project.json`), then core's `openProjectForEditing` inspects compatibility,
recovers or migrates when needed, and validates it before activation. The workspace
shows the selected book's title, author, language, location, chapter count and
derived word total. Chapter editing and the interactive navigator are separate
issues; chapter bodies are not exposed by this operation.

## IPC and validation

The existing restricted `project.open()` preload call now returns
`ProjectOperationResult<ProjectWorkspace | null>`. A successful `null` result
means the native picker was cancelled. The request accepts no payload or path.
Main uses the native-selected path directly and checks the owning window,
top-level frame and exact renderer URL before selection, after selection and
after loading. It never returns project data to an unauthorized frame.

Creation and opening share `registerProjectHandlers` in
`apps/desktop/src/main/ipc/project-handlers.ts`, retaining one authorization
boundary and one pending-operation guard. A successful open clears any old
creation-folder grant. The renderer-safe workspace DTO now includes chapter ID,
title and word count summaries; newly created workspaces return an empty list.

Known loader error codes map to fixed, actionable messages for missing files,
invalid JSON or schemas, unsupported versions, invalid ordering, inaccessible
paths and concurrent chapter changes. Raw exceptions and author content are not
logged or forwarded. Native picker and unexpected failures have a safe generic
message. The [loader/cache strategy](project-loading.md) remains unchanged:
authoritative files are preserved and only the disposable summary cache may be
rebuilt after a successful open. Issue #111 adds the
[verified-backup and journaled V1 -> V2 migration](project-format.md); an
unfinished or invalid migration cannot be exposed to the editor. Newer formats
produce an explicit newer-compatible-BookEditor error without mutation.

## Switching and pending changes

The current workspace remains visible while the next project loads. Only a
successful, non-null response replaces it. Cancellation, validation failures and
transport errors preserve the previous project. UI buttons prevent overlapping
opens, and main also serializes open, creation and folder selection requests.
An active New Project modal disables opening so its unsubmitted form is retained.

There is currently no editable manuscript state or autosave service to flush.
When autosave is integrated, switching must first resolve dirty/in-flight edits
through the save/recovery workflow before replacing the current session; cancelled
or failed saves must retain it. That integration must add tests for edits during
an in-flight save and failed/cancelled saves. This issue does not simulate an
autosave guarantee that the application cannot yet provide.

## Validation

Component tests cover opening from welcome, switching from a created or opened
workspace, cancellation, errors/retry, pending requests and protection of the new
project form. Main tests use real temporary project files for valid, missing,
malformed and unsupported-version selections, and test native picker options,
authorization, arbitrary-path rejection, concurrency and safe error mapping.
Preload tests verify the no-argument channel call.

For a desktop check, build and start the app, open a synthetic existing project,
then select a different project. Verify the metadata and chapter/word totals
change. Cancel another selection and try an invalid folder: the previously opened
workspace should remain visible and invalid selection should show a clear error.
