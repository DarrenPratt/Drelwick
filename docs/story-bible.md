# Local story bible persistence and linking

Status: normative design from #160; #161 supplies the storage and restricted IPC
foundation described in [implementation notes](story-bible-storage.md). Editors,
search UI and the later linking workflow remain separate follow-ups.
Product: CORE (`product:core`). This is the normative contract for
technical specification §§65–71 and §103, design §§24–29 and the public format's
reference extension. Persistent shapes below remain authoritative for #161.

## Scope and existing foundation

The initial offline scope is character, location, canon fact, timeline event and
research/general note CRUD, basic local search and explicit chapter-level links.
No account, cloud, AI, automatic manuscript modification or Pro dependency is
required. Organisations and technology use notes or canon categories, not new
record types. Attachments, scene/range links and stable manuscript anchors require
separate designs. Advanced continuity, series management and editorial tools are
unallocated candidates for owner review **after #203**. The 2 October 2026 decision
supersedes earlier Pro allocations; neither #203 nor #52 blocks this CORE scope.

On 14 October 2026, #111 was closed and PR #157 was merged at
`aaa04def45f811ae73485fe6315f353120f639f3` (an ancestor of the inspected checkout).
`packages/project-model/src/versions/v2.ts`, `src/migration.ts`, core
`project-migration.ts`, `project-snapshot.ts` and `test/project-migration.test.ts`
provide actual version detection, verified complete backups and recoverable v1→v2
migration. Their journal is specifically for that transition, not a generic
reference migration engine. Core's atomic writer, chapter save/operation lock,
archive inventory and recovery patterns are reusable foundations, not evidence of
reference support. Current archives already include eligible `reference/` files;
current recovery scanning and chapter history do not understand reference drafts.

## Ownership and security

- `packages/project-model`: strict versioned schemas, historical versions and
  structural/semantic validation contracts, including recovery envelopes.
- `packages/core`: platform-independent record operations, revision checks,
  persistence/recovery orchestration, link resolution, indexes, search, component
  migrations and backup consistency. Files are authoritative; indexes are disposable.
- `packages/shared`: renderer-safe DTOs/results, with no filesystem authority.
- `apps/desktop`: authorized project sessions, restricted main/preload IPC,
  filesystem adapters and dirty-state/navigation UI. Validate sender, project
  authorization, type, UUID and payload before resolving paths. Never accept a
  renderer-supplied filesystem path as a record target.

Keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
Reject symlinks/junctions and non-regular files, including substituted ancestor
directories; check containment beneath the authorized real project root. Do not
log record names, notes, link labels, search terms, raw schema errors, manuscript
text or private paths. Log only fixed error codes and operation categories.

## Portable layout and compatibility

```text
reference/
  characters/<record-id>.json
  locations/<record-id>.json
  canon/<record-id>.json
  timeline/<record-id>.json
  notes/<record-id>.json
  history/<record-id>/<snapshot-id>.json
  recovery/<record-id>/<draft-id>.json
  preserved/<record-id>/<copy-id>.bin
```

Paths are project-relative with `/` separators. Names/titles never determine
paths. Each live or soft-deleted record is independently authoritative in its
type directory. There is no reference manifest, database, duplicate link store
or persisted backlink index. History, recovery and preserved raw bytes are auxiliary, never selected
as live records by directory scanning. A recognized record file's basename must
exactly match its embedded ID and its kind must match the directory.
Snapshot, draft and raw-copy filename IDs are independently generated lowercase
UUID v4 values; their parent directory uses the original record ID.

An absent/empty `reference/` means an empty bible, without writes on read. The
first explicit create lazily creates its directory and publishes one record.
Project v2, `format.json` v1, book v1 and chapter v1 stay unchanged. Do not add
fields to the strict format descriptor. Reference record/envelope versions are
independent. New projects need no seeded records. Historical project v1 still
uses the existing verified v1→v2 migration before desktop editing; that migration
must preserve reference files byte-for-byte, including unsupported files.

Legacy author files are not imported by guessing their shape. Unexpected files
in managed type directories, duplicate IDs, or unsupported record versions block
reference mutations until explicitly resolved outside the ordinary CRUD path;
recognized valid records remain readable with an incomplete-data warning. Other
unrecognized files elsewhere under `reference/` are retained and never treated as
records. Opening, manuscript editing and manuscript export remain available.
Older Drelwick builds ignore reference semantics: they can preserve eligible
bytes in archives but cannot validate links, recover reference drafts or guarantee
the new write contract. Do not silently downgrade through an older build.

## Version-1 record schema

All objects below are strict: only listed fields are allowed. Fields are required
unless marked optional; null is allowed only where explicitly stated. No coercion,
default insertion or unknown-field stripping on read. Text is plain Unicode, not
HTML, Markdown rendering instructions or ProseMirror content. Render it inertly.
The [JSON examples](examples/story-bible-v1.json) are a documentation bundle of
five separate files, not a new aggregate project-file format.
They assume project `00000000-0000-4000-8000-000000000001` and an existing
manifest-listed chapter `00000000-0000-4000-8000-000000000002`; they are not a
complete project fixture. Place each element at the type/ID path defined above.

Shared fields for every kind:

| Field                 | Contract                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`       | Integer literal `1`; detect before parsing the remaining shape.                                                                                                                                |
| `kind`                | `character`, `location`, `canon`, `timeline` or `note`.                                                                                                                                        |
| `id`                  | Immutable lowercase UUID v4; unique across all reference types, including deleted records. Never reuse an ID.                                                                                  |
| `projectId`           | UUID v4 exactly matching the project's stored spelling.                                                                                                                                        |
| `created`, `modified` | Real UTC timestamps in `YYYY-MM-DDTHH:mm:ss.sssZ`; `created <= modified`. Core owns timestamps; they are not revision tokens.                                                                  |
| `revision`            | Positive safe integer, ordinary create starts at 1; each committed mutation increments it. Missing/corrupt-target recovery uses the validated maximum described below. Overflow blocks writes. |
| `deletedAt`           | `null` for active records or a UTC timestamp between `created` and `modified`. Deleted records retain every content field and outgoing link.                                                   |
| `tags`                | Array of unique, nonblank strings, at most 100 items, each at most 100 Unicode scalar values. Equality is exact; no silent normalization.                                                      |
| `links`               | Array of at most 1,000 link objects, defined below. Empty is valid.                                                                                                                            |

Labels (`name`, `title`, aliases, `role`, location `type`, timeline `date`) are
nonblank when present and at most 500 Unicode scalar values. Optional prose may be
empty; each prose field is at most 100,000 scalar values. Required `statement` and
`body` may be empty to permit a new draft. Arrays must be explicit, including
empty arrays. Reject unpaired surrogate code points and NUL. Preserve other
Unicode, line breaks and whitespace without normalization. Limit each record
file to 8 MiB UTF-8 and the live/deleted record scan to 10,000 files / 256 MiB;
exceeding a limit produces an explicit incomplete/read-only reference result,
never a silently truncated search or save. Archive limits remain separately
applicable; these are resource ceilings, not paid tiers. Bound recovery/history
scans separately to 10,000 files / 256 MiB per scan and 9 MiB per draft envelope
(the nested record still has its 8 MiB limit). Preserve excess files and report
incomplete recovery results; do not load an unbounded auxiliary tree into memory
or interpret a partial scan as proof that no recovery data exists.

| Kind / directory           | Additional fields (no others)                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `character` / `characters` | `name`; `aliases`: at most 100 unique labels; optional `role`, `description`, `appearance`, `personality`, `background`, `notes`.                                                                                         |
| `location` / `locations`   | `name`; optional `type`, `description`, `notes`. Important features use description/notes; no image field.                                                                                                                |
| `canon` / `canon`          | `title`, `statement`, `category`: exactly `character`, `technology`, `location`, `history`, `relationship`, `terminology` or `other`; optional `notes`.                                                                   |
| `timeline` / `timeline`    | `title`; optional `date`, `sequence`, `description`, `notes`. `sequence` is a safe integer (negative and zero allowed). `date` is a free-text fictional/calendar label, never implicitly parsed or sorted as a real date. |
| `note` / `notes`           | `title`, `body`; optional `source`: plain text up to 2,000 scalar values for a citation/URL, never fetched or treated as a filesystem path.                                                                               |

Timeline order is numeric sequence ascending, then unsequenced events, with ID
ascending as the final tie breaker. Dates do not affect ordering; undated events
are valid. Ordinary lists sort by name/title using Unicode code-point order then
ID, independent of locale. UI may offer explicit alternate sorting without
rewriting records.

## Link schema and resolution

Each source record owns its links. A link has exactly:

```typescript
type ReferenceLinkV1 = {
  id: string; // immutable lowercase UUID v4, unique across all record links
  target: {
    kind: "chapter" | "character" | "location" | "canon" | "timeline" | "note";
    id: string; // reference UUID v4 lowercase; chapter UUID spelling as stored
  };
};
```

The owning record supplies the source ID. No title, path, position, range,
scene ID, inferred mention or manuscript text is stored in a link. One edge per
source and `(target.kind, target.id)` pair, comparing IDs case-insensitively.
Self-links are rejected. Reference graph cycles are allowed (unlike implementation
dependencies); traversals must use a visited set. Link IDs survive renames and
target restoration. Removing and later recreating an edge creates a new ID.
Core creates IDs and validates their global uniqueness among live/deleted records
under the project lock. Historical snapshots and drafts repeat the original IDs;
they are not duplicate authoritative records or links.

New or retargeted links require an active, valid same-project target of the stated
kind. A chapter target must be in `project.json`'s manuscript order and have a
valid matching chapter file; an orphan file is not an active chapter. Existing
unresolved links are valid stored data: unrelated edits may preserve them, but
cannot introduce a new unresolved target. Retargeting keeps the link ID and
requires explicit author action. Reference-to-reference associations use this
same vocabulary; directed links do not imply a separately stored reciprocal edge.

The old illustrative timeline `chapterIds`, `characterIds` and `locationIds`
arrays are **derived views of `links`**, not persisted fields. #165 selects these
targets using the #161 schema/storage foundation; #166 adds the general linking
UI and bidirectional navigation. This avoids a dependency from #165 back to #166.

Resolve each edge as `resolved`, `deleted` (known soft-deleted reference target),
`missing` (absent target or chapter removed from manifest), `invalid` (target
present but malformed, duplicate, wrong kind or wrong project) or `unsupported`
(unknown version/fields). Never choose an arbitrary duplicate. Inbound lookup
scans valid source records' outgoing links and returns source ID, link ID and
resolution. Normal lookup excludes deleted sources; a recovery view can include
them explicitly. Invalid sources yield an incomplete-results diagnostic, not
fabricated edges. Outgoing and incoming lookup use one captured inventory of
record bytes and manifest/chapter membership under the operation lock, verified
unchanged before returning results; no persisted project-wide revision exists.
Caches invalidate after mutations and detected external changes,
and rebuild on reopen. Link status and displayed titles are derived, not saved.

| Lifecycle event                 | Link behaviour                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename/reorder/status/text edit | IDs and links unchanged; derived titles/order refresh.                                                                                        |
| Delete reference                | Atomically set `deletedAt` on the same record; preserve payload and edges. Incoming edges report `deleted`; no cascade.                       |
| Restore reference               | Explicit action clears `deletedAt`, increments revision and retains ID; incoming edges resolve again.                                         |
| Delete chapter                  | Existing chapter deletion/recovery applies; retain edges and report `missing`. Restoring the same ID to the manifest resolves them.           |
| Duplicate chapter/reference     | New identity, no copied links. Reference duplicate copies content/tags, resets timestamps/revision/deleted state and starts with empty links. |
| Split chapter                   | Links stay on the original ID; no automatic assignment to the new chapter.                                                                    |
| Merge chapters                  | Links to the surviving ID remain; links to removed IDs become missing. Offer explicit retargeting, never infer content location.              |
| Remove/retarget edge            | Atomic source-record update with revision check and prior snapshot. Never alter the target or manuscript.                                     |

There is no automatic hard purge or retention deletion for reference tombstones,
history or drafts in v1. A future purge feature needs explicit confirmation and
recovery policy. Manual file deletion is handled as missing, not as permission to
erase incoming links. Scene/range linking is deferred until stable anchors and
their split/merge/migration semantics have a separate approved design.

## Operations, concurrency and failure preservation

Core provides list/read/create/update/delete/restore and link attach/remove/retarget
operations. Read returns the record plus a SHA-256 fingerprint of its exact bytes;
list returns valid summaries and structured content-free diagnostics. Update,
delete, restore and link operations require both expected revision and fingerprint
from the caller. Re-read under the existing project operation lock and reject
stale/missing/externally changed input without overwriting it. Serialize against
chapter changes, migrations, backup and other reference writes. Independent
external tools cannot be forced to obey this lock: recheck immediately before
publication and document that simultaneous non-cooperating writers are unsupported.

Ordinary updates and link mutations require an active source. Deleted records are
read-only until explicitly restored. Core keeps `created` immutable and assigns
`modified` no earlier than the previous value; delete assigns that same value to
`deletedAt`. Clients cannot change kind, ID or project membership through update.
Restore only clears the tombstone; restoring historical content is a separate
explicit recovery action using the current identity and next revision.

Create allocates a collision-checked UUID, validates the complete record and
targets, and exclusively publishes a flushed same-directory temporary file to a
previously absent destination (no overwrite-on-collision rename). A failed create
must not replace an existing file. An empty directory left after failure is benign.

For mutation, validate the proposed shape and changed edges first. Preserve the
previous valid exact bytes in `reference/history/<id>/<snapshot-id>.json` by an
exclusive, flushed write; independently reread and verify its SHA-256. A snapshot
is a complete ordinary versioned record, not a new wrapper. Failure to preserve
it aborts before replacement. Snapshot filename ID identifies the snapshot; the
embedded ID is the original record ID. Then stage a unique same-directory
`<id>.<operation-id>.tmp`, flush/close, reread/validate, recheck source fingerprint,
and atomically replace the authoritative file. Reuse the atomic-writer abstraction
with unique temporaries; do not assume its current cleanup behaviour preserves
drafts. The #161 reference service adds the durable recovery path below.

The single live-record replacement is the commit point. No manifest timestamp,
backlink file or chapter needs a second commit. Before it, failure leaves the
previous authoritative bytes intact and the edit dirty. After it, an acknowledgement
or cleanup failure is reconciled by rereading the destination fingerprint; do not
blindly replay a save or roll back a committed newer edit. Preserve history/drafts
in both cases. Directory durability and atomic replacement must be verified on
Windows/macOS/Linux; the guarantee is the existing filesystem atomic-writer
boundary, not protection against failing hardware or every power-loss scenario.

## Dirty state and crash recovery

Track a monotonically increasing editor edit generation separately from persisted
`revision`. Autosave follows the existing 750 ms idle policy; manual save/focus
loss/switch/close flush pending edits. Acknowledgement clears only the captured
generation, never edits made during the save. Failed saves retain visible dirty
state and content, offer retry and block navigation/close unless the author
explicitly discards edits. Linked navigation uses the same flush gate for both
manuscript and reference editors. Never mark the session clean with unsaved edits.

Persist recoverable drafts on that debounce and before a save attempt. A draft
write failure aborts the save attempt and leaves in-memory edits visibly dirty;
there is no promise to recover keystrokes not yet durably written before abrupt
process loss.
Recovery filenames are immutable draft UUIDs. Each UTF-8 strict JSON envelope has
exactly `schemaVersion: 1`, `projectId`, `recordId`, `draftId` (UUID v4),
`captured` (UTC timestamp), `generation` (positive safe integer),
`baseRevision` (positive safe integer or null for create), `baseSha256` (64
lowercase hex characters or null for create), and `record` (complete proposed v1
record). Both base fields must be null together; proposed revision is 1 for create
or base+1. IDs/project must agree with path/record; draft ID matches basename.
Draft payloads must satisfy structural validation; existing dangling edges are
allowed. An invalid form remains in memory with a validation error and cannot be
advertised as a durable recoverable record. Dirty drafts and snapshots are never
silently replaced by a later candidate.

On startup and before reference editing, scan drafts and unique temporary files
without deleting them. Compare hashes/revisions, not timestamp recency alone.
Already committed drafts are identified by the proposed record's canonical
serialized hash matching live data or an exact-byte validated history snapshot
for the same project, record and revision. This also recognizes a successful save
after subsequent saves have moved that revision into history. Such drafts remain
archived but are neither offered nor reapplied automatically. Revision numbers
alone do not prove a commit. Without matching evidence, a candidate remains
unresolved, including after incomplete scans or manual history deletion.
Valid draft/base pairs offer preview and explicit recover/discard/cancel.
Divergent bases or multiple
candidates require author selection; no last-writer-wins or automatic merge.
Unwrapped temporary files are untrusted candidates, never automatic replacements.
Recover saves through normal validation, snapshots and stale checks; current
valid data survives a failed recovery. Discard only removes the explicitly
selected candidate after confirmation. Corrupt candidates are retained with a
diagnostic. Reference recovery cannot overwrite manuscript recovery data and
does not block unrelated manuscript authoring.

Explicit recovery has two paths. For a valid live record, apply selected content
to its immutable identity using the current revision plus one and the ordinary
snapshot/stale-write protocol. Preview any divergent-base changes before approval.
For a missing or malformed live record, ordinary CRUD remains blocked, but a
separate confirmed recovery operation may restore a validated candidate of the
same project, ID and kind. Recheck the reviewed absence or exact corrupt-byte hash
under the project lock. Before replacing corrupt bytes, exclusively write them
unchanged to `reference/preserved/<record-id>/<copy-id>.bin`, flush and verify
their size/hash. This file is opaque recovery evidence, never a parsed snapshot;
preservation failure aborts recovery. Use the archive's 512 MiB per-file ceiling
for this streaming copy; larger inputs require independent preservation and
manual repair, without application overwrite. A missing target is published
exclusively; a corrupt target is atomically replaced only after preservation.
Choose a revision one above the maximum validated revision for this identity in
live data, snapshots and drafts (including the selected candidate); incomplete
scans, overflow, conflicting identities or unknown versions block this recovery.
Never overwrite an unsupported/newer-version record through recovery.
This exceptional path uses the already preserved candidate and reviewed
absence/corrupt-byte hash, rather than fabricating a valid base revision for an
ordinary draft envelope. After successful recovery, offer explicit discard of the
original candidate; if retained, it remains available for review and is never
automatically reapplied.

Recovery may retain unresolved edges already present in the selected candidate,
after showing their status for explicit approval; it must not silently delete
them or invent new targets. Validate their shape and uniqueness against all
other authoritative records. If valid recovery is impossible, retain the candidate
and current bytes for independent extraction. Raw preserved copies are included
in backup regardless of chapter-history selection and have no automatic retention
deletion. This exceptional recovery path does not permit ordinary CRUD to bypass
malformed/unsupported data elsewhere in the reference store.

For newly written reference records, canonical serialization recursively sorts
object keys by Unicode code-point order, preserves array order, uses JSON string
escaping, two-space indentation, LF newlines and a final LF, encoded as UTF-8.
Use those exact bytes both for a proposed-record hash and its eventual write.
Existing readable files may have different whitespace/key order; their stale-write
fingerprint and preserved snapshots always hash/copy the original bytes. Never
normalize an external file merely to make a recovery candidate appear committed.

## Validation, backups and migrations

Decode reference files with strict UTF-8 (no BOM); reject invalid byte sequences,
truncated JSON and duplicate keys at any depth before schema parsing. Do not
interpret corrupt or absent versions as v1. Reject missing, fractional, string,
zero or negative versions. A newer positive version is unsupported, never coerced.
Reject unknown fields at every object level, including nested link targets.
Future fields require a new component version and a defined reader/migration.
No generic extension bag, remote schema fetching or lossy round-trip is allowed.

Validate shape, path/embedded identity, project membership and cross-record/link
uniqueness before building indexes. Case collisions are errors on every platform.
Broken references produce resolution diagnostics while retaining the source.
Malformed records, unsupported fields and unknown versions remain byte-preserved
and block reference writes (not manuscript editing/export). Never repair by
dropping fields, renaming files, deleting edges or substituting an empty record.
Read-only inspection/ordinary-tool recovery remains possible.

Portable backups include active records, tombstones, `reference/history/`,
`reference/recovery/` and `reference/preserved/`
**even when optional chapter history is excluded**. These paths use ordinary UUID
JSON/bin names and fit the existing archive inclusion rules;
transient `.tmp` files remain excluded. Before backup, flush reference and chapter
editors; unresolved dirty writes abort backup. Require explicit recovery resolution
for unwrapped temporaries before archiving, so recoverable bytes are not silently
omitted. Structurally unsupported reference files can still be copied as opaque
bytes with a warning; never rewrite them merely to back up. Existing credential,
cache and transient exclusions still apply to arbitrary legacy author files;
report excluded reference paths in the local backup review (never logs), rather
than claiming that a portable archive is a complete raw recovery copy. Capture
the same fixed inventory and verify sizes/hashes under the existing project lock.

Restore keeps existing ZIP/path/checksum limits and new-folder-only staging.
Preserve IDs, bytes, tombstones, snapshots, drafts and opaque preserved copies;
rebuild links/search after
validation. Malformed/unsupported reference data yields a reference read-only
diagnostic, not a failed otherwise valid manuscript restore or dropped files.
Recovery candidates require explicit action before reference editing. A checksum,
unsafe path or project-schema failure still fails the entire restore and leaves
the active project unchanged. Backups contain private reference content: they
are project copies, distinct from manuscript publication exports.

No initial reference migration is needed for empty legacy projects, and no old
illustrative unversioned file is silently converted. Before a future reference
version conversion, preserve historical schemas and define exact from/to steps.
Use #111's complete verified recovery-copy and staging principles, not the
filtered ZIP as a substitute. Extend the migration journal with an explicit
component discriminator, target inventory/hashes and deterministic replay before
introducing that conversion; do not reinterpret its current v1→v2 fields. Block
reference writes and backup during an unfinished component migration, verify
backup/source/stage before commit, resume by journaled hashes on reopen, and
fail closed on mismatches. Retain the complete original copy. A future multi-file
conversion needs all-stage fault injection and cannot be released using isolated
atomic writes alone. This issue defines that compatibility obligation, not an
unneeded v1→v2 reference transformation.

## Search and export isolation

#167 reuses #118's local manuscript search primitives and adds bounded in-memory
reference indexing. Search all label/prose/tag/alias/source fields in active valid
records, with type filters; exclude tombstones, history and drafts. Default
matching reuses #118: literal, non-overlapping, ECMAScript Unicode simple case
folding with grapheme boundaries, without normalization, accent stripping or
locale-specific collation. Case-sensitive and whole-word options retain #118's
semantics; an empty query returns no hits. Each field/array item is searched
separately. No user regex, semantic inference or automatic replacement. Return
record IDs and field names; chapter hits retain #118 semantics. Results use
deterministic type then label/ID ordering, invalidate after edits/deletion, and
revalidate navigation targets.
Cancellation and generation checks prevent old queries replacing newer results.
Partial/limit diagnostics must be visible. Saved records are the search source;
flush the active editor before global search rather than quietly indexing stale
drafts. No SQLite service is needed; a future cache must be entirely rebuildable.

Reference content is not part of manuscript documents, publication matter, book
assembly, rendered semantic nodes or export resources. EPUB, editable DOCX and
print PDF must exclude all record prose, citations, tags, UUID link metadata,
drafts, history and reference paths, regardless of links or inclusion settings.
Reference changes do not alter manuscript bytes or published reading order.
Export reads its explicit manuscript/publication/assets inputs, never recursively
packages `reference/`. Malformed reference data does not invalidate an otherwise
exportable manuscript. Deliberate author copying of text into a chapter is normal
manuscript content; automatic reference appendices require a future explicit
feature, consent and separate contract.
An existing chapter UUID or a phrase independently present in manuscript content
may legitimately appear in an export. Exclusion means no data is sourced from
reference files, not removal of coincidentally matching manuscript values. Privacy
fixtures must use distinct reference-only canaries and inspect serialized metadata
as well as reading text; never assert that a linked chapter's ordinary export ID
must disappear.

## Implementation dependency graph

Edges below mean prerequisite → consumer. External prerequisites retain their own
issue gates; closure must be checked against merged code before each implementation.
The graph is the inspected GitHub graph, with #161's schema responsibilities made
explicit; no GitHub issue state or dependency is changed by this specification.

| Consumer         | Prerequisites / deliverable                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| #160             | #111; this complete design.                                                                                                                      |
| #161             | #160, #13, #110, #111; all five schemas, link shape/resolution primitives, safe storage, recovery, backup/restore and restricted IPC foundation. |
| #162, #163, #164 | #161; character, location, canon/note UI respectively.                                                                                           |
| #165             | #162, #163, #161; timeline ordering and association selectors using #161 links.                                                                  |
| #166             | #162, #163, #164, #165, #119; general links/backlinks and lifecycle/navigation UI.                                                               |
| #167             | #164, #165, #118; global local search.                                                                                                           |
| #168             | #166, #167, #125, #126, #130; integrated offline, recovery, archive and export evidence.                                                         |
| #203             | #168 plus its other technical gates; private working-app evaluation.                                                                             |
| #52              | After #203; final commercial allocation, then licensing/contribution/release gates.                                                              |

A topological order is external foundations → #160 → #161 →
{#162, #163, #164} → #165 → {#166, #167} → #168 → #203 → #52.
No reverse dependency on #52/#203 is permitted for this CORE implementation.
Scene anchors, attachments, cross-book chronology and automated continuity are
separate future design issues, not prerequisites for this sequence.

## Required fixture and test matrix

These are implementation acceptance tests for #161–#168, **not claims of tests
already passing for an unimplemented feature**. Use synthetic public-safe data and
the existing fixture-copy helpers; keep historical fixtures unchanged.

| Fixture / fault                             | Required assertions                                                                                                                                                                                                                                                                           | Owner                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Empty new v2 project                        | Read without writes; first create/reopen of all five kinds; strict shape and UUID paths; deterministic order/search.                                                                                                                                                                          | #161, #162–#165       |
| Legacy v1 / v2, no references               | Verified v1→v2 recovery copy; manuscript bytes/order unchanged; no reference seeding or descriptor changes.                                                                                                                                                                                   | #161                  |
| Legacy author files / future fields/version | No guessing/stripping/overwrite; explicit read-only reference diagnostic; ordinary manuscript works.                                                                                                                                                                                          | #161                  |
| All fields and Unicode                      | Round-trip examples, every canon category, empty optional prose, fictional/absent dates, negative sequence/ties, NFC/NFD search.                                                                                                                                                              | #161, #165, #167      |
| Malformed input                             | Invalid UTF-8/BOM/JSON, duplicate keys, truncated files, wrong types/versions, unknown fields, excessive size/count, path/ID/project mismatch retained.                                                                                                                                       | #161                  |
| Duplicate/case-colliding record or link IDs | Reject ambiguity across types/files, no arbitrary resolution or mutation.                                                                                                                                                                                                                     | #161                  |
| Failed create/save/delete/restore           | Inject before/after snapshot, draft, temporary flush, replacement and acknowledgement; previous valid bytes or confirmed committed revision retained; retry without duplicate commit.                                                                                                         | #161                  |
| Dirty/save race and crash                   | Captured generation only acknowledged; latest edits stay dirty; draft-write failure visible; restart recover/discard/cancel, divergent candidates and failed recovery preserve originals.                                                                                                     | #161–#166             |
| Earlier committed drafts / repeated reopen  | Save revisions 1, 2 and 3, then reopen: exact history evidence recognizes drafts for earlier commits without reapplying them. A same-number/different-hash draft still requires review; incomplete scans never prove commitment.                                                              | #161                  |
| Missing/corrupt live record recovery        | Preserve corrupt bytes in a verified opaque copy before replacement; failure leaves bytes unchanged. Missing targets use exclusive publication; validated revision maximum, unchanged-source check and explicit approval prevent stale overwrite. Unsupported versions are never overwritten. | #161                  |
| Stale or external edits                     | Revision/hash conflicts, write serialization and changed inventory rejection; no lost update.                                                                                                                                                                                                 | #161                  |
| Renamed/deleted/missing/invalid targets     | Edges retain IDs; correct statuses, no cascade; target restoration resolves; malformed sources report incomplete backlinks.                                                                                                                                                                   | #161, #165, #166      |
| Chapter duplicate/split/merge               | Original/surviving links remain; new IDs get no inferred links; removed IDs unresolved; explicit retarget succeeds.                                                                                                                                                                           | #166                  |
| Backups, history off/on                     | Raw byte/hash inclusion of all references, deleted payloads, history/drafts independent of chapter-history flag; flush failure prevents archive; unsafe entries fail.                                                                                                                         | #161, #168            |
| Restore / corrupt archive                   | New-folder collision handling, checksums, IDs, links and search rebuilt; unsupported references preserved read-only; active project untouched on failure.                                                                                                                                     | #161, #168            |
| Future migration harness                    | Retain old schemas, complete recovery copy and journal; inject interruption at every stage and during replay, reject source/hash mismatch and unknown newer versions.                                                                                                                         | Future version change |
| Security / IPC                              | Traversal, symlink/junction substitution, unauthorized session/sender, excessive payloads, inert rendering; no private content in logs.                                                                                                                                                       | #161–#168             |
| Search/nav                                  | Type filters, deletion refresh, cancellation/stale queries, bounded large fixture, dirty navigation failure and keyboard access.                                                                                                                                                              | #167, #168            |
| Export privacy canaries                     | Unique private strings in every record field, links, drafts and history absent from unzipped EPUB/DOCX XML/resources and extracted PDF text/metadata; manuscript control text present. Broken references still permit export.                                                                 | #168                  |
| Offline Community                           | Disconnect network, no account/Pro checkout; CRUD, linking, search, backup/restore and all three exports function on supported platform candidates.                                                                                                                                           | #168, #203            |

## Acceptance and remaining decisions

All five #160 acceptance criteria are specified here: schemas/layout/examples;
atomic CRUD/recovery/deletion/backup/migration; chapter links and deferred anchors;
CORE scope and post-#203 candidates; export exclusion and the fixture matrix with
reconciled source documents. The dependency order is acyclic. No unanswered
architecture decision blocks #161. Future anchor design, attachment semantics,
component-version migrations, hard purge/retention and commercial allocation are
explicitly deferred, not silently authorized. Runtime validation, platform durability
evidence and the fixture matrix remain obligations of the implementation issues.

Specification verification on 14 October 2026: frozen-lockfile install, `pnpm lint`,
`pnpm format:check`, `pnpm typecheck`, `pnpm test` (93 files, 1,015 tests),
`pnpm build` and `pnpm check:workspace` passed. The latter also passed the
Community boundary checks. A one-off documentation check validated all five JSON
examples against the field/type/version/UUID/date/limit rules above, their link
targets against the declared synthetic project context, the documented dependency
graph for cycles and 147 local documentation link targets. `git diff --check`
passed. Build output retains the existing Vite large-chunk warning; install
reported ignored dependency build scripts. Neither prevented the checks passing.
No new runtime schemas were introduced. Electron E2E, coverage measurement and
cross-platform reference durability tests were not run for this documentation-only
change; reference behaviour still requires the implementation matrix above.

The pre-PR review additionally reconciled committed draft recognition across
later saves, explicit recovery of missing/corrupt live records with preserved
raw bytes, bounded auxiliary scans, inventory-based backlink consistency and
export canaries that distinguish private reference data from shared chapter IDs.
The dependency table was parsed and compared with the live #161–#168 issue
prerequisites; all matched and the documented graph remained acyclic.
