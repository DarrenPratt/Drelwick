# #135 implementation specifications and owner review

Status: proposed, **not approved and no BS issues created**. BS1–BS6 are stable
planning IDs, not GitHub issue numbers. Related to [#135](https://github.com/DarrenPratt/Drelwick/issues/135)
and [#203](https://github.com/DarrenPratt/Drelwick/issues/203). Read the normative
[book structure design](../book-structure.md) and [fixtures](../examples/book-structure-v1/README.md).
Do not implement runtime work in the design PR.

## Review presentation and major trade-offs

| Proposed decision                                                   | Benefit and cost                                                                                                   | Owner disposition |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Keep manifest order; exact hierarchical DFS equality                | Existing references/recovery remain meaningful; every structural writer must update both atomically.               | Pending           |
| Add structure file with explicit project-v4 enable gate             | Old writers cannot silently destroy grouping; needs full writer/archive/snapshot version integration.              | Pending           |
| Bounded three-edge depth, mixed direct chapters permitted           | Covers ordinary/multipart/multivolume works; arbitrary section recursion is deferred.                              | Pending           |
| Generated group openings only                                       | Reuses semantic rendering without duplicated prose; editable custom volume title documents need later schema work. | Pending           |
| Number after selection, unnumbered prologue/epilogue defaults       | Consecutive numbers within each output; chapter labels can differ between editions.                                | Pending           |
| Empty included containers block publishing                          | Prevents accidental orphan title pages; authors must explicitly exclude placeholders.                              | Pending           |
| Named editions select ordered subsets with bounded flag inheritance | Shares all content and preserves canonical order; alternate edition trees/order are deferred.                      | Pending           |
| BS1–BS4 CORE; BS5–BS6 Undecided                                     | Preserves local Community publishing; commercial allocation awaits working-app evaluation through #203.            | Pending           |

Approval must identify the reviewed commit, accepted/revised decisions and approved
v1.0 scope or explicit deferrals. This record is not self-approval. Once approved,
search open/closed issues again for duplicates, create the agreed focused issues,
link each to #135/#203 and update this register with real URLs. Apply existing
`product:core` for BS1–BS4, `product:undecided` for approved still-unallocated BS5/BS6,
and appropriate existing type/area/priority labels. Inspect current milestone names
and use the agreed private v1.0 milestone for approved scope; leave explicitly deferred
work out. Never invent issue numbers or assign Pro. Review and merge remain separate.

## Shared implementation contract

Every issue below must link this design/fixtures, repeat its scope and acceptance
criteria in the actual GitHub body, and preserve local/offline/no-account Community
operation. Business logic belongs in core, persistent schemas in project-model,
DTOs in shared, Electron adapters in desktop. No new engine or dependency is assumed.
All run frozen install, lint, format, typecheck, unit tests, build and workspace checks;
add relevant filesystem/process-kill/Electron/output tests described below. No issue
may enable project v4 while any authoring writer, backup, snapshot or export can
silently ignore required structure. Deliver one focused PR per implementation issue.

For every mutation: authorized main-frame/project IDs, bounded semantic DTOs,
expected generation and hashes/absence, operation/request receipt, canonical-root
path validation and fixed content-free diagnostics. Preserve previous saves and
dirty drafts; test rollback/rollforward, changed external sources and retry. Community
never imports Pro and no legal/repository-visibility decision is implied.

## BS1 — Versioned book structure and safe migration

**Classification: CORE (`product:core`).** Objective: persist stable grouping without
changing authoritative prose or order. Dependencies: reviewed #135; implemented
#111/#123/#126, #170/#171/#173 foundations (verify merged state again). #203 is a
downstream evaluation gate, not a prerequisite or commercial blocker.

Scope: strict structure v1, project-v4/descriptor-v3 gate, v3→v4 migration,
transaction evolution, graph validation, atomic lifecycle operations, backup,
snapshot-v2/restore/comparison integration and independent recovery documentation.
Out of scope: navigator UX, generated openings, edition manager, anthology/copy.
Provide an internal opt-in API for tests; do not expose incomplete structure-enabled
projects to production UI until downstream export refusal/support is coherent.

Acceptance criteria:

- Validate exact DFS/manifest equality, UUID ownership, bounded legal parents,
  cycles, unreachable/duplicate/missing references and all limits.
- Read legacy flat projects deterministically without creating files. Explicit
  enable previews unchanged traversal, makes a verified complete pre-migration
  backup and safely commits the gated format. Unknown extensions block migration.
- Keep already-v3 chapter bytes unchanged; document separate older envelope
  migrations and retain original bytes. No silent downgrade or flattening.
- Moves, create/delete/duplicate/split/merge/import/reorder and restore preserve
  identities and update structure/order/anchor ordering in one recoverable generation.
  Group dissolution never deletes prose; stale commands preserve drafts.
- Every v4 writer validates the required component, including publication/theme/
  print/editorial operations. Old readers fail safely. New readers recover both old
  journals and the new version; no mixed bundle is available to export.
- Archives/restores capture structure and all required recovery data. Snapshot v2
  requires it; historical snapshot v1 stays readable/immutable. Pre-structure restore
  previews a flat v4 replacement with mandatory safety capture and retained conflicts.
- Until BS3 supports structured outputs, refuse those exports explicitly instead
  of flattening silently. Existing legacy exports remain unchanged.

Expected components: `packages/project-model/src/{versions,editorial.ts,manuscript-snapshot.ts}`,
new structure schema; core loading/migration/editorial-transactions, all chapter
lifecycle/import services, archive/snapshot/comparison/context; shared contracts;
desktop project-open/recovery adapters; public format and recovery script.
Fixtures: all four proposed examples converted deliberately to production schema
fixtures, plus absent/invalid/newer/foreign/missing-file and pre-structure snapshots.
Tests: schema graph/property tests, actual save/reopen byte inventories,
concurrent writers and external edits, receipt retry, archive restoration,
unsupported-version refusal, process termination at each journal/backup/commit
and repeated-recovery boundary. Verify exact original backup hashes and source bytes.
Migration/security: shared contract above, no weakened validation, path allowlists
reviewed together. Boundary: fully useful Community persistence without Pro.

## BS2 — Parts and volumes in the navigator

**Classification: CORE (`product:core`).** Objective: author/manage legal hierarchy
without accidental prose movement/deletion. Depends on BS1. Scope: accessible
bounded tree, add/rename/subtitle/dissolve/move groups, explicit structure enable,
chapter movement, generated-opening settings and dirty/stale/error states.
Out of scope: arbitrary recursion, custom title-page editor, edition-manager UI,
anthology or cross-project drag-and-drop.

Acceptance criteria:

- Ordinary flat novels keep existing flow. Enable structure is explicit and shows
  backup/compatibility impact before mutation, with unchanged traversal preview.
- Keyboard and pointer operations support root parts, volumes with parts or direct
  chapters, prologue/epilogue leaves and empty draft groups; invalid destinations
  cannot be committed. Explain publishing errors without deleting placeholders.
- Selection/editor identity survives moves. Flush failures block movement and
  retain drafts. Dirty/newer edits survive stale responses and unknown outcomes.
- Dissolve shows the resulting order and illegal-promotion choices; deleting a
  group never implicitly deletes chapters. Numbering controls alter settings only.
- Restart reconstructs identities/order exactly, including empty groups; UI has
  screen-reader labels, visible focus and keyboard-equivalent move actions.

Expected components: desktop `App.tsx`, navigator/workspace components, preload/
main/shared structural IPC and core BS1 commands. Fixtures: single/multipart/
multivolume plus empty group, invalid move and pending-review chapters.
Tests: React command/dirty-state checks, trusted-frame/project/payload IPC tests,
Electron keyboard/move/save/restart and failed-save/stale-request scenarios.
Migration/security: UI never writes files, accepts only authorized ID-based commands
and relies on BS1 backup/recovery. Boundary: all local hierarchy UX is Community.
Suggested delivery: BS1 then BS2; may land after BS3 if needed for a complete enable flow.

## BS3 — Hierarchical EPUB and print rendering

**Classification: CORE (`product:core`).** Objective: render one manuscript through
the shared pipeline with correct hierarchy/navigation/openings. Depends on BS1
and existing #126/#129/#130/#136. BS2 is integration coordination, not an algorithmic
prerequisite. Scope: immutable publication plan, base group/leaf inclusion,
generated numbering/openings, nested EPUB nav, print headers/reset/contents,
DOCX compatibility and preflight. Out of scope: named editions, custom group prose,
new renderers, new printer compliance claims.

Acceptance criteria:

- Existing no-structure exports retain logical document/prose/order/styles/navigation
  and print pagination baselines. All grouped prose is serialized exactly once.
- Numbering matches documented scopes, overrides and prologue/epilogue exceptions;
  included/excluded/nav-only changes never rewrite chapter bytes.
- EPUB XML/OPF/spine/nav are valid, stable-ID and accessible. Hidden group entries
  promote children; all links target included real documents/fragments.
- Print coalesces recto requests, avoids unwanted/trailing blank sheets, suppresses
  opening/blank headers and folios, handles logical resets separately from physical
  parity, and resolves contents destinations within five passes or blocks export.
- Standard/Large Print and EPUB presentation remain independent; each profile gets
  its own pagination/preflight. PDF export equals validated preview bytes and rejects
  stale selection/profile/content revisions even during destination selection.
- Editable DOCX preserves all manuscript content by default and adds structural
  headings without claiming print fidelity; unsupported selection modes report/block.
  Existing editorial projection choice and private-data exclusion remain enforced.

Expected components: core assembly/EPUB/DOCX services, renderer types/serializer/
print styles, desktop print renderer/preview/export/inspection and preview UI.
Fixtures: all structural examples; long Unicode titles/subtitles; empty/suppressed
openings; mixed direct chapters; reset folios; missing assets/links; both print profiles.
Tests: independent XML/archive parsing, exact prose extraction/order and no duplicate
documents, navigation target resolution, output failures/cancellation, offline real
Chromium page-map/TOC/parity and PDF-byte match, legacy regression goldens. Validate
Windows/macOS/Linux evidence explicitly; unrun platforms remain limitations.
Migration/security: no prose migration; plan/source hashes include structure and
flags; preserve existing sandbox/CSP/local asset and atomic destination policies.
Boundary: normal EPUB/basic print/DOCX remain Community. Suggested delivery: after BS1,
before enabling grouped publishing in BS2; BS4 consumes this plan.

## BS4 — Edition-specific publishing selection

**Classification: CORE (`product:core`).** Objective: select shared content per output
and named edition without copies. Depends on BS1 and BS3; BS2 supplies integrated
controls. Scope: versioned project-owned selection component, bounded named-UUID
inheritance, partial flags, preview/explanation, publication flag precedence and
snapshot/archive/source-revision integration. Out of scope: general edition manager,
alternate chapter ordering/trees, manuscript variants, commercial product packaging.

Acceptance criteria:

- EPUB/print/navigation flags remain independent. Base publication v1 stays
  authoritative unless an explicit inherited/selected override replaces that flag.
- Ancestor content suppression gates descendants; hidden navigation promotes visible
  children; empty included containers block export, explicitly excluded ones do not.
  Excluded data remains in all project recovery/backup paths.
- Selection UUID/name/parent rules reject cycles, missing parents, depth over four,
  stale IDs and counter/hash mismatches. Detach materializes flags only after review;
  no source content or parent edition is silently mutated by a child edit.
- Export binds selection independently of Standard/Large Print profile and EPUB
  presentation. Switching print profiles alone cannot select another content edition.
- Missing component means base selection in pre-selection supported formats. BS4
  implements the proposed v4→v5/descriptor-v4 gate and snapshot-v3 inventory before
  persisting selections; reserve numbers against intervening work. A declared required
  component missing/newer/corrupt blocks affected operations without default rewrite.
  Recheck version gate before implementation; do not extend strict old descriptors
  or snapshot/journal schemas in place without compatibility review.
- Tests demonstrate explicit true overriding base false, false inherited through
  groups, changed base with pinned overrides, identical chapter bytes, renamed editions,
  safe removal, stale previews and portable restore.

Expected components: project-model selection schema and versioned inventory metadata;
core resolution/transactions/archive/snapshots; shared typed selection tokens;
desktop focused publishing controls; existing render/export plan consumers.
Fixtures: `edition-variants.json`, all eight flags, missing/removed/stale references,
inheritance overrides and empty-after-filtering groups. Tests: table-driven resolution,
schema/version/graph failures, generation races/fault injection, byte-identical prose,
both-profile/EPUB regression and explicit export revision capture. Migration/security:
verified backup for required gate changes, no account or cross-project references,
no exclusion-as-deletion. Boundary: shared-content output selection is Community.
Suggested delivery: after BS3; re-review any request for alternate structure/order.

## BS5 — Local anthology assembly

**Classification: Undecided — owner review required (`product:undecided` if created).**
Objective: design and deliver a reproducible self-contained anthology from selected
local books, subject to separate scope approval. Depends on BS1/BS3 and the reviewed
BS6 import primitive; BS4 only if anthology selection variants are approved. #203
evaluates approved work or explicit deferral before final commercial allocation.

Separate specification: select sources with main-owned native local project pickers,
validate supported versions/recovery and capture immutable source inventories after
explicit accepted/proposed choice. Show stories/chapter ranges in source order and
destination order, source metadata/author credits, rights/attribution fields and all
warnings. A story is a proposed destination grouping identity, not a chapter-type
change; decide its exact schema before enabling assembly. Default to a new project
assembled from copies. Selecting an existing destination uses BS6 safety/commit rules.

Scope: fresh destination project/story/group/chapter/asset IDs, provenance mapping
of source project/chapter IDs and captured hashes, editable destination publication
metadata/attribution, local asset closure and duplicate resolution. Source author/title
credits are private until deliberately included in public attribution matter.
Provenance records use source identities/hashes, optional user-visible source hint,
and capture time; absolute paths are neither needed for export nor logged. Decide a
versioned private provenance component with backup/snapshot policies in this issue.
No stored pointer is authority over destination content.

Out of scope: live links, automatic sync, hosted library, source mutation, rights
assertions, royalty management or general multibook library. Future source updates
are a new explicit staged import/diff against retained provenance; show divergence,
map IDs and require choices. Never auto-overwrite destination edits. Missing sources
disable update lookup only, never local editing/export.

Acceptance criteria:

- Review and approve story/provenance schema, metadata/credit policy and assembly
  UI before implementation; reuse BS6 rather than add a second importer.
- Assemble the fixture's two stories, same-title chapters and source-ID collisions
  into unique destination identities with verified assets and explicit attribution.
- Rename/move/remove source folders and export destination offline with identical
  semantic output. Destination backups contain every dependency needed for rendering.
- Repeating an import is detected and offers skip/copy-again with fresh IDs; a
  provenance collision never silently replaces existing content.
- Copy failure/cancellation preserves all sources and the previous destination;
  update review retains both original capture and destination edits on conflicts.
- Make classification/scope an explicit owner decision; do not assume Pro or restrict
  essential Community authoring. No Pro dependency in Community infrastructure.

Expected components: follow-up anthology design and provenance schema, core staged
assembly orchestrator using BS6, desktop source/story/attribution review, archive/
snapshot support. Fixtures: two synthetic source projects with equal UUIDs/titles,
shared/different assets, missing source, diverged update, pending reviews and attribution.
Tests: complete byte inventories before/after, portable offline export, duplicate
mapping, assets/provenance/privacy, invalid source rejection, destination rollback/
process-kill recovery. Migration/security: do not migrate source in place just to
copy; require an explicit separately authorized upgrade or supported read-only capture.
Pickers/tokens confer narrow source read/destination write authority; no arbitrary paths.
Suggested delivery: design BS5 in parallel conceptually, implement after BS6 approval.

## BS6 — Explicit cross-book copying

**Classification: Undecided — owner review required (`product:undecided` if created).**
Objective: review and copy local chapters/groups into a destination without modifying
the source. Depends on BS1 plus existing staged import/images/editorial transactions;
BS3 for output verification. BS5 is a consumer, not a prerequisite.

Separate specification: main selects/authorizes a read-only source project, captures
validated source bytes with hashes, recursively closes selected chapter/matter/assets
and shows a proposed destination insertion plan. User confirmation must identify
source capture, destination generation/hash, selected content, insertion location,
mapped links, private-data choices and warnings. No destination authoritative mutation
before confirmation. Cancellation leaves source/destination unchanged; scratch staging
is not a committed project. Same-project copying uses established duplication instead.

Scope and mapping rules:

- Allocate fresh destination chapter/group/matter IDs and revision-group/annotation/
  thread/comment IDs for explicitly included editorial data. Keep a complete mapping
  from `(source project UUID, source entity UUID, captured hash)` to destination IDs.
  Equal source UUIDs across different captures do not imply equality. Recheck sources
  before confirmation/commit or require a reviewed immutable staged capture.
- Copy managed image bytes/metadata, verify signatures/checksums and resolve fresh
  destination asset IDs. Deduplicate only against validated immutable destination
  assets with identical media type, dimensions and SHA-256 original bytes; never by
  filename/title alone. Retain provenance even when assets deduplicate.
- Remap internal links into copied content using the mapping; references outside
  selection get a located unresolved-link choice to include target or explicitly
  remove/replace the reference after review. No fabricated cross-project live link.
- Story Bible links default to explicit unresolved provenance, not a same-ID match.
  Offer copy selected referenced records with fresh IDs or review removal; a destination
  record match requires explicit author choice. Validate timeline/reference closure.
- Default copy is the chosen accepted/proposed semantic projection, pending review
  groups absent, fresh destination revision counters, existing source bytes retained
  only in local provenance/staging as specified. Source timestamps/authorship may be
  retained as provenance; destination creation/revision metadata describes the copy.
- History is excluded by default with a visible scope notice. Editorial annotations
  are excluded by default as private data; explicit inclusion requires a complete
  remappable bundle with original evidence and fresh IDs. Do not copy invalid anchors,
  raw replay positions, journal ownership/receipts or history files into live state.
  Optional source history import requires a separately versioned read-only provenance
  namespace; defer until designed rather than mislabel it destination Chapter History.

Out of scope: source edits/migration, automatic source updates, live references,
general synchronization, invisible annotation/history copying or copying arbitrary files.

Acceptance criteria:

- Approve the mapping/provenance/private-data schema before implementing the workflow.
  Explicit preview and confirmation bind the exact capture and destination revision.
- Copy chapters and legal groups, preserve selected prose/marks/assets and source
  inventories byte-for-byte; collisions always produce fresh safe destination IDs.
- Stage/verify assets first; journal the complete destination insertion using BS1
  recovery. Orphan staged assets are retained/cleaned through explicit safe recovery,
  never referenced before verification. Previous valid destination survives failure.
- Reject stale destination/source, invalid paths/schemas, unsupported content/versions,
  broken mappings and exceeded limits without silently dropping data.
- Demonstrate link remapping, Story Bible choices, optional annotation identity/
  anchor integrity, history scope notice, cancellation and exact retry receipt.
- Source directories can disappear after commit and destination remains portable.
  Commercial allocation is explicitly undecided, no automatic Pro assignment.

Expected components: follow-up copy/provenance design; project-model import receipt/
mapping schema; core importer/assets/references/editorial/structure services; restricted
desktop picker/review/confirm adapters and portable archive inventory.
Fixtures: same-ID source/destination, same bytes/different assets, internal/external
links, omitted referenced chapters, Story Bible records, comments/pending revisions,
missing source, stale generation, every write-failure boundary.
Tests: read-only source filesystem assertions plus exact byte inventories, mapping
closure, recovery after process kill/partial writes, content-free logs, malicious
path/symlink/ZIP-resource limits where applicable, Electron confirm/cancel/restart.
Migration/security: no source mutation; upgrade destination only via explicit verified
BS1 migration. Community interfaces must work without Pro regardless of later allocation.
Suggested delivery: after BS1/BS3, before BS5 runtime; classification and scope approval first.

## Suggested delivery graph

```text
owner design review → BS1 → BS2
                       └→ BS3 → BS4
                       └→ BS6 (separate approval) → BS5 (separate approval)
approved implementations or explicit owner deferrals → #203 → commercial review
```

BS3 and BS6 also require the prior foundations stated in their specifications.
The graph does not authorize parallel agents, starting another issue during this
design task, or implementing an undecided capability without owner scope approval.

## #135 criterion review

| Actual acceptance criterion                                         | Review evidence                                                                             | Status                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Specify nesting/order, title pages, navigation and numbering        | Design hierarchy/contract/numbering/export sections; single/multipart/multivolume fixtures  | Draft delivered; owner review pending                      |
| Define ebook/print inclusion without duplication or silent deletion | Inclusion precedence, ancestor gates, filtered numbering, edition fixture                   | Draft delivered; owner review pending                      |
| Assess anthology and cross-book copying separately                  | BS5 and BS6 specifications; two-story fixture walkthrough                                   | Draft delivered; scope review pending                      |
| Document migration, stable identities and export compatibility      | v4 gate, exact order invariant, transaction/failure matrix, snapshot/archive/DOCX contracts | Draft delivered; owner review pending                      |
| Create classified implementation issues with fixtures after review  | BS1–BS6 ready; fixtures and standalone validation supplied                                  | **Incomplete: approval and actual issue creation pending** |

Prerequisites #123/#126 were verified in code/tests, not merely by closed status.
Validation evidence is recorded in the design PR/final report. No checkbox here
claims runtime support, owner approval, successful checks that were not run, issue
creation, merge or #135 completion.

## Local validation — 13 November 2026

Executed in the isolated `chore/135-book-structure-design` worktree based on
`4ded429`, using Windows, Node `v24.18.0` and pnpm `10.34.5`:

| Command                                          | Result                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                 | Passed, no lockfile change. pnpm reported ignored build scripts for electron-winstaller/esbuild; subsequent build/tests succeeded.                                             |
| `node scripts/check-book-structure-fixtures.mjs` | Passed: four fixtures, twelve target/selection plans, thirteen invalid variants rejected; all eight inclusion flags, group suppression and numbering-scope exceptions checked. |
| `pnpm lint`                                      | Passed. Final checker-only edits also passed `pnpm exec eslint scripts/check-book-structure-fixtures.mjs --max-warnings 0`.                                                    |
| `pnpm format:check`                              | Passed; final documentation/checker formatting also applied with repository Prettier.                                                                                          |
| `pnpm typecheck`                                 | Passed, including its workspace build and test TypeScript check.                                                                                                               |
| `pnpm test`                                      | Passed: 137 files, 1,416 tests, including existing publication, EPUB, migration, snapshot, print/profile and export regressions.                                               |
| `pnpm build`                                     | Passed. Vite reported existing chunks above 500 kB; no build error.                                                                                                            |
| `pnpm check:workspace`                           | Passed: twenty boundary tests, Community inventory, workspace build and smoke consumer.                                                                                        |
| `git diff --check`                               | Passed.                                                                                                                                                                        |

No runtime functionality or production schema changed. The standalone checker is
not part of `pnpm test`; run its exact command separately. Native Electron E2E,
new structured output pagination/EPUB validation and macOS/Linux execution were
not run for this documentation proposal. Future runtime features cannot be tested
before implementation; required tests are specified per BS issue. These results
do not imply owner approval, platform certification or design-issue completion.
