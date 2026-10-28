# Local comments, annotations and revision workflow

Status: normative technical design for #169. The #170 working branch contains a
partial runtime implementation; it does not yet satisfy the complete #170
acceptance matrix. See the implementation status in `editorial-format.md`.
Product: CORE (`product:core`). Implementation owners are #170 (editorial storage
and anchors), #171 (named snapshots), #172 (comparison) and #173 (revision mode).
The [versioned schema contract](editorial-format.md), [synthetic examples](examples/editorial-v1/README.md)
and [delivery reconciliation](planning/169-editorial-delivery.md) are part of this
design. Existing applications continue to open and create project v2 unless a
project has been explicitly migrated with the #170 core migration operation.

## Evidence and architecture decision

Prerequisites were checked against `main` at `7f47fab`, not inferred from plans:

| Prerequisite | Merged evidence                                                        | Reused implementation / limits                                                                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #111         | PR #157, `aaa04def45f811ae73485fe6315f353120f639f3`, 22 September 2026 | `project-migration.ts`, `project-snapshot.ts`, versioned model schemas and migration tests provide verified whole-project backup, staging, hashes and restart recovery. The current migrator handles v1→v2 only; v2→v3 is new #170 work.                                |
| #120         | PR #188, `73fd419ef79e63045cd33e8e682cfdc9b9f15f90`, 25 September 2026 | `history.ts`, `chapter-saving.ts`, `ChapterHistoryDialog.tsx` and restore tests provide read-only preview, explicit confirmation, flush, mandatory verified safety copy and stale checks. History v1 contains one semantic document, not a complete editorial revision. |

Both issues are closed and both merge commits are ancestors of this baseline.
Reuse TipTap's existing semantic extensions, ProseMirror transforms/history,
`document-state.ts`'s captured-revision acknowledgements, the 750 ms autosave
coordinator, restricted preload, project operation lock, atomic writer, recovery
session handshake, #119 chapter operations and portable archive inventory.
Do not create a second rich-text editor, undo stack, chapter-history browser,
account system or database. `packages/editor-schema` remains a planned package;
the actual extensions currently live in `apps/desktop/src/renderer/components`.

**Architectural conflict resolved here:** optional editorial sidecars beside
chapter-v1 files would let older applications silently edit text without remapping
anchors, or export the wrong revision state. A single-file atomic chapter save
also cannot atomically commit a shared thread split across two chapters. Therefore
#170 introduces an explicit **project v3 gate**, chapter v2 envelopes, editorial
state v1 and a recoverable multi-file transaction. This extends the existing
operation-lock/atomic-write architecture; it does not claim that existing migration
or replacement journals already implement this transaction. The #170 branch now
has v3 schemas, a transactional migration service, recovery, and structural
chapter-operation support. Desktop project opening does not migrate implicitly;
the annotation sidebar offers an explicit confirmed upgrade from an open chapter.
Applications without v3 support reject the format without writes.

Manuscript/editorial project files remain authoritative and extractable as JSON.
EPUB, PDF and DOCX publication outputs are projections, never authorities. A cache
may be rebuilt from these files; no database is needed.

## Local annotation model and UX

An annotation is a comment, private note or highlight; it owns one stable anchor
and one thread. A thread contains ordered plain-text comments, local display
labels and open/resolved state. A highlight may have an empty thread; a new comment
or note starts with one comment. All three kinds support replies and resolution.
Resolution hides an item from the default open-items list but preserves its text,
anchor and identity. Reopen is explicit. Orphan status is independent of resolution:
a resolved thread may become orphaned and remains discoverable in both filters.

Delete is an explicit tombstone, not erasure. Deleted comments retain their body;
deleting an annotation tombstones its annotation/thread/anchor together. Restore
retains IDs. Emptying a comment does not delete it. No automatic retention or hard
purge is introduced. Plain text is rendered inertly; URLs are not fetched. No
comment, selected text, revision payload, display label, query or private path is
logged. Export canaries distinguish private metadata from text intentionally
copied by an author into the manuscript.

Sidebar filters cover kind, open/resolved, attached/partial/orphaned and deleted.
Show chapter/title, excerpt, attachment status and any lost text. Keyboard users
can create a comment from a selection, move through threads/replies, resolve,
reopen, explicitly reattach and return to the editor. Use labelled controls,
announced save/error/orphan states and focus restoration. Colour is supplementary
to text/icons. Selecting a thread never edits manuscript text. Reattachment
requires choosing and confirming a new selection; show old and new contexts.

## Stable anchor contract

Anchor identity is a UUID, not an offset or a quote search. An anchor contains one
or more live segments, immutable original evidence, retained lost segments and a
status. Each segment addresses a stable chapter UUID and the **proposed** semantic
document at an explicit chapter revision/hash. Positions use ProseMirror UTF-16
units, including container and atom sizes; they are not text-file byte offsets.
Selection endpoints must be valid grapheme boundaries across adjacent marked text
nodes. Normalization is never applied. Quote/context evidence is diagnostic, not
permission to attach to equal-looking text. No automatic fuzzy reattachment.

Original evidence retains the selected semantic slice, chapter ID/hash, original
range and bounded before/after context. Live positions plus the current document
hash are updated in the same transaction as text. Loading a mismatched hash marks
the anchor `unverified`; navigation to a range and ordinary mutation stop until
recovery or explicit reattachment. Do not accept a newly computed hash as proof of
mapping. Orphaned content remains readable even when its chapter is absent.

For each committed editor transaction, map the anchor through its ordered
ProseMirror `StepMap`s. Range start has association `+1`, end `-1`: insertion
exactly at either edge is outside the annotation; insertion strictly inside is
included. Point anchors use one position with association `+1` (right affinity).
Store point affinity explicitly. Use `mapResult` deletion information as well as
positions. An endpoint that was deleted must not be treated as a valid match just
because another offset exists there.

Before each replacement step, intersect its removed intervals with each live
segment, preserve the removed semantic slices, and map surviving intervals. An
insertion is not loss. Partial loss yields `partial`; complete loss yields
`orphaned` with no live segments, never a silently collapsed annotation on new
text. A replacement covering the whole target is loss even if its replacement
has identical spelling. Adjacent surviving pieces may be coalesced only within
the same chapter/revision and without erasing a retained loss record. Overlapping
annotations are independent: mapping one cannot change or resolve another.

| Operation                               | Required mapping / failure behaviour                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Insert before / within / at either edge | Shift / expand / exclude the boundary insertion using the affinities above.                                                                                                                                                                                                                                                                                                                            |
| Delete or replace part/all of target    | Retain lost slices; mark partial/orphaned. New replacement text is not automatically a replacement target for a fully deleted anchor.                                                                                                                                                                                                                                                                  |
| Mark/format change                      | Use actual maps; identity maps retain positions. Validate the resulting semantic document and update its hash. No quote-text rematching.                                                                                                                                                                                                                                                               |
| Undo/redo                               | Replay the inverse/forward text transaction **and its companion anchor/annotation/revision delta as one history event**. Restore exact prior attachment and retained-loss state for this event; do not infer resurrection by quote.                                                                                                                                                                    |
| Pending tracked deletion                | Map proposed text removal and retain a loss record naming its revision group. Reject restores the attachment through the recorded inverse; accept makes the loss permanent but retains the discussion. Deleted-text comments created in review attach to the group's retained slice, not an invented live position.                                                                                    |
| Split                                   | Flush and capture a fresh preview. Preserve #119's original left chapter ID and allocate a new right ID. Produce an exact old→left/right map from the semantic split, including recreated ancestor/container offsets. A crossing annotation becomes two live segments under the **same** anchor/thread ID. Never subtract only a raw text offset.                                                      |
| Merge                                   | Preserve #119's surviving first chapter ID. Map first segments unchanged and second segments by the first document's `content.size` because the current merge concatenates top-level content; validate this against the actual operation. A future joining merge needs a new explicit transform map. Tombstone the removed chapter identity; links retain existing unresolved-link rules.              |
| Chapter deletion                        | Move existing chapter data through the recoverable delete operation; orphan affected anchors and retain their evidence. Undo via explicit restore requires the matching retained chapter revision, not title equality.                                                                                                                                                                                 |
| Duplicate                               | New chapter ID; default copies text only. With pending revisions require an explicit accepted/proposed source projection. Do not copy private threads or silently settle the source.                                                                                                                                                                                                                   |
| Import / paste                          | #114–#117 import creates a new project and new IDs, with no inherited anchors. Paste into an existing chapter uses the actual insert/replace maps. No matching by source filename/title. Unsupported Word comments/revisions require a conversion warning and explicit text-state choice or rejection; they cannot be silently flattened. Editorial interchange import is separate scope.              |
| #120 historical chapter restore         | Preserve a verified **whole editorial transaction** safety copy first. The selected old history document supplies text only; existing anchors in the replaced chapter become orphaned with evidence, unless the author explicitly restores a complete versioned editorial bundle. Never attach comments by text similarity. Pending revisions require explicit review/cancel before text-only restore. |
| Named snapshot restore                  | Restore its exact text/editorial bundle consistently. Current-only discussions are retained as orphaned entries in a clearly labelled restore-conflict collection, with original IDs and full payloads; collisions preserve both versions, never last-writer-wins. See restore below.                                                                                                                  |

For split/merge with pending revisions, #173's initial rule is explicit **review
affected chapters first or cancel**. No silent flattening or unsupported remap of
revision patches is permitted. Comments still map through the operation after the
changes are resolved. #170 implements split/merge anchors before revision mode.
Scene/range Story Bible links remain out of scope; this design supplies reusable
anchor machinery but does not change the #160 link schema automatically.

## Revision mode and representations

`content` in chapter v2 is the accepted semantic document. `review.proposed` is the
visible proposed document, including all pending changes. Both are ordinary
portable semantic JSON. Pending groups describe exact nonoverlapping replacements
against `content`; replay in descending base-position order must reproduce
`review.proposed` exactly. Neither copy may be silently preferred on mismatch.
The pending patches plus accepted content are the source; proposed content is a
verified materialized recovery view. No new editorial marks leak into ordinary
manuscript semantic nodes. Show pending insertions and removed slices with labelled
decorations/review controls, not publication markup.

Mode is explicit `off` or `track`, persisted per chapter, with a persistent visible
indicator. Turning tracking off does not accept pending changes. One typing/IME
composition or explicitly grouped paste/format action forms one review unit and
one compatible undo event; preserve the existing composition grouping and call
history boundary controls between independent review decisions. Exact no-ops make
no group. Attribution is a local optional display label, never an account claim.

| Change kind | Base before / proposed after                                                 | Review                                                                                                 |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `insert`    | Empty slice / new slice at a base point                                      | Accept adds it to accepted text; reject removes it from proposed text.                                 |
| `delete`    | Existing slice / empty slice                                                 | Accept removes it from accepted text; reject restores it in proposed text.                             |
| `replace`   | Nonempty old / new slices                                                    | Show linked deletion and insertion; one atomic decision avoids half-accepted replacements.             |
| `format`    | Equal text/atom sequence, different supported marks or structural formatting | Show semantic before/after. Accept selects after; reject restores before without losing text or atoms. |

Use the existing node/mark vocabulary, including bold/italic/link marks, headings,
lists, quotes, epigraphs and their supported attributes. Removing or changing an
image/scene-break/hard-break is an insertion/deletion/replacement, not hidden as
formatting. Text-only attribute changes such as image alt text are replacements.
Unsupported schema nodes/steps block the action with the draft retained. Review
mode is not a licence to silently simplify rich text.

### Normalization and overlapping edits

Persist normalized replacement groups, **not arbitrary executable ProseMirror
steps or a CRDT**. A patch carries base positions, exact before/after ProseMirror
slices (`content`, `openStart`, `openEnd`), base document hash and a UUID. `before`
must equal `base.slice(from,to)`; `ReplaceStep(from,to,after,false)` must succeed.
The slice codec and semantic vocabulary are versioned in the format contract.
Structural formatting may require widening a patch to the smallest valid common
ancestor region. A whole-document replacement at `[0, content.size]` is the safe
fallback, visibly identified as one chapter-wide change before confirmation.

Normalize a new transaction against the proposed document using its exact step
maps and stored base→proposed patch maps. Disjoint edits can be inverse-mapped to
base positions. Positions inside pending inserted/replaced material belong to
that pending group, rather than to guessed base positions. An edit intersecting
multiple groups widens to the union of their base regions and the new affected
region; repeat closure until no patch intersects the widened interval. **Touching
endpoints count as overlap**, including two insertions at the same base point.
This conservative rule avoids tie-dependent composition.

If an action changes an existing review unit, preview **Combine affected changes**
with affected group count/IDs and before/after text, or Cancel. Confirmation creates
one new group with new ID and `supersedes` listing all replaced IDs in creation/ID
order. Retain the old groups in the transaction safety copy. An insertion subsequently
deleted to exact baseline is still an explicit combine/cancel-pending decision,
not disappearance of review evidence. Remap deleted-text discussions through this
known operation or retain them as orphaned historical targets; never drop them.
No silent grouping, automatic accept, fuzzy rebase or timestamp winner is allowed.

With tracking **off**, a disjoint ordinary edit updates accepted and proposed
documents together and maps all pending groups/anchors. An intersecting edit must
offer enable tracking and combine, review affected groups first, or cancel.
Cut/paste, replace-one/all, spell replacements and toolbar commands use the same
policy; disabling tracking cannot bypass a pending change. Cross-chapter replacement
uses one scoped review and recoverable transaction. Structural split/merge and
text-only history restore use the explicit review-first rule above.

### Accept, reject, undo and save

Review requests carry project generation, chapter revision, exact file hashes,
group IDs and an opaque preview token covering the operation and its scope. Main
revalidates them under the lock. Stale tokens fail without mutation and require a
new preview. Never resolve a different group at the old screen position.

Accept a disjoint group by applying its verified patch to accepted content,
removing it from pending, mapping the other base ranges through its `StepMap`,
refreshing their base hash and revalidating their before slices. Proposed text
remains identical. Reject removes the pending group, recomputes proposed from
accepted plus the remaining groups, and uses the recorded inverse replacement
to map proposed anchors. Accepted text remains identical. A failed precondition,
invalid slice or overlap after remapping aborts the **entire** decision. Batch
accept/reject works on a captured set in descending base-position order, with one
explicit count/scope confirmation and one transaction; no best-effort partial batch.

Annotation metadata and revision changes participate in companion ProseMirror
history events. Undo of an accept/reject in the current session restores the full
pre-event bundle, including pending IDs, text, anchor statuses and local thread
changes affected by that event; redo restores its post-event bundle. Core validates
the resulting bundle like any edit and assigns **new** persistent revisions.
Content revisions never decrement, and a saved undo is not a filesystem rollback.
Unrelated later comment edits must first undo in normal stack order; a selective
review action cannot overwrite them. Startup does not fabricate a persistent undo
stack. Named snapshots and chapter history remain the cross-session recovery tools.

Autosave serializes the captured text+editorial bundle. The existing coordinator
drains newer edits during flush; acknowledge only the captured generation.
Failed writes leave the latest in-memory draft dirty and the previous complete
saved bundle recoverable. Unsaved accept/reject decisions remain visibly unsaved;
an IPC timeout never means accepted. Save/discard/cancel on navigation or shutdown
applies to the whole dirty bundle, not just prose. Discard requires an explicit
warning that unsaved editorial/review changes will also be reverted. No text or
thread is discarded by merely closing a sidebar or a preview.

Companion undo stores deltas for touched IDs and verifies their expected post-event
values; it must not replace the entire shared editorial state with an old copy.
Disjoint discussions edited elsewhere remain untouched. If an affected record was
changed outside the active history stack, refuse that stale undo/redo with a clear
message and preserve both versions for explicit review. Persistent project/chapter
counters always advance through the normal commit path.

## Consistent writes and recovery

Use one authorized project writer and the existing project-operation exclusion
boundary. Freeze inputs, not the author's newer drafts. Each transaction advances
the root `generation`; only touched chapter `revision`s advance. Hashes detect
external edits; neither timestamps nor generation alone prove identity.

1. Validate the complete intended bundle, project/component versions, references,
   unique IDs, hashes, limits, safe paths and current expected generation. Settle
   history timers. Refuse unresolved migration/replacement/editorial journals.
2. Exclusively create `.editorial/transactions/<operation-id>/` containing
   schema-v1 `transaction.json`, exact before images and staged after images.
   Each inventory entry records path, before/after SHA-256 and size or explicit
   absence. Retain deleted files as before images. Flush, reread and verify all
   bytes before marking the journal `prepared`. A failure here leaves live files
   untouched and retains any complete draft candidate.
3. Recheck source inventory and authorization. Atomically publish each after file
   (manifest last), flushing affected directories using existing supported
   durability conventions. The application must not expose the mixed physical
   state to readers: all supported readers check for an incomplete transaction.
4. After every after-image verifies, atomically write journal phase `committed`.
   This is the logical commit point. Only then acknowledge the captured generation
   and restart history/cache work. Post-commit cleanup failure is a warning, not
   a failed save and not a reason to replay a different operation.
5. Before commit, failure/cancellation rolls back **all** before images. After the
   commit marker, recovery verifies/reinstates the complete after set. Recovery
   is idempotent and journaled; interruption during rollback/rollforward resumes
   that same direction. Preserve both sets until verified completion. Do not
   auto-delete transaction evidence in #170–#173.

Recovery first verifies the journal, retained images, operation ownership and that
each live file is exactly a listed before or after version (or listed absence).
An unexpected external hash, unsupported version, missing preserved bytes,
symlink/junction or ambiguous owner blocks automatic recovery; retain everything
and offer read-only extraction. Do not steal a live/unknown-host lock. Reuse proven
owner/recovery-claim patterns, but implement/test the new journal independently;
v1→v2 migration journals are not repurposed by renaming their version number.

After rollback, offer the complete after bundle as a **recoverable draft**, with
preview and explicit recover/discard/cancel. A crash during review before saving
cannot guarantee recovery of keystrokes never written; surface that limit. Durable
drafts must identify their base generation/hash and the captured editor generation.
Divergent drafts require explicit choice; no newest-timestamp winner or automatic
merge. The clean-session marker is written only after all text and editorial
flushes succeed. Atomic rename alone is not a promise against device loss or every
filesystem's power-failure behaviour.

## Named manuscript snapshots

These are immutable user-named **whole manuscript** checkpoints, independent of
active-chapter undo, five-minute history and full portable project backups. Store
them under `snapshots/manuscript/<uuid>/`, outside periodic `.history` retention.
A schema-v1 manifest names the project/generation, label, creation time, reason,
ordered chapter IDs and an exact hashed file inventory. Duplicate labels are
allowed; IDs identify snapshots. No implicit overwrite or pruning by label/date.

Capture freezes a saved-state request, flushes all editors (including references
and publication editors that share the writer), settles timers, acquires the
operation lock and verifies the inventory unchanged before and after copying.
Include every ordered chapter envelope, `editorial/state.json`, required review
evidence, `book.json`, `publication.json` if present, presentation/print settings
if present, source format descriptor and exact managed asset records/bytes used
by **accepted, proposed and retained deleted slices**. Preserve absent-vs-present
optional components. Snapshot scope includes manuscript publication context but
not Story Bible data, account settings, caches or recursive snapshots. The manifest
records excluded scope, so this is not advertised as a full project backup.

An author may save pending revisions in a snapshot: preserve both projections,
pending patches and private annotations exactly, without accepting anything.
Stage in a unique directory, verify copied hashes, publish the immutable manifest
last; incomplete directories are unavailable, retained and clearly labelled.
Missing referenced assets or unsupported components block capture with a located
diagnostic; do not create a misleading "complete" snapshot. Existing portable
archive inclusion must be extended and tested to retain snapshots/editorial data
even when optional **periodic chapter history** is excluded.

Deletion is explicit selection+confirmation by snapshot ID/hash, with references
from in-progress operations checked first. #171 atomically writes a versioned
`deleted.json` marker beside the immutable manifest, preserving all snapshot bytes.
A deleted-snapshots view supports undelete by removing the verified marker;
permanent cleanup is deferred, with no background retention. Pre-review/pre-restore safety snapshots
are pinned against deletion while their operation/recovery token is live. Disk
limits are checked before capture; reaching a limit fails visibly, never prunes
author-named snapshots automatically.

### Restore and conflicts

Preview exact snapshot identity/hash, changed chapter order/text, pending revisions,
editorial differences, asset requirements and publication settings. Flush current
edits; if flush fails, keep the current editor and abort. Create and verify a new
named **before-restore** safety snapshot of the current complete scope. If that
fails, do not replace anything. Confirm the source and destination generation
again, then use the transaction above to restore snapshot scope as one unit.

Preserve current project identity, creation timestamp and all out-of-scope reference
files/settings. Restore selected chapter IDs/order/content and editorial state;
assign a new root generation and fresh touched-chapter revisions, remapping stored
anchor hashes/revisions to that exact restored proposed content. Do not restore an
old generation counter. Removed current chapters and metadata survive in the
verified safety snapshot and transaction. IDs reintroduced by a same-project
snapshot retain identity; an ID belonging to incompatible retained content blocks
the operation pending explicit review. Cross-project restore is not supported;
use the portable backup/new-project workflow instead.

Current-only annotations become orphaned entries in
`editorial/restore-conflicts/<operation-id>.json` with their complete original
annotation/thread/anchor records and source generation. Same-ID, different-content
threads are stored there as a second version keyed by `(sourceGeneration,id)`;
the selected snapshot's version is active. Show a persistent conflict-count notice
and an explicit inspect/copy-comment/reattach/discard workflow. Copying creates a
new comment ID; reattachment never overwrites the restored thread silently.
The conflict file is included in archives and subsequent named snapshots.

Snapshot restore is not placed in chapter editor undo. Reload all affected editors
only after verified commit. The before-restore snapshot is the inverse recovery
operation. On failure, retain current drafts and source snapshot; on uncertain
outcome block editing until journal recovery identifies a complete state.

## Snapshot comparison contract (#172)

Inputs are two immutable snapshot ID+hash tokens, or one snapshot and an ephemeral
**captured saved-current** token with generation/inventory hash. Current capture
flushes first; Cancel leaves the live editor untouched. Both tokens explicitly
select accepted or proposed projection if pending changes exist. Never compare a
moving live buffer or mix chapter generations. Show source label/time/generation
and projection prominently; an edited current manuscript marks the comparison
stale but does not mutate its captured inputs.

Return a versioned transient `ComparisonV1` containing source tokens, completeness,
diagnostics and ordered changes: chapter-added/removed/moved, title/status/metadata,
text-insert/delete/replace, mark-change, node/attribute-change, and asset-change.
Each change has chapter UUID, old/new semantic paths and ranges, before/after slices
and a deterministic ordinal, never an executable mutation. Align chapters by UUID,
not title; report additions in new order, removals in old order, surviving chapters
in new order. Reordering and content changes can coexist for the same chapter.

Within a chapter, tokenize the existing semantic tree into explicit open/close/atom
tokens and Unicode **grapheme** text tokens with their canonical mark sets. No
Unicode normalization or whitespace folding. Compare the text/structure stream
first using Myers shortest edit script; when shortest paths tie, choose deletion
before insertion, then the earliest old position. Compare marks/attributes for
aligned tokens separately. Thus bold-only edits do not become delete/reinsert
prose. Preserve scene-break/hard-break/image atoms and link targets. Token metadata
records original ProseMirror positions; joined emoji are indivisible. Pin this
policy as `semantic-grapheme-v1`; a changed algorithm requires a new comparison
version/goldens, not rewritten manuscript data.

Compare asset IDs plus byte hashes; a missing/unreadable asset yields an unavailable
diagnostic with its ID, never false equality. Incompatible source schemas block
comparison unless a read-only adapter explicitly supports both; no migration of
source snapshots. Limit inputs to 10,000 chapters / 256 MiB semantic data, one
million tokens per chapter and ten million diff frontier expansions per chapter.
Yield/cancel at most every 8 ms of diff work. On a limit, retain completed changes
but mark comparison incomplete and that chapter unavailable; no fabricated coarse
"unchanged" result. The 300,000-word fixture must be benchmarked in #172.

Comparison is read-only. It cannot accept/reject revisions, write source files or
apply arbitrary diff hunks. Snapshot restore belongs to #171; review of actual
pending groups belongs to #173. A comparison change is not a tracked revision ID.

## Export and interchange

Before EPUB, PDF, editable manuscript DOCX **or publication preview**, flush the
complete bundle and capture one immutable generation. When any in-scope chapter
has pending groups, require a fresh explicit choice:

1. **Accepted text only** — omit pending insertions, retain pending deletions and
   use pre-change formatting.
2. **Proposed text including pending changes** — include pending insertions, omit
   pending deletions and use proposed formatting.
3. **Cancel** — produce nothing.

Show pending count, affected chapters and what each option means. One projection
applies to the entire output; no chapter-by-chapter silent default. Bind the choice
to the captured generation, inventory hash, output target and operation. If sources
change, cancel the old request and ask again. Do not remember a choice as a future
default. Exporting a projection **does not** accept/reject anything in the project.
With no pending groups, the two projections are equal and no choice is needed.
Failure or cancellation preserves any prior destination through existing atomic
export staging and leaves manuscript/editorial files unchanged.

The assembly input contains only the chosen semantic documents, public metadata
and required assets. All normal DOCX/EPUB/PDF outputs exclude comments, private
notes, highlight colours, threads, tombstones, anchors/quotes, author labels,
revision IDs/slices/ledger, snapshot labels and conflict files. Pending deletions
can contain asset references: include only assets used by the **chosen** publication
projection. Test ZIP parts, relationships, XML comments, custom properties, hidden
text, PDF text/annotations/metadata and EPUB resources with private canaries.

Current editable DOCX export is manuscript interchange, **not editorial review
interchange**. It follows the same explicit projection and privacy policy, and
contains no Word comments or tracked-change parts. A future explicitly named
"editorial review DOCX" could carry opted-in comments/changes after a separate
round-trip/security design; it must never be the normal publication command.
No such exporter/importer is delivered or allocated to Pro by #169.

## Product decision and unanswered questions

The scoped local comments, highlights, notes, anchors, revision mode, accept/reject,
consistent snapshots, comparison, recovery and safe publishing choices are CORE.
They run offline without an account or Pro checkout. The 2 October 2026 owner
decision places private-app evaluation through #203 **before** final Community/Pro
allocation; neither #52 nor #203 is a dependency of #170–#173. Nothing existing is
moved to Pro. No licensing decision, Pro repository or public-contribution change
is authorized.

Possible later owner-review candidates include multi-book editorial dashboards,
publisher-specific reports, sophisticated comparison visualizations and editorial
interchange tooling. These are observations, not approved commercial allocations
or present implementation scope. Cloud collaboration, CRDT multi-writer editing,
AI modification and remote review services are excluded.

No unresolved product/schema question blocks the scoped implementation. Runtime
durability on each supported OS, accessible interaction/screen-reader testing,
large-book performance and codec conformance remain mandatory implementation
evidence, not claims made by this design. Hard-purge retention, cross-project
annotation transfer, tracked structural split/merge without prior review and
external editorial DOCX interchange need separate future designs if pursued.
