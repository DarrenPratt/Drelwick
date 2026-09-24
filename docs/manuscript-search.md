# Manuscript Find and Replace

Issue #118 is CORE Community functionality, entirely local and offline. Open
**Edit → Find and replace**, press **Ctrl+F / Cmd+F**, or use **Find and replace**
in the workspace. Search does not change the document or its dirty revision.

## Scope and navigation

**Current chapter** searches the live editor, including unsaved prose.
**Whole manuscript** reads chapters in the manifest's canonical order and overlays
the active editor document. Only referenced manuscript chapters participate;
deleted chapters, backups, recovery files, metadata, image alt text, link targets,
epigraph attribution and story-bible data are excluded. Code-block text, headings,
list paragraphs, quotes and epigraph paragraphs are visible manuscript text.

Next/previous wrap through the selected scope. Enter in Find moves forward;
Shift+Enter moves backward. The status shows the current match and total count;
zero means no match is currently selected. Navigation selects and scrolls to the
text. Changing chapters uses the existing save coordinator: failed saves keep the
current chapter and its edits open. Escape in Find or Close find closes the panel.

Active edits recalculate results and invalidate a selected range or review.
Chapter switches, reorder/add/delete and completed bulk replacement reload the
whole-manuscript view. Other chapters are loaded asynchronously through the
existing restricted chapter API. External filesystem editing is not live-watched;
close/reopen Find to refresh it. Bulk commit rechecks the reviewed documents.

## Matching policy

Search is literal and non-overlapping; there is no regex, fuzzy or AI search.
Adjacent text nodes and all inline mark boundaries may be crossed. Paragraphs,
headings, list items, quote/epigraph paragraphs, hard breaks, scene breaks, images,
horizontal rules and chapter boundaries prevent a match from spanning them.
For example, plain `quick ` followed by bold `brown` and italic ` fox` matches
`quick brown fox`; two separate paragraphs never form that match.

**Match case** uses exact text when enabled. When disabled, ECMAScript Unicode
case-insensitive matching supplies locale-independent simple case folding. It is
not language-specific collation or full multi-character folding (`ß` does not
expand to `ss`). No Unicode normalization occurs: composed `é` and decomposed
`e` plus combining acute remain distinct. Matches must start/end on Unicode
grapheme boundaries, protecting surrogate pairs, combining sequences and joined
emoji from partial replacement.

**Whole word** rejects matches immediately adjoining a Unicode letter, mark,
number or connector punctuation (including underscore). Other punctuation is a
boundary. This is deterministic character-class behavior, not dictionary-based
segmentation for Chinese/Japanese/Thai, and apostrophes/hyphens are boundaries.
Both options apply identically to searching and replacement.

## Replacement and history

**Replace one** changes only the selected, revalidated active-editor match through
a normal ProseMirror transaction. It is independently undoable, updates the normal
dirty revision and autosaves normally. Replacement text inherits the marks on the
first matched character, including a link if present. Only matched text is removed;
unmatched prefixes/suffixes keep their own marks. Nodes, block attributes and
surrounding structure are not flattened or rebuilt. Empty replacement deletes
matched text. Identical text leaves bulk documents unchanged.

**Review replace all** displays the search/replacement strings, explicit scope,
match count and affected chapter count. **Confirm replace all** is a separate
action. Changes to documents/options invalidate that review. Closing/cancelling
review writes nothing. Replacement is literal text, not HTML or new structural
blocks. Search/replacement strings and manuscript contexts are never logged.

Confirmation pauses editing and document transitions, drains pending saves, then
checks the exact reviewed chapter identities/order and semantic documents in the
privileged process. A failed flush retains unsaved edits and never starts bulk
persistence. This applies to both scopes. A cancelled flush may finish saving the
author's existing changes, but it does not apply replacement.

## Recoverable bulk persistence

`packages/core/src/manuscript-replacement.ts` shares the chapter operation lock,
atomic JSON writer and existing `.history/snapshots/<chapter-id>/` service. Before
any authoritative replacement it creates mandatory `before-replace` snapshots
for every changed chapter. These bypass interval/duplicate suppression and are
excluded from automatic newer-history recovery candidates, like before-recovery
snapshots. Ordinary history retention still applies. Bulk changes do not enter the
active editor's undo stack; retained snapshots provide the pre-operation versions.
The separate history browser remains issue #120.

The version-1 `.manuscript-replace.json` recovery journal records validated before
and after chapter envelopes, operation ownership and pending/complete phase. It is
an internal recovery artifact, not a new project/chapter schema. Unknown chapter
envelope metadata is preserved. A durable pending journal precedes the first write;
each chapter is atomically replaced; complete is recorded only after every write.
The last journal is retained and replaced by the next bulk transaction.

Cancellation is checked before snapshots, between chapter writes and before the
completion record. A write already in progress finishes atomically before rollback.
Cancel replacement requests cancellation and keeps the UI busy until the operation
settles; it does not merely hide the panel. Cancellation after the completion point
cannot undo an already completed operation.

Write failure/cancellation restores all original chapter envelopes, including edits
flushed before confirmation. Rollback validates all current targets against the
journaled before/after revisions first. Unexpected external edits, inaccessible
files or failed rollback retain the journal and operation lock and block editing;
the UI explicitly reports recovery failure. Originals remain in the journal and
history rather than being silently discarded. Successful rollback returns a known
pre-replacement manuscript, not a partially replaced one.

Existing chapter `.tmp` recovery files block bulk replacement and remain untouched,
matching normal chapter-save behavior. Successful replacement also refreshes the
workspace's chapter and manuscript word counts.

Authorized reopen and unclean startup recover pending replacement journals before
migration or chapter recovery. Recovery verifies lock ownership and host and only
reclaims an operation whose process has exited (or which finished in this process).
It rolls back, never replays a replacement. Live/foreign-host owners, PID reuse,
unrelated locks or interrupted recovery claims fail closed. Preserve the whole
project and resolve the lock/access conflict before reopening; never delete the
only recovery copies. Independent recovery can copy each validated journal `before`
envelope into a separate copy of the project, or use retained history content.

The lock coordinates application operations, not external tools. Atomic writes
have the repository's existing filesystem/power-loss durability limits. Recovery
does not claim to repair storage loss affecting both originals and recovery data.

## Evidence

- `packages/core/test/manuscript-search.test.ts`: semantic positions, scopes,
  case/word rules, Unicode/graphemes, all structural boundaries, marks/links,
  deletion, identical replacement and stale ranges.
- `packages/core/test/manuscript-replacement.test.ts`: both bulk scopes, snapshots,
  stale review, snapshot failure, failure after a chapter write, cancellation,
  conflicting external edits and process-exit/reopen rollback.
- `apps/desktop/test/project-workflows.test.ts`: live unsaved search, editor undo,
  counts, review invalidation, flush ordering/failure and keyboard commands.
- `apps/desktop/test/chapter-persistence-ipc.test.ts`: restricted authorization,
  strict request validation, formatted replacement and content-free logging.
- `tests/e2e/desktop.spec.ts`: offline native Find, chapter navigation, explicit
  whole-manuscript review, formatted replacement and reopen with newer prose intact.
