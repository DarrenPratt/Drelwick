# Chapter document persistence

[Chapter History](chapter-history.md) uses this same save path for explicit
restore, with a verified current-content snapshot before atomic replacement.

Image references participate in this same validated atomic save and revision
workflow. Asset import commits first; failed chapter updates preserve the previous
file and retain both old/new assets. Missing references remain valid semantic
content and are not removed on load/save. See [local images](local-image-assets.md).

Issue #30 (CORE) connects the editor to chapter JSON through the restricted
`project.loadChapter` and `project.saveChapter` preload methods. Select a chapter,
edit it, then choose **Save chapter**. The editor remains editable during the write
and reports success or an actionable failure. Failed saves keep the current
editor content available for retry. Loading and saving cannot expose another
chapter's content while a load is pending or has failed.

Loading follows project path, chapter identity and a unique load session, so word-count and navigator
metadata updates do not reload disk content over current edits. Loaded content
does not emit an editing event; changing chapters also creates a fresh editor
history. Saving captures the serialized document and never replaces the editor
content with the acknowledgement.

## Validation and atomic writes

The privileged handler accepts only a UUID and document, checks the trusted main
frame and uses the project path authorized by native project selection. The core
service checks manifest membership and rejects linked project paths. Save shares
the existing chapter-operation lock with creation, rename, deletion and ordering.
Overlapping desktop project mutations receive `PROJECT_BUSY`.

`ManuscriptDocumentSchema` in `packages/project-model` validates node nesting,
attributes and marks against the deliberate manuscript vocabulary. Headings,
nested bullet/numbered lists, validated links and paragraph-based epigraphs are
available through keyboard-accessible editor controls; the existing paragraph,
marks, block quote, code, rule and scene-break structures remain supported. The
shared link policy permits absolute HTTP(S), email and non-empty publication
fragment targets and rejects executable, local-file and ambiguous URLs.
Unsupported nodes, marks and attributes are rejected on load and save rather than
silently dropped by the editor. Compatibility tests serialize actual editor
output through this validator. Update both together when extending the editor.

HTML paste removes presentation attributes and executable elements, preserves
the supported semantic structures, and unwraps unsupported containers so their
visible prose is retained. See [manuscript semantic elements](manuscript-semantics.md)
for the complete contract and migration policy.

The existing version-1 chapter envelope is unchanged; no migration is required.
Empty version-1 documents remain readable. Unknown chapter-envelope metadata is
preserved during save; only `content` and `modified` change. Unsupported documents
remain untouched on disk and require a compatible editor or explicit repair.

`saveChapter` uses the existing atomic JSON writer: write a temporary file, flush,
close, then replace the chapter. Replacement is the commit point. A failed write
preserves the previous chapter; an existing temporary file is retained for
recovery and blocks saving. Lock cleanup failure after commit produces a success
warning. Summary caches rebuild from the changed chapter on project reopening;
the manifest and book metadata are not rewritten.

The operation lock coordinates cooperating Drelwick operations. It does not
prevent external tools from changing files, and a crashed process can leave the
lock behind. Preserve project files and inspect stale locks/temporary files before
retrying. Atomic replacement retains the existing filesystem durability limits.

## Revision tracking and switching

Issue #31 adds in-memory revision tracking. Loading a chapter starts with matching
saved/editor revisions. Each editor update increments the editor revision and
shows **Unsaved changes**. Save captures that revision and its document together.
Only one save can be in flight; further editing remains available.

A successful acknowledgement advances the saved revision only to the captured
revision. Edits made during the write stay dirty until another successful save.
Failures retain both the current document and the prior saved revision. Save
responses are matched to a request ID, chapter and load session; stale responses
cannot acknowledge another request or newly loaded document. The existing IPC
promise associates each response with its captured request, so no persistence
format or IPC payload changes are needed.

The document reducer drives both rendered state and an immediately updated ref,
so save/switch event handlers see edits before React commits its next render.
Reopening a project or returning to a chapter creates a new load session. Late
loads are ignored and editing is unavailable until the selected load succeeds.
Undo/redo transactions also advance the revision: returning to earlier text can
remain dirty until saved. Revision counters are conservative session state and
are not stored in chapter JSON.

## Autosave scheduling and immediate triggers

Issue #32 saves the active manuscript after **750 ms without an edit**. Each new
edit resets that deadline. The host-independent coordinator lives in
`packages/core/src/autosave.ts`; the renderer imports the dedicated
`@drelwick/core/autosave` export, which does not import filesystem helpers.
Autosave and **Save chapter** share the existing validated main persistence
service and renderer revision acknowledgements.

Only one write runs at a time. Edits made during a write remain responsive and
schedule their own idle deadline. If that deadline expires before the current
write finishes, the next snapshot waits for it; further typing resets the pending
deadline. Explicit flush requests bypass the delay and drain newer revisions in
order until clean, sharing an in-flight write instead of starting overlapping
writes. Clean documents do not trigger writes.

Save failures are shown in the editor and retain dirty content. The coordinator
does not automatically retry a failed revision, avoiding repeated disk writes
and alerts. Newer edits keep their own debounce even if the preceding write fails.
A new edit starts another debounce; **Save chapter**, window focus loss or another
explicit flush request retries immediately. Disposal cancels timers and queued
work while allowing an already-started atomic write to finish. React StrictMode
setup/cleanup creates a fresh coordinator and removes old listeners.

Window focus loss requests an immediate flush. Attempting to select another
chapter, create a chapter, delete the active chapter or leave the project by
opening another project also requests a flush. The existing transition guard
waits for chapter saves before replacing the active document; a failed save
keeps the current chapter open and reports an actionable error. Editing pauses
only during operations that can replace the active document, not during an
autosave.

The renderer's `beforeunload` handler requests a flush and cancels a dirty or
in-flight close/reload, using Electron's explicit return-value behavior (see
[BrowserWindow close handling](https://www.electronjs.org/docs/latest/api/browser-window#event-close)).
The application explains that closing must be retried after saving. A failed
flush leaves the window open and the editor dirty. A subsequent clean close is
allowed. DOM tests cover failed-close preservation, immediate close-trigger
retry, clean close and listener cleanup. Native application-close behavior still
needs verification on the supported desktop platforms.

Application shutdown uses a restricted main/preload handshake. The main process
intercepts the quit request and asks the renderer to flush its coordinator. The
renderer reports whether persistence succeeded; failure cancels the quit and
keeps the session marker unclean. Only a successful response allows the main
process to mark the session clean and exit.

There is currently no separate project-close command. Leaving a project through
Open project uses the flush trigger; the coordinator's `flush()` entry point is
also used by the application shutdown coordinator. No shutdown discard choice or
automatic post-save navigation is introduced here.

## Remaining workflow issues

Issue #33 adds **File → Save** and **Ctrl+S / Cmd+S**. These and **Save chapter**
invoke the same guarded renderer command and autosave coordinator flush. The
native menu sends a payload-free notification through a restricted preload
subscription; the renderer never receives Electron events or arbitrary channels.
Subscriptions and keyboard listeners are removed on cleanup. Saving is a no-op
without a loaded active chapter or during document replacement. Clean documents
are not rewritten. Repeated requests share the in-flight write and drain newer
edits. The existing save status shows saving, unsaved changes or all changes saved;
failures retain the document and show an actionable error for manual retry.

Periodic history snapshots are stored independently under
`.history/snapshots/<chapter-id>/` as versioned chapter documents. The history
service validates snapshots before writing, limits interval snapshots to one
per five minutes per chapter, and suppresses identical content. Snapshot
failures are reported without affecting the authoritative chapter file.

The privileged desktop process schedules an initial snapshot after each
successful chapter save and tracks the latest saved document for that chapter.
While saves continue, it attempts another snapshot every five minutes; the core
history service enforces the interval and duplicate-content rules. If a chapter
has not been saved for a full interval, its timer stops until the next successful
save. Snapshot jobs are serialized with retention for each project and run
outside the save response path. Retention is scheduled after a project opens.
Closing or replacing a project cancels its timers and settles queued work, and a
clean application shutdown cancels all timers and waits for queued history work.
History failures are logged using project/chapter identifiers and error
classification only; they never change save results or log manuscript content.

Retention keeps all snapshots for 24 hours, then one per UTC hour through seven
days and one per UTC day through 30 days; older validated snapshots are removed.
Invalid history files and authoritative manuscript files are left untouched.

After an unclean application shutdown, startup scans each recent project for
validated chapter temporary files and history snapshots newer than the
authoritative chapter's `modified` timestamp. Invalid files, symlinks and
unbounded paths are ignored safely. The scan only reports candidates; it never
replaces a manuscript file automatically. Recovery actions remain an explicit
startup workflow.

Application shutdown uses the session marker only after pending persistence
succeeds. Close attempts now trigger a guarded flush, but forced process
termination and operating-system shutdown are not crash recovery. Wait for
**All changes saved** before exiting.
