# Chapter document persistence

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
attributes and marks against the installed StarterKit plus SceneBreak vocabulary.
Unsupported nodes, marks and attributes are rejected on load and save rather than
silently dropped by the editor. Compatibility tests serialize actual editor
output through this validator. Update both together when extending the editor.

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

The operation lock coordinates cooperating BookEditor operations. It does not
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

Selecting another chapter while dirty or saving keeps the current chapter open
and explains what to do. Creating a chapter, deleting the active chapter and
opening a project (including a recent project) use the same guard. Save the latest
edits, then repeat the action. Editing pauses during operations that can replace
the active document, preventing new edits from being lost while those operations
are pending. There is no automatic save or implicit discard.

## Remaining workflow issues

Debounced autosave (#32), keyboard/menu save integration (#33), saving automatically
before chapter switching (#34) and safe shutdown (#35) remain separate work. Save
before exiting; revision state is in memory and does not yet guard window close or
provide crash recovery. The switch guard in #31 blocks navigation until saving
succeeds instead of performing #34's automatic save-and-switch workflow.
