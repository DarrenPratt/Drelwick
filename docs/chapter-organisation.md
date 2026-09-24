# Chapter organisation

Issue #119 is CORE Community functionality. It uses the existing navigator,
semantic documents, autosave coordinator, chapter operation lock, atomic writer,
history service and manuscript replacement journal. No project or chapter schema
migration, account, service or Pro package is required.

## Chapter invariants and prerequisites

The UUID `id` and `manuscript/<id>.json` identify a chapter. The manifest's ordered
UUID list is authoritative; filenames and titles never determine order. Chapter
schema 1 carries type, title, status, created/modified timestamps and a validated
semantic document. Unknown envelope metadata is preserved. Status is exactly
`draft`, `revising`, `review` or `final`. Images refer to immutable project assets
by ID; neither chapters nor chapter operations own/delete those asset files.

Verified prerequisites on `main` at `06efb98`:

- #19 / PR #85: UUID creation, exclusive file publication and atomic manifest
  append, with recoverable unreferenced files on failure.
- #20 / PR #86: rename without changing identity, rejecting empty titles.
- #21 / PR #87 (lock correction PR #156): confirmed deletion, retained trash,
  manifest removal and synchronous rollback on failure.
- #22 / PR #88: validated manifest ordering without rewriting chapter files.
- #34 / PR #101: renderer revision tracking and awaited autosave flush before
  switching; failed saves retain the active document.
- #36 / PR #103: validated independent chapter snapshots, interval/content
  suppression and retention. Later recovery/replacement work adds mandatory
  pre-operation snapshots and an owned, recoverable multi-file journal.

Creation/deletion alone do not provide a transaction for restructuring existing
content plus the manifest. This issue extends the existing replacement journal
with optional structural changes; it does not compose naïve chapter writes or
introduce a separate persistence/recovery system.

## Commands

Use each chapter's **Actions** menu for **Duplicate**, **Split at cursor**, or
**Status**. Select exactly two chapters using their labelled merge checkboxes,
then choose **Merge selected chapters**. Controls use native keyboard-accessible
buttons, checkboxes and selects. Split/merge use the existing native confirmation
convention; Cancel preserves the live editor and chapter structure.

- Duplicate preserves semantic content, type, status and extension metadata,
  assigns a new UUID/storage filename and new timestamps, and inserts immediately
  after the source. Its title is `<title> Copy`.
- Split keeps the original identity/title/created timestamp for the first portion
  and creates `<title> Continued` immediately after it, with a fresh UUID and
  timestamps. Both keep the source type/status and metadata. Generated titles
  truncate the source to 190 characters to remain renameable within the UI limit.
- Merge requires two distinct adjacent chapters, revalidated against manifest
  order at execution. Reading order determines the destination regardless of
  checkbox selection order. The first keeps its identity/title/status/metadata;
  the second's blocks follow the first's blocks without concatenating paragraphs.
  The second is removed from authoritative order and storage only within the
  recoverable transaction. Both pre-merge contents remain in history.
- Status persists through privileged chapter persistence. It changes only status
  and modified time, retaining content, identity, creation time and order. Values
  are validated using the same canonical schema through UI, IPC and core.

## Explicit split boundary

Split requires a collapsed editor selection. It uses the actual ProseMirror
UTF-16 position and checks the exact semantic document after flushing. It never
infers headings, whitespace or word-count boundaries. The backend validates
project identity, the reviewed manifest order, document equality and position.

Between-block and within-paragraph/heading/code boundaries preserve nodes and
marks. Splitting within formatted text copies its marks onto both remaining runs.
Quotes, lists and epigraphs retain their ancestor attributes when both halves
remain valid under the manuscript schema. Structural positions which would leave
an invalid list item or other container are rejected, never shifted or repaired
silently. Scene breaks, rules, images and hard breaks are indivisible atoms and
may lie on either side. Unicode graphemes, including surrogate pairs and combining
sequences crossing mark boundaries, cannot be split internally.

Start/end, empty chapters, noncollapsed selections and boundaries leaving no
meaningful text or atom on either side are disabled/rejected. Empty wrapper
fragments at the cut are omitted. This does not remove existing empty blocks
elsewhere. Text occurs exactly once across the two resulting documents.

## Persistence and recovery

Confirmation precedes commit. Editing and document transitions pause while the
existing autosave coordinator drains pending revisions. Save failure aborts before
any restructuring and retains live unsaved edits. The UI cannot close while a
chapter transaction is running. All requests use the existing restricted preload
boundary and authorized project path; the renderer cannot supply a file path.

The core takes the existing exclusive chapter lock, validates selection/revisions,
and creates mandatory `before-restructure` history for changed/consumed chapters
before authoritative writes. These snapshots bypass suppression and are excluded
from newer-history startup candidates. Status changes also retain such a snapshot;
duplicate does not overwrite source content and needs no source snapshot.

The existing `.manuscript-replace.json` journal now optionally records complete
before/after manifests plus created/removed chapter envelopes alongside changed
chapters. The pending journal precedes all writes. New files publish exclusively,
changed files replace atomically, and the manifest changes after chapter writes.
The resulting project is validated before recording completion. Unknown manifest
and manuscript metadata are retained. Existing replacement-only journals remain
readable; older builds reject structural journals rather than guessing recovery.

Failure rolls back every affected chapter and the manifest. Restart uses the same
owned-lock recovery entry point before project migration or chapter recovery:
pending operations roll back; completed operations remain completed. Unexpected
external revisions, live/foreign owners, interrupted recovery claims or failed
rollback retain the journal/lock and block editing. Preserve the whole project and
resolve the conflict before reopening. No mixed state is silently presented.

UI cancellation is available before commit, not as a dismissible in-progress
dialog. Core cancellation checks use the existing transaction rollback semantics.
Previously flushed author edits remain part of the recoverable original state.
Structural changes are not in editor undo; retained history is independent, and
the history browser remains separate issue #120. Existing filesystem durability
and concurrent-external-editor limitations still apply.

Asset references are copied/moved as semantic nodes. Asset bytes and records are
never duplicated or deleted. Existing missing-asset placeholders remain references
according to the established image recovery policy; organisation cannot repair a
pre-existing missing asset. No prose, cursor context, image alt text or raw parser
payload is logged.

## Executable evidence

- `packages/core/test/chapter-organisation.test.ts`: identity/order/status,
  formatted round trips, content conservation, Unicode, shared images, stale
  requests, snapshots, cancellation, manifest failure and process-exit recovery.
- `packages/core/test/manuscript-replacement.test.ts`: regression coverage for
  the shared replacement transaction and recovery protocol.
- `apps/desktop/test/project-workflows.test.ts`: live editor cursor/formatting,
  flush ordering/failure, confirmation cancellation, statuses and close guards.
- `apps/desktop/test/chapter-persistence-ipc.test.ts`: trusted sender, project
  authorization, strict inputs and persisted status through the real service.
- `tests/e2e/desktop.spec.ts`: native Windows duplicate, keyboard cursor split,
  explicit merge selection, status editing and restart with formatted content.

See the [34-criterion acceptance audit](planning/119-chapter-organisation-audit.md)
for implementation/test mappings and executed checks.
