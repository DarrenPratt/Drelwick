# Chapter History

Chapter History (#120, CORE) browses local chapter snapshots during normal editing.
Select a chapter, open its **Actions → Chapter History**, select a timestamp, and
preview before choosing **Restore snapshot → Confirm restore**. Keyboard users can
operate the native dialog, buttons and confirmation; Escape closes it except
during restore. Closing returns focus to the editor.

This is **not tracked changes or collaborative revision history**. There are no
authors, attribution, diffs, accounts, remote services or Pro dependencies.
Snapshots are independent of editor undo and are not every keystroke or save.

## Existing invariants and dependencies

The BookEditor → Drelwick repository rename preserved issue numbers. Prerequisites
#36 (stable plan task 35, merged PR #103), #37 (task 36, PR #105), and #40 (task 39,
PR #108) provide snapshots, retention, and explicit startup recovery respectively.
The existing runtime integration in PR #153 schedules saved-content snapshots.
Implementation is in `history.ts`, `history-runtime.ts`, `chapter-saving.ts`,
`recovery.ts`, the document reducer and autosave coordinator, with filesystem,
runtime, recovery and editor tests. Closed issue status alone is not the evidence.

Snapshots live at `.history/snapshots/<chapter-uuid>/<snapshot-uuid>.json`.
The unchanged version-1 envelope contains UUID `id`, UUID `chapterId`, ISO
`created`, a supported `reason`, and the semantic ProseMirror document `content`.
It contains no title, status, project-generation counter, cursor state or stored
checksum. No new project schema, history store or recovery protocol is introduced.

The browser verifies filename/embedded UUID agreement, directory/chapter identity,
schema version, timestamp, reason and current `ManuscriptDocumentSchema`. It
rejects linked files/directories and unsafe IDs. The list returns metadata only,
newest first, breaking timestamp ties by snapshot UUID. Existing envelopes combine
metadata and content, so validation reads them sequentially; bodies are not retained
for list rows or sent to the renderer until preview is requested. A temporary SHA-256
fingerprint of the previewed file detects changes between preview and restore; it
is not a new persistent checksum format.

The title is explicitly the **current title**. UUID is the identity; rename does
not move history or match by title. Snapshots do not restore chapter title/status,
manifest order or identity. Supported older content remains usable through the
current validator. There is no snapshot migration for unsupported versions: these
are omitted, counted as unavailable, and left on disk. Corrupt JSON, missing
metadata, invalid semantics, mismatched identities and unsafe paths cannot be
restored. A bad entry does not hide valid entries. No manuscript text or parser
payload is logged.

## Preview and missing chapters

Preview uses a separate read-only TipTap instance with the existing semantic
extensions: paragraphs, headings, marks, lists, quotations, scene breaks, links
and Unicode retain their structure. It never loads content into the live editor,
changes revision counters, or initiates a save. Normal autosave may independently
finish while the dialog is open.

Links cannot navigate. Image references are shown as unavailable placeholders;
preview makes no image or remote requests. The dialog explains that references
are preserved and missing assets remain unavailable. Restore uses normal asset
semantics: missing references are retained, never silently removed; existing
shared assets are neither copied nor deleted. No raw history paths cross IPC.

Deletion moves authoritative chapter files into the existing `.history/deleted`
area and removes manifest membership. This browser does not browse that trash or
resurrect chapters. A deleted chapter disappears from ordinary navigator access.
If it disappears while history is open, retained snapshots can still be previewed
but ordinary restore is disabled. Backend restore independently checks membership
under the chapter-operation lock and cannot target a different chapter. Splits and
merges do not introduce historical generations: restoring a surviving ID explicitly
replaces its whole current document, preserving the current document first.

## Restore and unsaved edits

Confirmation explains both replacement and the safety snapshot. The renderer
synchronously stops editing, uses the existing autosave `flush()` to drain pending
revisions, and checks the document is clean. For persisted A and unsaved B, it saves
B first. Failed flush leaves B in the editor and never invokes restore.

Main authorizes the trusted frame, active project UUID, chapter UUID, snapshot UUID,
fingerprint, semantic document and literal confirmation. It settles and stops saved
content timers so old content cannot be snapshotted after restore as apparently
newer work. Normal saving restarts snapshot scheduling later.

Restore extends the **same `saveChapter` path** used by ordinary saving:

1. Acquire the existing chapter lock; validate project, membership, chapter and
   semantic content; reject pending recovery temporary files.
2. Compare the saved chapter with the renderer's flushed document, aborting if
   they differ. Re-read/validate the selected snapshot and its preview fingerprint.
3. Create a **new** snapshot of current B using existing `before-replace` semantics,
   which bypass interval/identical suppression. Re-read the persisted snapshot and
   verify its identity, schema and exact semantic content before proceeding.
4. Validate historical content again, preserve the existing chapter envelope and
   metadata, advance modified time, and use the normal flushed atomic JSON writer.
5. Only after successful persistence, reload the editor into a fresh load session
   and refresh summaries/history. The selected historical file is never consumed.

Snapshot failure aborts before replacement. Commit failure leaves the previous
valid chapter and verified safety history available and retains the live editor.
An uncertain IPC outcome blocks further editing pending reopen. Post-commit lock
cleanup warnings are reported as success warnings, following normal save semantics.

## Interruption and startup recovery

Opening, listing and previewing history never run a recovery decision, clear a
session marker, consume a recovery file or mark a snapshot recovered. Safety
snapshots use `before-replace`, already excluded from newer-work startup candidates.

Restore inherits normal atomic-save recovery. Before rename, B is authoritative;
after rename, the complete historical document is authoritative. An interrupted
complete `.json.tmp` can be offered by existing startup recovery if newer; truncated
temporary data is never promoted. B also remains in the verified safety snapshot.
There is no half-document commit or new restore journal.

The existing stale-lock limitation remains: a killed process can leave
`.chapter-create.lock`. Drelwick does not automatically steal it. Preserve the
project and inspect the lock/recovery files before explicitly releasing a known
stale lock and retrying startup recovery. Process-exit tests verify both sides of
rename and this limitation; they do not claim physical power-loss or cross-platform
filesystem durability beyond the existing atomic writer.

## Retention and refresh

Policy is unchanged: keep every snapshot for 24 hours, then one per chapter/UTC
hour through seven days, one per UTC day through 30 days, and remove older valid
snapshots. There is no count cap or permanent safety-snapshot exemption. Interval
snapshots are at most every five minutes and suppress identical content.

Restore settles prior retention before preparation and schedules retention only
after successful commit. Its new safety snapshot is in the protected 24-hour
window. Browsing does not disable pruning. The dialog re-reads metadata on opening,
saved revisions, explicit refresh, after restore, and every five seconds while
idle, without overlapping its polling reads. Disappeared selections lose preview
and restore availability. Confirmation/restore pauses polling; the backend always
revalidates at execution time. Old snapshots may naturally expire after restart.

See [the acceptance audit](planning/120-history-acceptance.md) for executable
evidence and [startup recovery](manuscript-recovery.md) for the separate workflow.
