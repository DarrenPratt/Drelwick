# Chapter document persistence

Issue #30 (CORE) connects the editor to chapter JSON through the restricted
`project.loadChapter` and `project.saveChapter` preload methods. Select a chapter,
edit it, then choose **Save chapter**. The editor pauses editing during the write
and reports success or an actionable failure. Failed saves keep the current
editor content available for retry. Loading and saving cannot expose another
chapter's content while a load is pending or has failed.

Loading follows project path and chapter identity, so word-count and navigator
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

## Remaining workflow issues

This supplies the persistence service and a direct save control. Revision tracking
(#31), debounced autosave (#32), keyboard/menu save integration (#33), safe chapter
switching (#34) and safe shutdown (#35) remain separate work. Save before changing
chapters, opening another project or exiting; those actions do not yet flush edits.
