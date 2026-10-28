# #169 delivery contracts and validation matrix

Design owner: #169, CORE. Normative specifications:
[workflow](../editing-revisions.md) and [format](../editorial-format.md).
This document allocates missing implementation work to **existing** issues;
it does not claim those issues are complete or authorize implementation in #169.

## Existing issue reconciliation

| Issue                     | Existing dependencies retained | Required scope clarified by this design                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #170 comments/annotations | #169, #119                     | Own the project-v3/chapter-v2 gate, v2→v3 migration, shared editorial transaction and draft recovery, strict annotation/thread/anchor schemas, mapping plugin, companion undo metadata, tombstones, orphan UI, split/merge maps, #120 restore integration, archive inclusion and private export exclusion. Initialize revision envelopes empty; reject nonempty pending data until #173 is supported. No revision-review UI is required here.                    |
| #171 named snapshots      | #169, #110, #120; **add #170** | Capture text **and** editorial state using the shared transaction/generation boundary. Own immutable manifests, full asset closure, named retention/deletion, before-restore safety capture, restore conflict collection and v3 restore. Do not reproduce chapter history or archive tooling. Provide the manifest/token contracts needed by #172 and #173.                                                                                                      |
| #172 comparison           | #171                           | Already covers the requested comparison feature; no duplicate issue is needed. Adopt explicit accepted/proposed inputs, deterministic semantic-grapheme diff/ties, unsupported/limit diagnostics and read-only output. Initial delivery may compare projects without pending groups; nonempty revision projections must be supported/verified with #173 before the full editing workflow is called complete. Coordination with #173 is not a reverse dependency. |
| #173 revision mode        | #169, #171, #170               | Own normalized disjoint revision patches, supported formatting, explicit combine consent for overlaps, mode-off collision rules, exact accept/reject and batch review, companion undo/redo, all edit-command integrations, projected export/preview choices, import warnings and end-to-end privacy/recovery tests. Use #171 safety captures and #170 persistence; do not create another journal/history implementation.                                         |

The added #170→#171 dependency reflects actual data/transaction ownership. The
acyclic order is #169 → #170 → #171 → #172, with #170 and #171 → #173.
No dependency on #52 or #203 is introduced. Product classification remains CORE;
possible later commercial candidates are described only as owner-review options.
Existing #110/#111/#119/#120 services are implementation prerequisites to reuse,
not features to reimplement. Each follow-up remains one focused implementation PR.

## Package contracts

`packages/project-model` owns immutable historical schemas, project/descriptor/
chapter/editorial versions, semantic slice validation, transaction/draft/snapshot/
conflict schemas, IDs/ownership/limits and migration compatibility. Define
`validateEditorialBundle(project, chapters, state)` returning located fixed-code
diagnostics. Validate hashes, derived proposed replay, pending disjointness and
anchor revision targets; schema shape alone is insufficient. Retain historical
schema modules, including chapter/history v1.

`packages/core` owns pure `mapAnchors(before, after, maps, companionDelta)`,
`normalizeRevision(base, pending, transaction) -> preview|combineRequired|error`,
`projectRevision(chapter, accepted|proposed)`, `planReview(expected, ids, action)`
and `compareSnapshots(leftToken, rightToken, options, signal)`. Results never write
until explicitly committed. Core owns `commitEditorialTransaction`,
`recoverEditorialTransaction`, `captureNamedSnapshot`, `previewSnapshotRestore`
and `restoreNamedSnapshot` over injected filesystem/clock/UUID adapters. Reuse the
existing lock, atomic writer, inventory/hash and archive helpers; no Electron or
renderer-only implementation belongs here. Derive index caches from authoritative
files. Pure mapping must use the pinned ProseMirror semantics through a reviewed
renderer-safe adapter/subpath; add its direct dependency if needed, not an import
from desktop into core. Internal APIs are not a public plugin SDK.

`apps/desktop` owns the existing TipTap plugin integration, decoration/sidebar
and review controls, labelled choices/focus, dirty-state and save/discard/cancel
coordination, source preview tokens, cancellation generations and restricted
main/preload IPC. A proposal is a DTO, not authority to write arbitrary paths.
Main validates sender/project/token, bounds work, resolves UUIDs and invokes core.
Keep `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`. Shared
transport-only DTOs may live in `packages/shared`; persistent schema ownership
stays in project-model. No Pro dependency is permitted.

Every mutating request carries `{projectId, expectedGeneration, expectedFiles,
operationId, command}`; `expectedFiles` is a bounded ID→hash inventory, never
renderer-controlled paths. A successful receipt identifies operationId, committed
generation, updated chapter revisions, acknowledged editor generation and warnings.
Retrying the same operationId with the exact same payload returns the original
receipt; reusing it for different bytes is rejected. An unknown IPC outcome must
query that receipt/recover before another write, never guess or generate a duplicate
review operation. Snapshot/compare/export preview tokens are opaque, scoped to the
active authorized session and invalidate on generation, source hash or option change.

## Synthetic fixtures and deterministic expected outcomes

`docs/examples/editorial-v1/cases.json` is a versioned fixture catalogue, not a
runtime project file. Exact positional examples use a single paragraph `red fox`:
text begins at ProseMirror position 1; `fox` is `[5,8)`. Tests execute the proposed
schema/example checks and elementary real ProseMirror map/slice/replay examples.
The matrix below specifies **future integration tests**, including injected writes
and process termination; prose expectations are not claims of runtime coverage.

| ID  | Input / operation                                                                    | Required observable result                                                                                                                  | Owner     |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| A01 | Insert `quick ` at 5 before fox `[5,8)`                                              | Fox becomes `[11,14)`; inserted text is outside annotation.                                                                                 | #170      |
| A02 | Insert `!` at 6 inside fox                                                           | Range `[5,9)`; no loss; original evidence unchanged.                                                                                        | #170      |
| A03 | Insert at end 8; point at 8                                                          | Range stays `[5,8)`; point moves to 9.                                                                                                      | #170      |
| A04 | Delete `[6,7)`                                                                       | Surviving target `[5,7)`, status partial, removed `o` retained; undo restores exact original attached state.                                | #170      |
| A05 | Replace `[5,8)` with another `fox`                                                   | Original target orphaned despite identical visible spelling; no quote reattachment.                                                         | #170      |
| A06 | Bold `[5,8)`; combining `é`, surrogate emoji, joined emoji fixtures                  | Format maps preserve positions; invalid mid-grapheme selections rejected; undo/redo restores marks and companion metadata.                  | #170/#173 |
| A07 | Two annotations `[1,6)`, `[5,8)` and a deletion crossing both                        | Independently map both, preserve both discussions and lost slices; no exclusive-range rule for annotations.                                 | #170      |
| A08 | Split `red fox` at 5 with annotation `[1,8)`                                         | Left `red ` segment `[1,5)` under original ID; right `fox` `[1,4)` under new ID; one anchor/thread with two segments.                       | #170      |
| A09 | Merge paragraphs `red ` and `fox`                                                    | Right segment shifts by first doc `content.size=6`, giving `[7,10)` in survivor; no newline/offset guessing.                                | #170      |
| A10 | Same title/text imported to a new project; paste into old project                    | Imported project gets new IDs/no inherited discussions; paste uses actual maps.                                                             | #170/#173 |
| R01 | Insert `quick ` at 5, then edit inside insertion                                     | Preview one combined group; Cancel leaves old proposed text/group unchanged; confirm records superseded ID and new group.                   | #173      |
| R02 | Two touching/overlapping pending edits                                               | Explicit union-group preview; no order-dependent independent patch application.                                                             | #173      |
| R03 | Disjoint insertion and deletion; accept one/reject other in either legal order       | Same final semantic result, remaining before slices validate; distinct annotations preserve identity.                                       | #173      |
| R04 | Toggle tracking off with pending deletion; edit its collapsed point                  | No acceptance; prompt track/combine, review-first or cancel.                                                                                | #173      |
| R05 | Pending format-only group; accept/reject then undo/redo                              | Exact semantic before/after and group/anchor state; counters advance even on undo.                                                          | #173      |
| R06 | Stale preview after another save or external edit                                    | Entire review fails `EDITORIAL_STALE`; no partial decisions or file writes.                                                                 | #173      |
| F01 | Crash while review dialog open, before any command                                   | Disk unchanged; saved pending groups reopen; unpersisted keystrokes are not falsely reported recovered.                                     | #173      |
| F02 | Fail safety copy, draft fsync, staging, first/last publication or journal commit     | Before commit: all prior valid files restored or recovery blocked with preserved images; latest live draft stays dirty.                     | #170/#173 |
| F03 | Terminate after first after-image, before commit marker                              | Recover rollback to complete before generation; offer complete after bundle as explicit draft.                                              | #170      |
| F04 | Terminate after committed marker, before acknowledgement                             | Recover complete after generation; retry operation ID returns one original receipt.                                                         | #170/#173 |
| F05 | Interrupt rollback/rollforward; inject external changed hash/missing image           | Resume same direction only for known before/after bytes; otherwise block without overwriting external data.                                 | #170      |
| F06 | Edit B arrives while save A is in flight; A fails/succeeds                           | A acknowledgement never clears B. Failed navigation/quit leaves B visible and session unclean.                                              | #170/#173 |
| S01 | Two chapters + shared image + pending deletion image + unsaved comment               | Flush all; snapshot contains exact saved full scope and both asset closures, one generation, no partial success.                            | #171      |
| S02 | Snapshot image copy fails or file changes during capture                             | No published snapshot manifest; retain staged data/diagnostic; current project unchanged.                                                   | #171      |
| S03 | Restore with dirty current-only thread and same-ID differing thread                  | Flush, verified before-restore safety, restore snapshot, retain both conflicts with source generation; no loss.                             | #171      |
| S04 | Restore interrupted at each transaction boundary                                     | Complete pre- or post-restore state according to commit marker; snapshot never consumed.                                                    | #171      |
| S05 | Repeated snapshot labels; periodic history prunes; selected snapshot deleted         | Labels do not collide, named snapshots remain; stale selection cannot restore a different ID.                                               | #171      |
| C01 | Identical versions; formatting only; emoji; moved/removed chapter; scene break/image | Empty diff / mark change / grapheme-safe edit / explicit structural changes; deterministic tie goldens and source bytes unchanged.          | #172      |
| C02 | Missing asset, newer schema, large novel, cancelled/replaced query                   | Located unavailable/incomplete result, no false equality; stale comparison never replaces newer output.                                     | #172      |
| E01 | Base `red fox`, pending insert `quick ` at 5                                         | Export accepted=`red fox`, proposed=`red quick fox`, cancel=no output; pending group unchanged in every case.                               | #173      |
| E02 | Pending deletion or formatting; generation changes after choice                      | Selected state controls text/marks; changed source requires new choice. No silent reject/accept.                                            | #173      |
| E03 | Unique private canaries in every editorial field and retained slice                  | EPUB/DOCX/PDF publishing contains no private canary/metadata; chosen manuscript control text is present. Ordinary DOCX has no review parts. | #170/#173 |
| E04 | DOCX import with unresolved tracked text/comments                                    | Explicit supported text projection/warning or reject conversion; never silent flattening.                                                   | #173      |
| M01 | v2 project with Unicode/assets/references/history and unsupported extension          | Supported migration preserves semantics/bytes outside envelopes; unsupported input blocks and survives; every interruption recoverable.     | #170      |
| M02 | Open v3 with v2 app; malformed/newer editorial component; unsafe IPC paths           | Reject without writes; preserve files; no downgrade, arbitrary access or private log payload.                                               | #170      |

Failure injection must cover both file APIs and killed child processes at journal
phase/rename boundaries, plus repeat recovery. Windows/macOS/Linux tests must
record actual durability limits. Fixtures are synthetic and redistributable; no
author manuscript or private reference content is needed.

## Design acceptance review

| #169 criterion                                                | Decision / design evidence                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Schemas, stable anchors and remapping                         | PASS — strict versioned format, mapping/operation table, A01–A10                                                 |
| Revision mode and explicit review with undo/autosave/recovery | PASS — disjoint patch normalization, explicit overlap consent, review protocol, R01–R06/F01–F06                  |
| Named consistent snapshots and comparison                     | PASS — immutable captured scope, safety restore/conflicts, versioned deterministic diff, S01–S05/C01–C02         |
| Explicit pending-revision export choice and privacy           | PASS — per-operation accepted/proposed/cancel, output allowlist and E01–E04                                      |
| CORE scope and post-#203 commercial review                    | PASS — no commercial prerequisite or moved functionality                                                         |
| Failures, compatibility and focused implementation contracts  | PASS — v3 gate/migration, transaction/draft schema, package ownership, existing follow-up allocation and M01–M02 |

These PASS entries evaluate **design completeness**, not shipped editorial features.
No unresolved choice blocks #170. Runtime implementation, crash/fault integration,
full comparison goldens, export canaries and platform/accessibility validation
remain the assigned follow-ups' acceptance obligations.

## Design validation and changed files

Validation on 28 October 2026: frozen-lockfile installation, lint, formatting,
typecheck, full workspace tests (106 files / 1,219 tests), build and workspace smoke
checks pass locally. Six new executable design checks cover proposed schemas,
exact inventory hashes, current-reader rejection, real ProseMirror maps/slices,
split/merge and all 35 scenario IDs. All 171 relative links in changed documentation
resolve. Native UI end-to-end, runtime crash injection and performance benchmarks
are implementation follow-ups; this PR introduces no runtime feature or dependency.
The build retains the existing renderer chunk-size warning.

Files added: `docs/editing-revisions.md`, `docs/editorial-format.md`, this delivery
matrix, `docs/examples/editorial-v1/README.md` and its 14 JSON examples, plus
`packages/project-model/test/editorial-design-examples.test.ts` and
`apps/desktop/test/editorial-design-examples.test.ts`.
Files updated: `docs/README.md`, `docs/design.md`, `docs/technical-spec.md`,
`docs/project-format.md`, `docs/planning/local-publishing-plan.md`,
`docs/planning/commercial-architecture-addendum.md` and `tests/README.md`.

No scoped design question remains blocking. Future commercial allocation,
editorial interchange, permanent evidence cleanup and advanced comparison/apply
features remain outside this design. The proposed limits and complete runtime
failure matrix must be validated by their assigned implementation issues.
