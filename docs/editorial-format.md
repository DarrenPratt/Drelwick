# Proposed editorial format: project v3, chapter v2, editorial v1

This is the #169 versioned format contract. [Workflow and failure semantics](editing-revisions.md)
are normative. The #170 branch adds exported runtime schemas and a partial core
implementation. This status is branch-specific and does not imply that all
acceptance criteria are implemented.

## #170 implementation status on the working branch

Implemented: strict project v3/chapter v2/editorial v1 runtime schemas; empty
revision envelope validation; v2-to-v3 verified backup and recoverable atomic
multi-file migration service; transaction generation and recovery; annotation
thread CRUD/tombstones/explicit reattachment; archive inclusion; v3 chapter
save, structural chapter lifecycle, and history restore preservation; accessible
basic sidebar and private-export isolation. Existing project open/create still
uses v2. The sidebar offers a confirmed upgrade for an open chapter and invokes
the verified core migration before exposing annotation actions.

Incomplete: ProseMirror StepMap remapping is a helper only and is not connected to
editor transactions or atomic save; companion undo metadata is absent; drafts
are described by schema but not staged/recovered/offered; editor dirty-state and
annotation state are not one captured autosave bundle; import anchor policy,
crash/reopen recovery offers, and required A01-A10/F02-F06/M01-M02 coverage remain
incomplete. The decoration plugin removes stale marks on edit and the core marks
anchors unverified, which prevents unsafe navigation but does not meet the
required automatic remapping contract. #170 must remain open until these paths
are implemented and validated.

## Encoding and shared primitives

All objects below are strict, with every listed field required unless explicitly
optional. Unknown fields/versions cause an unsupported diagnostic and preserve
the bytes; never strip them on read. JSON uses UTF-8, no BOM, duplicate keys,
unpaired surrogates or NUL. New writes use two-space indentation, LF and final LF.
IDs are lowercase UUID v4; retain the exact spelling of existing project/chapter
IDs during migration (historical UUID spelling remains readable). New IDs never
reuse a deleted identity. Cross-file uniqueness and ownership are semantic checks.

`Time` is a real UTC timestamp with milliseconds and `Z`; enforce
created ≤ modified; deletion/resolution times, when present, lie in that interval. `Counter` is a
positive safe integer; overflow fails without writes. `Hash` is lowercase SHA-256.
File hashes cover exact UTF-8 bytes. Document/slice equality and document hashes
use `canonical-json-v1`: recursively sort object keys by Unicode code-point order,
retain array order and string code points, emit compact JSON without final LF and
hash UTF-8 bytes. This is a Drelwick codec, not a claim of JCS conformance. Mark
sets in emitted documents follow the pinned editor schema rank; structural
validation and exact slice comparison never silently reorder a stored document.

`Doc` is the existing supported semantic `doc` tree. `SliceV1` has exactly
`content: Node[]`, `openStart: nonnegative integer`, `openEnd: nonnegative integer`.
It uses existing semantic nodes/marks, not editorial extensions. Open depths must
be compatible with the slice tree and target replacement. An empty slice is
`{ "content": [], "openStart": 0, "openEnd": 0 }`. Validating only node names is
insufficient: decode using the pinned ProseMirror schema, apply the replacement,
validate the complete resulting `Doc`, and compare the serialized result. The
codec identifier is `semantic-slice-v1`; unknown codecs cannot be applied.

## Authoritative layout and envelopes

```text
project.json                         project schema 3
format.json                          descriptor schema 2
book.json                            existing schema 1
manuscript/<chapter-id>.json          chapter schema 2
editorial/state.json                  editorial schema 1
editorial/restore-conflicts/<id>.json  restore-conflict schema 1
.editorial/transactions/<id>/         transaction manifest + before/after images
.editorial/drafts/<id>.json            complete draft descriptor + staged images
snapshots/manuscript/<id>/snapshot.json
snapshots/manuscript/<id>/deleted.json optional deletion marker
snapshots/manuscript/<id>/files/...    exact captured project-relative bytes
```

Keep existing assets, references, publication/presentation/print components and
periodic history paths. No paths derive from a title, label or comment. The new
directories are managed, not arbitrary renderer destinations. Existing archive
allowlists must be extended deliberately in #170/#171; current archive behaviour
does not prove these new files are included.

| Envelope           | Exact fields and constraints                                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project v3         | Existing v2 fields `projectId`, `created`, `modified`, `bookFile`, `formatFile`, `manuscript: {order: UUID[]}`; `schemaVersion:3`, `generation:Counter`, `editorialFile:"editorial/state.json"`. Preserve unrelated old extension bytes in the migration recovery copy; do not reinterpret unsupported envelope extensions. |
| Format v2          | `schemaVersion:2`, `projectId`, `bookSchemaVersion:1`, `chapterSchemaVersion:2`, `editorialSchemaVersion:1`, `sliceCodec:"semantic-slice-v1"`, `hashCodec:"canonical-json-v1"`.                                                                                                                                             |
| Chapter v2         | Existing `id`, `type`, `title`, `status`, `created`, `modified`, `content:Doc`; `schemaVersion:2`, `revision:Counter`, `review:ReviewV1`. Existing type/status enumerations remain unchanged.                                                                                                                               |
| Review v1          | `schemaVersion:1`, `mode:"off"\|"track"`, `proposed:Doc`, `pending:RevisionGroupV1[]`. Empty pending requires exact accepted/proposed equality.                                                                                                                                                                             |
| Editorial state v1 | `schemaVersion:1`, `projectId`, `generation:Counter`, `anchors:AnchorV1[]`, `annotations:AnnotationV1[]`, `threads:ThreadV1[]`. Generation must equal the root manifest at every completed commit.                                                                                                                          |

`RevisionGroupV1` has `schemaVersion:1`, `id`, `kind:insert|delete|replace|format`,
`created`, `modified`, `authorLabel:string|null`, `baseHash:Hash`, `from`, `to`,
`before:SliceV1`, `after:SliceV1`, and `supersedes:UUID[]`. Positions are safe
integers with `0 ≤ from ≤ to ≤ accepted.content.size`; ID lists are unique.
Every group's base hash must equal the chapter accepted document hash. Insert
requires an empty before and equal endpoints; delete requires nonempty before and
empty after; replace requires both nonempty; format requires unchanged text/atom
sequence and a real semantic formatting difference. Exact no-ops are invalid.
All before slices must exactly match their addressed base ranges. Store pending
groups in ascending `(from,to,id)` order; even touching ranges cannot coexist.
Replay descending order using verified replacements must equal proposed content.
`supersedes` names retained prior groups, never active unrelated groups or self.
Retained transaction inventories supply prior group evidence; no opaque plugin
step payload is stored or executed.

## Anchors, threads and annotations

| Record          | Required fields                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EvidenceV1`    | `chapterId`, `documentHash`, `from`, `to`, `slice:SliceV1`, `prefix:string`, `suffix:string`; full original selected slice, at most 32 graphemes each of context.                                                                                        |
| `LiveSegmentV1` | `chapterId`, `chapterRevision:Counter`, `documentHash`, `from`, `to`, `pointAffinity:"right"`; point uses equal endpoints, range uses start +1 / end -1 regardless of pointAffinity.                                                                     |
| `LostSegmentV1` | `evidence:EvidenceV1`, `reason:"deleted-text"\|"deleted-chapter"\|"history-restore"\|"snapshot-restore"\|"superseded-revision"\|"external-change"`, `revisionGroupId:UUID\|null`.                                                                        |
| `AnchorV1`      | `schemaVersion:1`, `id`, `created`, `modified`, `deletedAt:Time\|null`, `status:"attached"\|"partial"\|"orphaned"\|"unverified"`, `original:EvidenceV1`, `segments:LiveSegmentV1[]`, `lost:LostSegmentV1[]`.                                             |
| `AnnotationV1`  | `schemaVersion:1`, `id`, `anchorId`, `threadId`, `kind:"comment"\|"note"\|"highlight"`, `colour:"yellow"\|"blue"\|"green"\|"pink"\|null`, `created`, `modified`, `deletedAt:Time\|null`. Colour is null except for highlights.                           |
| `CommentV1`     | `schemaVersion:1`, `id`, `body:string`, `authorLabel:string\|null`, `created`, `modified`, `deletedAt:Time\|null`. Body is plain Unicode, may be empty after explicit edit, at most 100,000 scalar values.                                               |
| `ThreadV1`      | `schemaVersion:1`, `id`, `state:"open"\|"resolved"`, `resolvedAt:Time\|null`, `created`, `modified`, `deletedAt:Time\|null`, `comments:CommentV1[]` in creation order with UUID tie-break. Open requires null resolvedAt; resolved requires a timestamp. |

Attached requires live segments and no lost segments; partial requires both;
orphaned requires no live segments and retained original/lost evidence. Unverified
retains all last-known data but forbids range navigation. Live segments sort by
current manifest order, then `(from,to)`; no duplicate or overlapping segments in
one anchor. Separate anchors may overlap arbitrarily. Segment chapter IDs must be
manifest-listed and hashes/revisions must match proposed documents. All positions
are valid schema/grapheme boundaries. Prefix/suffix and original slice are never
rewritten to claim a new original attachment; explicit reattach retains original
evidence and prior live segments in the safety transaction, keeps the anchor ID
and assigns explicitly selected new live segments.

The state graph is one annotation → one anchor and one thread, all unique within
the project including tombstones. A thread cannot be silently reassigned to a
different annotation. Thread/comment IDs survive resolution, remapping and undo;
duplicates allocate new IDs only through explicit copy. Dangling ownership or ID
collisions make the editorial bundle invalid rather than choosing an arbitrary
record. Comments on a deleted revision slice use an orphan/partial anchor whose
lost evidence names the group; this is navigable in retained review detail, not
the live editor. Deleting/restoring an annotation updates its owned anchor/thread
tombstones in the same transaction without erasing individual comment tombstones.

## Transaction, draft, snapshot and comparison schemas

`TransactionV1` contains exactly `schemaVersion:1`, `id`, `projectId`, `kind`
(`edit|annotation|review|structure|restore|migration`), `created`, `owner`
(`host`, `processId`, `processStarted`), `phase`
(`prepared|committed|rolling-back|rolled-back|rolling-forward|complete`),
`expectedGeneration`, `nextGeneration`, `files`, `decisions`.
`nextGeneration = expectedGeneration+1`. `files` is a sorted array of
`{path,before:ImageRef|null,after:ImageRef|null}`; at least one side exists.
`ImageRef` is `{size,sha256}` and the retained image is at `before/<path>` or
`after/<path>` beneath the operation directory. `decisions` contains
`{chapterId,groupId,action:"accept"|"reject"|"supersede",replacementGroupId:UUID|null}`.
Only supersede has a replacement ID. IDs/preconditions, not display text, define
the reviewed operation. No arbitrary script or shell command is part of a journal.

`DraftV1` contains `schemaVersion:1`, `id`, `projectId`, `created`, `baseGeneration`,
`editorGeneration`, `baseInventoryHash`, `files:[{path,size,sha256}]`; each file is
stored beneath `.editorial/drafts/<id>/files/` (the descriptor filename is
`.editorial/drafts/<id>.json`). It captures the complete dirty transaction scope,
not a chapter document with missing thread updates. A draft's hashes must verify
before preview/apply. Invalid candidates stay on disk with a diagnostic. Exact
committed inventory evidence, not timestamp/revision alone, identifies an already
saved draft. Explicit discard acts only on the selected candidate ID/hash.

`SnapshotV1` contains `schemaVersion:1`, `kind:"manuscript-snapshot"`, `id`,
`projectId`, `created`, `label` (nonblank, ≤500 scalars),
`reason:"named"|"before-review"|"before-restore"`, `generation`, `chapterOrder`,
`files:[{path,size,sha256}]`, `absent:string[]`, `exclusions:string[]`.
Inventory paths are unique, sorted, relative `/` paths; each image lives under
`files/<path>`. Include `project.json`, `format.json`, `book.json`, editorial state
and complete ordered chapters. Optional source components are either inventoried
or explicitly absent. Include existing conflict collections and review evidence
needed by included records. Exclusions are exactly `reference`,
`application-settings`, `other-snapshots`, `periodic-history`. No external path,
symlink, archive traversal or implicit URL fetch is allowed. Validate complete
content and inventory hashes, not only the manifest's syntax.

`SnapshotDeletionV1` contains exactly `schemaVersion:1`, `snapshotId:UUID`,
`deletedAt:Time`, and `manifestHash:Hash`. Its presence marks that exact immutable
snapshot deleted. Verify the manifest hash before deletion or undelete; mismatch
blocks the operation. Publication/removal is atomic and returns an operation
receipt; it never removes the captured images.

`RestoreConflictV1` contains `schemaVersion:1`, `id` (restore operation ID),
`projectId`, `sourceGeneration`, `restoredSnapshotId`, `created`, and `entries`.
Each entry is `{annotation:AnnotationV1,anchor:AnchorV1,thread:ThreadV1,
reason:"current-only"|"different-version",disposition:"unresolved"|"copied"|"reattached"|"discarded"}`.
Retain original payloads even after a disposition changes. Copy/reattach receipts
belong to the ordinary transaction inventory; never invent a new automatic winner.

`ComparisonV1` is transient, not a new authoritative project file: `schemaVersion:1`,
`algorithm:"semantic-grapheme-v1"`, `left`, `right`, `complete:boolean`,
`changes`, `diagnostics`. Each source token contains kind (`snapshot|captured-current`),
ID, project ID, generation, inventory hash, `label:string`, `created:Time`,
and projection (`accepted|proposed`). Each change is
`{ordinal,kind,chapterId,oldLocation,newLocation,before,after}`. Ordinals are consecutive
zero-based integers; kind uses the workflow vocabulary. Chapter ID is nullable
only for book metadata. A location is null or `{nodePath:number[],from,to}` with
nonnegative integer indices and ordered ProseMirror positions. Before/after are
null, `{type:"slice",value:SliceV1}`, or `{type:"metadata",value:JSONValue}`;
metadata permits only finite JSON values with depth at most 64.
Diagnostics are `{source:"left"|"right",chapterId:UUID|null,assetId:UUID|null,
code:"MISSING_ASSET"|"UNSUPPORTED_VERSION"|"LIMIT"|"INVALID_SOURCE"}`, not raw exceptions.
No apply operation accepts these diff entries as commands.

## Resource and security requirements

Initial ceilings: 10,000 chapters, 100,000 annotations/project, 10,000 comments/thread,
10,000 segments/anchor, 1,000 pending groups/chapter, 8 MiB per chapter or editorial
state component, 256 MiB total semantic/editorial capture, 512 MiB per asset and
2 GiB total snapshot including assets, 10,000 inventory files. All limits are
checked before publication. Reaching a limit blocks the affected new operation,
retains the draft, and offers independent export/backup/review; no silent
truncation, auto-pruning or paid unlock. A later chunked editorial-state format
requires a new component version. A complete valid project that exceeds snapshot
limits remains editable; snapshot reports its resource failure explicitly.

IPC accepts only authorized project IDs, stable record IDs, bounded semantic DTOs,
expected revisions/hashes and explicit operation tokens. Validate sender/top frame,
project ownership and payload sizes before resolving paths. Resolve generated paths
under the authorized real root; reject traversal, symlink/junction substitution,
nonregular files, case-colliding IDs and unsupported ancestors. Retain Electron
sandbox/context isolation and disabled Node integration. Use fixed error codes
`EDITORIAL_STALE`, `EDITORIAL_INVALID`, `EDITORIAL_UNSUPPORTED`,
`EDITORIAL_LIMIT`, `EDITORIAL_RECOVERY_REQUIRED`, `SNAPSHOT_INCOMPLETE`,
`COMPARISON_LIMIT`; render located private detail only in the trusted UI, not logs.

## Migration, old history and independent recovery

#170 implements v2→v3 using #111's complete recovery-copy, staging, verification,
commit and restart principles. First finish any existing v1→v2/replacement recovery.
Create a byte-verified complete backup before any version gate changes. Stage v3
manifest, format v2, empty editorial state and chapter-v2 envelopes. Preserve each
old semantic document **exactly**, with `content=review.proposed`, empty pending,
mode off and initial counters 1. Preserve IDs, chapter type/title/status/timestamps,
assets, references, publication/settings and all old history bytes. Unsupported
extensions/content block migration; never discard them to make the schema pass.
Inventory all originals, reject concurrent external changes, and test interruption
at every stage. Do not modify the stable v1→v2 transform or use its journal version
for this different transition. No downgrade-in-place exists.

Old readers reject project v3 before writing or exporting; do not leave a v2
manifest pointing to chapter-v2 files. A new reader keeps historical v1/v2 read
support and uses explicit migration to edit. Old periodic history remains v1 and
text-only. The #170 working branch routes v3 restore through complete transaction
preservation and orphans affected anchors while retaining evidence; it does not
reinterpret history-v1 content as a full review bundle. #120 list/preview UI is
reused, with scope labels and restore preconditions from the workflow design.

Independent recovery can read `content` for accepted text and `review.proposed`
for proposed text, extract discussions from editorial JSON and inspect pending
before/after slices with ordinary JSON tools. Both states remain available even
without ProseMirror. A corrupt replay cache is diagnostic, not automatic acceptance:
copy original files before extracting either projection. Full restoration must
respect transaction phase/inventory hashes. Backups must preserve all current
editorial, draft, conflict, named-snapshot and retained transaction files regardless
of the optional periodic-history setting; do not recursively snapshot snapshots.
