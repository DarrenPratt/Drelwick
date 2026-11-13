# Local book structure — proposed v1

Status: **owner-review proposal for #135; no runtime support**. This is CORE
architecture. BS1–BS4 are future CORE implementation; anthology and cross-book
copying remain unallocated pending owner review. Approval of this document does
not mean implementation, commercial allocation or #203 acceptance.

## Evidence and compatibility baseline

Reviewed against repository `4ded429` on 13 November 2026 and the complete issue
bodies for #109, #111, #123, #126, #134, #135, #136 and #203. #135 has five
acceptance criteria; the [review register](planning/135-book-structure-follow-ups.md)
tracks them, decisions and delivery gates. Open/closed GitHub structure searches
found no replacement implementation of #135. #134 is now merged design work
(PR #245), not a runtime template library.

| Existing behaviour                                                                                                                                                | Source and tests inspected                                                                                                                                                       | Consequence                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest order is authoritative; chapter type does not reorder prose                                                                                              | `packages/project-model/src/versions/{v1,v2,current}.ts`, `core/src/chapter-ordering.ts`, `core/test/chapter-ordering.test.ts`                                                   | Retain flat order and chapter UUIDs.                                                                                                                                            |
| #123 is implemented: metadata, ordered editable matter, cover and three independent inclusion flags                                                               | `shared/src/publication-contracts.ts`, `project-model/src/publication.ts`, `core/src/publication.ts`, `core/test/publication.test.ts`, desktop `PublicationDialog.tsx`           | Reuse publication v1; never move its documents into a second content store.                                                                                                     |
| #126 is implemented: consistent capture, semantic XHTML, one document per included item, flat navigation, manifest/spine, local validation and atomic EPUB output | `core/src/{book-assembly,epub-export,epub-output}.ts`, corresponding core tests, desktop `main/epub-export.ts`; merged PRs #205/#206                                             | Extend assembly/navigation, retain package/output services. Actual EPUB_VERSION/OPF version is 3.0; the historical issue comment reports 3.3, which is not the package version. |
| Print renders semantic items in local Chromium, assembles PDFs and applies folios/headers with PDF tooling                                                        | `renderer/src/print.ts`, desktop `main/{print-render,print-export,print-inspection}.ts`, desktop print tests                                                                     | Extend this pipeline; CSS page-counter assumptions alone are insufficient.                                                                                                      |
| #136 provides two independent fixed profiles                                                                                                                      | `project-model/src/print-configuration.ts`, `core/src/print-configuration.ts`, `core/test/print-configuration.test.ts`                                                           | `print.json` v2 and EPUB `presentation.json` remain independent.                                                                                                                |
| Project v3/chapter v2/editorial generation, retained transactions, named snapshots and revision review already exist                                              | `project-model/src/editorial.ts`, `core/src/{editorial-transactions,editorial-context,manuscript-snapshots,revision-service}.ts`, editorial migration/transaction/snapshot tests | Extend current contracts; do not build a parallel structural journal.                                                                                                           |
| Backups and snapshots have explicit path/version allowlists                                                                                                       | `core/src/project-archive.ts`, `project-model/src/manuscript-snapshot.ts`, core snapshot/archive/public-format tests                                                             | Adding a file alone does not make it portable or snapshot-safe.                                                                                                                 |

Paths in this table abbreviate `packages/` except desktop paths under
`apps/desktop/src/`. The public format's introductory v2 baseline is historical:
its later editorial section and current schemas also support opt-in project v3.
New-project creation still defaults to v2. This proposal does not change either.
Older conceptual layout examples are not evidence that parts/volumes exist.

## Authority and bounded hierarchy

Three separate concerns remain explicit:

1. Chapters and publication matter own semantic content and stable content IDs.
2. Structure owns grouping, canonical ordering constraints and publishing selection.
3. EPUB presentation and Standard/Large Print profiles own appearance and geometry.

The implicit Book is the project UUID. Front Matter and Back Matter are fixed
views over `publication.json.pages` filtered by placement, preserving array order.
They are not movable structural nodes. Existing chapter `frontmatter`/`backmatter`
types remain manifest leaves at their original positions; type alone never relocates
them. A deliberate future conversion must preserve both ID provenance and content.

Body root children may be chapter references, parts or volumes in any sequence.
A volume may contain chapter references and parts in any sequence. A part may
contain only chapter references. Chapter references have no children. A part cannot
contain a volume or another part; volumes cannot nest. Maximum body depth is three
edges: Book → Volume → Part → Chapter. Empty volumes/parts are valid editing states.
Each node is owned by exactly one parent and reached exactly once from root.
Each chapter appears exactly once, even when excluded from every output.
This permits ordinary, multipart, multivolume and mixed direct-chapter works.

Prologues and epilogues reference existing chapter files and use those files' type.
They may occur at book, volume or part boundaries; no global sorting by type occurs.
An interior prologue/epilogue gets a located advisory, not automatic movement.
Only explicit author moves change reading order. No group stores chapter prose.

Canonical body traversal is depth-first, left-to-right in child-ID arrays. The
exact invariant at every completed commit is:

```text
DFS(structure.roots).filter(type == chapter).map(chapterId)
    === project.json.manuscript.order
```

Equality includes length, order and exact ID spelling. Detect collisions
case-insensitively while preserving historical chapter UUID spelling. All manifest
chapters must resolve to matching chapter files; no duplicate/missing/foreign
reference is tolerated. File enumeration and node-array storage order are irrelevant.
Title/opening documents and publication matter are outside this equality.

## Proposed persistent contract

Use `book-structure.json`, but **not** as an optional file ignored by old writers.
On the first explicit Enable structure operation, upgrade a supported project v3
to proposed project **v4**, retaining all v3 fields and adding required
`structureFile: "book-structure.json"`. Proposed format descriptor **v3** retains
the current book v1/chapter v2/editorial v1 codecs and adds
`bookStructureSchemaVersion: 1`. Old readers must reject v4 before any save/export.
This gate prevents an older flat reorder from silently desynchronizing the tree.
Exact version numbers must be rechecked/reserved in BS1 if another migration lands.
Do not add fields to the current strict descriptor or claim current loaders accept v4.

| Component field | Proposed v1 contract                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | Literal `1`; independently versions structure.                                                                  |
| `projectId`     | Exact manifest project UUID.                                                                                    |
| `revision`      | Positive safe integer; increments once per changed structure component, not on unrelated prose saves.           |
| `roots`         | Ordered unique structural UUIDs; empty allowed only with empty manifest body.                                   |
| `nodes`         | Unordered array of discriminated node records; every node reachable once.                                       |
| `numbering`     | `{chapters: continuous\|per-part\|per-volume\|none, parts: arabic\|roman\|none, volumes: arabic\|roman\|none}`. |

All nodes have immutable lowercase v4 `id` and `type: volume|part|chapter`.
Group nodes have required `title` (1–500 UTF-16 units, nonblank), optional
`subtitle` (0–500), ordered `children`, optional `display` and optional `inclusion`.
Chapter nodes have `chapterId` and optional `numbering: inherit|none|counted`;
their title/type comes from the referenced chapter, never a
duplicate editable title. Group titles/subtitles follow publication XML-safe text
validation; no HTML, CSS, template code or arbitrary attributes are accepted.

`display` is a strict object with optional `opening: page|inline|none` (default
page), `label: boolean` (default true), `start: next|recto` (default next), and
`pageReset: continue|arabic-one` (default continue; volume only). These are semantic
choices, not geometry/font overrides. Groups default to inclusion all true;
chapter base flags continue to come from publication v1. Structural v1 chapter
`inclusion` is forbidden: only group inclusion is permitted in v1;
chapter overrides belong to the edition selection contract below. The general
node vocabulary reserves no unknown fields: unsupported fields fail validation.

Limits: 8 MiB UTF-8 component, 10,000 chapter nodes, 2,000 groups, 12,000 total
nodes, depth three, safe counters. Validate size before parsing and graph depth
iteratively before traversal. Duplicate JSON keys, cycles, multi-parent ownership,
unreachable nodes, case collisions and unexpected fields are errors. IDs cannot
collide with chapter/matter/asset IDs used as output identities. A chapter node's
own ID is distinct from `chapterId`; moving/renaming never replaces either.
Do not truncate or auto-prune at a limit. Unknown/newer schema, codecs or node kinds
block structural editing and publishing without rewriting bytes. Independent
content recovery and a verified copy remain possible.

See the [complete synthetic fixtures](examples/book-structure-v1/README.md).
Their envelopes include manifest-order and chapter-catalogue context, not proposed
extra fields in the production structure component.

## Transactions, concurrency and recovery

BS1 must extend current editorial bundle validation, transaction version handling,
path policies and every writer's version checks. Current transaction code checks
specifically for project v3 and migration from v2: it cannot simply accept v4 today.
Use a new supported transaction schema version for v4 transitions; preserve recovery
of old journals. All writers, including import, duplicate/split/merge, deletion,
restore, publication and presentation saves, must participate before enabling v4.

Flush pending editor/review drafts before a structural command. Main authorizes the
active project/frame and accepts IDs, semantic operation, expected generation,
structure SHA-256 revision, source inventory hashes and an operation UUID/request
hash. Never accept arbitrary paths or an unchecked replacement tree from renderer.
Under the existing shared project operation lock:

1. Resolve earlier recovery, validate the complete current bundle and expected
   hashes, including absence of optional inputs. Reject stale drafts, do not merge
   them using timestamps. Capture the operation's complete before/after images.
2. Derive the new tree and flat traversal together. Moves update parent child arrays
   and manifest order in one transaction. Group renames update structure; generation
   advances in manifest and editorial state even when order is unchanged. Reordering
   re-sorts live anchor segments by new canonical order, retaining anchor IDs/evidence.
3. Validate the proposed complete bundle. New chapter creation/import/split adds
   fresh leaf and chapter IDs; deletion removes the leaf only through explicit chapter
   deletion with retained content/history and anchor handling. Group deletion defaults
   to dissolve/promote legal children, with a reviewed move plan if promotion would
   break depth; it never cascades prose deletion. Merge/duplicate follow existing
   content/history rules and update every affected reference atomically.
4. Stage and fsync retained before/after images, prepared journal and request receipt;
   verify all changed **and unchanged** input hashes again before publication. Apply
   images with existing atomic replacement/directory durability mechanics, validate
   cross-component invariants, then publish the durable commit marker and completion.
   Acknowledge the saved generation only; newer drafts remain dirty.

Recovery follows existing semantics: prepared/uncommitted operations roll back;
durably committed operations roll forward. Verify every image and all live paths
match known before/after hashes **before** changing any recovery target. Unknown
external bytes block recovery and are retained, never overwritten by a guessed
winner. Repeated recovery is idempotent. Readers/exporters refuse an incomplete
transaction, even if the manifest happens to look valid. Unknown IPC outcomes query
the exact operation receipt; never issue a blind second mutation. Keep rolled-back
drafts and recovery evidence. No journal can make arbitrary noncooperating external
writes safe; hash preconditions detect them and require explicit recovery.

## Numbering and openings

Generate numbering in a pure target-specific resolved publication plan. Never
rewrite a chapter title, body or stored literal heading. New structure defaults
to `chapters: none` to preserve today's title rendering. Authors may select:

| Policy     | Counter scope                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| continuous | One body counter starting at 1.                                                                         |
| per-part   | Nearest part; each part starts at 1. Chapters without a part share a book-level ungrouped counter.      |
| per-volume | Nearest volume; each volume starts at 1. Chapters outside volumes share a book-level ungrouped counter. |
| none       | No chapter numbers; explicit `counted` overrides still opt in to the corresponding book counter.        |

Resolve included chapters first; excluded chapters do not consume numbers. Navigation
visibility never changes numbers. `inherit` is default: ordinary chapters count
unless policy none; prologue/epilogue and legacy matter-type chapters are unnumbered
and do not consume counters. `none` suppresses and does not consume; `counted`
explicitly counts any chapter type (including prologue/epilogue). Counter scopes
are selected by policy; under none, counted uses the continuous book scope.
Part labels count included nonempty parts within their volume, or within the
book for root parts; volume labels count included nonempty root volumes.
Roman labels use uppercase Roman numerals for 1–3999; requesting Roman outside
that range blocks publication with an actionable diagnostic. Chapter numerals
are Arabic in v1. No arbitrary number strings or automatic title parsing.

Generated volume title pages and part openings use group title, subtitle and
computed label. They are transient semantic documents serialized by `renderBook`,
with stable derived output IDs such as `structure-<node-uuid>-opening`; they are
not chapters or duplicated matter. An inline opening shares the next included
document boundary; `none` has no visible opening. No empty XHTML/spine document or
print sheet is emitted for an invisible opening. Navigation can target the first
included descendant when there is no opening. First descendant absence is an error
if a group is requested for publication.

V1 supports generated content only inside groups. Existing book title, copyright
and other matter pages remain editable semantic publication documents with their
existing IDs. Editing a generated opening edits group metadata/settings, with an
explicit generated label in UI. Arbitrary editable group title-page content is
deferred; it requires a versioned extension to publication placement and an explicit
generated/custom choice, rather than a hidden second prose field. Do not auto-apply
the proposed #134 templates or bind live library content.

Print `next` starts on the next available physical page and `recto` inserts at most
one parity separator. Coalesce group/chapter start requests at the same boundary;
do not emit a second blank or trailing blank. A page opening consumes one real page;
its following text starts next page unless its own start requires recto. Recto starts
use physical page side, never logical folio parity. Blank separators count physically
and in the preceding section's logical sequence, but display no folio/header.
Openings display neither header nor folio, while still consuming a logical page.
Front matter retains current Roman/hidden policy; body/back use existing body numbering.
Volume `arabic-one` resets at its opening, or first included descendant when opening
is suppressed. Parts never reset page numbering. Reset page numbers are disambiguated
in contents as `Volume I · 12`; physical PDF destinations remain unique.

Running headers use the current profile's enabled/disabled and side settings.
Existing book-title/author/chapter modes remain; add explicit volume/part modes
with nearest-ancestor title and book-title fallback outside groups. No header is
inferred by parsing prose. Standard and Large Print paginate independently.

## Shared publication plan and exports

Extend `assembleBook` with a validated immutable publication plan: ordered semantic
items, group ancestry, generated labels, navigation tree, source inventory, selection
identity/hash, projection and target. Retain existing content renderer, safe asset
resolver, stable anchors, themes, package validator, Chromium and atomic output.
Do not inject headings into stored documents or add a second rendering engine.
No-structure/default-selection exports must preserve current logical XHTML, prose,
order, navigation and print behaviour (generated ZIP timestamps are not a byte-golden).

EPUB emits cover, included publication front matter, body traversal with openings,
then back matter. One XHTML document per existing chapter/matter or page opening;
inline group headings are prepended transiently to the first descendant's document.
No prose appears twice. Spine follows that exact sequence, each item once; navigation
is a nested `ol` with volume/part/chapter entries. Suppressing a group's navigation
entry promotes visible descendants to its nearest visible ancestor. Suppressing a
chapter entry leaves its content in the spine. Excluded content has no document,
spine item or navigation target. Navigation target selection is recomputed after
filtering; dangling links and included links to excluded content block export with
a located error, never silently retarget manuscript links.

Each standalone document has a meaningful title and primary heading; inline ancestor
headings use legal increasing heading levels. Structure heading depth does not force
rewriting authored body heading levels: nest semantic sections and validate the
resulting outline/accessibility, retaining authored headings unchanged. Use existing
language metadata, image alternatives and escaping, EPUB `part`, `volume`, `chapter`,
`prologue`/`epilogue` structural semantics as appropriate, and accessible navigation
labels even if visible numbering is disabled. Automated tests must parse XML/OPF,
verify all fragment targets and check reading order, not rely on string snapshots alone.

Print consumes the same resolved item sequence, with physical opening/start/reset
rules above. Add an explicit generated contents option (off by default), using the
same navigation tree, with group/chapter labels and actual PDF destinations/folios.
Current print has no generated structural TOC. BS3 must paginate, derive entries,
repaginate and require a stable page map within five passes; nonconvergence blocks
export. Reserve space deterministically and test long labels, resets and Large Print.
Preflight checks empty included groups, missing links/assets, heading/glyph overflow,
opening placement, recto parity, page boxes, clipping, fonts, margin/gutter and TOC
destinations. Measured content loss remains blocking. Export writes exact validated
preview bytes with source/selection/profile revision checks before destination choice
and final replacement; cancellation/failure leaves the previous output and project intact.

DOCX retains its editable interchange converter (it is not an HTML renderer).
Default manuscript export includes all authoritative content in canonical order,
including output-excluded chapters, as today. BS3 adds transient group headings to
that converter without presentation pagination fidelity. DOCX must explicitly warn
or block a requested unsupported edition-specific mode; it must not silently apply
EPUB/print flags. No-structure DOCX output remains unchanged. Editorial comments,
history and source provenance stay private; existing accepted/proposed/cancel choice
is generation-bound for every export.

## Inclusion and future editions

The UI calls the EPUB target “EPUB”, but stored inclusion uses existing `ebook`.
Base chapter inclusion is `publication.body[id].inclusion`, default all true.
Base matter inclusion is its publication page flags; cover retains ebook-only policy.
Base group inclusion comes from structure, default all true. BS4 proposes separate
`publishing-editions.json` v1, project-owned and version-gated, with records containing
immutable UUID `id`, `name`, optional `parentId`, and ID-keyed partial boolean
`overrides`. Keys reference group IDs, chapter IDs or publication page IDs; they
never reference paths, node array positions or chapter titles. Cover policy cannot
be overridden into a print interior. No prose, assets or print geometry lives here.

Proposed exact envelope: `{schemaVersion:1, projectId, revision, editions:[]}`;
revision is a positive safe integer incremented on changed saves. Each record is
`{id, name, parentId?, overrides:[{id, inclusion:{ebook?,print?,navigation?}}]}`.
Names are nonblank XML-safe text of 1–200 UTF-16 units. IDs are fresh lowercase
UUID v4; override targets retain their referenced ID spelling. Records/override
targets are unique case-insensitively; unknown keys or nonboolean overrides are
invalid. Limits are 100 editions, 12,500 override targets per edition, four records
per inheritance chain and 8 MiB for the whole component. Empty override objects
mean inherit and are valid; an empty edition array is valid base-only state.

First explicit named-selection save upgrades proposed v4→v5, with required
`editionsFile: "publishing-editions.json"` and descriptor v4 adding
`publishingEditionsSchemaVersion:1` while retaining structure-v1 and prior codecs.
Use a verified pre-upgrade backup and the same transaction/version-gate principles;
chapter bytes stay unchanged. V4 without the file has base selection only. V5 missing
the declared file is an error; stray selection data in an older format must be
preserved and diagnosed, never ignored by a writer/exporter. BS4 must reserve these
provisional version numbers against intervening work. Snapshot v3 inventories both
required components; old v1/v2 snapshots remain readable and immutable. Restore of
a pre-selection snapshot into v5 previews an empty edition array/base selection,
preserving the replaced selections in mandatory safety capture. No downgrade occurs.

Named editions are content/structure selections, distinct from presentation profiles.
Print Standard and Large Print do not become renamed UUID editions. An export request
binds one optional selection UUID (absence means base), one output target, and for
print one existing profile key. Switching profiles alone never changes selection.
No active named-edition state is added to `print.json`. EPUB presentation stays separate.

Precedence per flag and node: publication/structure base → farthest named ancestor
override → nearest named ancestor → selected edition override. Missing property
means inherit; explicit false/true override it. Inheritance is local by immutable
UUID, single-parent, acyclic, at most four edition records along a chain; missing
parent blocks that selection instead of silently using defaults. No order override
in v1: different editions select different ordered subsets of the same canonical
tree. Alternate grouping/reordering requires a later version and design review;
it must never redefine manuscript order. Rename affects display only. Parent
deletion is refused while inherited; explicit detach materializes resolved flags
after review and in one transaction. Stale/dangling IDs block the affected selection.

Effective content flag is the resolved node target flag AND every ancestor group's
resolved target flag. A descendant true cannot resurrect a false ancestor; restoring
it requires explicit ancestor override too. Navigation additionally requires effective
content inclusion and the node's resolved navigation flag. A group's navigation false
does not hide descendants. This preserves all eight existing chapter/page combinations.
Editing existing publication flags changes the base; it does not rewrite named overrides.
Export review shows effective differences and reasons, especially inherited suppression.

After filtering, nonempty included groups render normally. An included group with no
included chapter descendants is a **blocking** located publishing error (also for
an empty editing group); offer explicit exclusion or adding content. An explicitly
excluded group disappears with its descendants; its empty state is not a publishing
error. Excluded data still gets persistent schema/reference validation. Nothing is
deleted, renumbered on disk or removed from backups. Navigation-only entries with no
content are forbidden. At least one body chapter is required for a structured export.
The fixtures demonstrate base selection and a named override; no general edition
manager, arbitrary alternate tree or runtime schema is implemented by #135.

## Migration and failure matrix

Before Enable structure, absent file means an in-memory flat view of manifest IDs,
using chapter UUIDs as transient view keys, no generated groups/numbering and no writes
on open. First persistence allocates structural IDs once and previews the unchanged
traversal. For v1/v2, run the existing explicit supported migrations first, each with
its own verified complete recovery copy; v2→v3 necessarily changes chapter envelopes
but preserves semantic content and keeps original chapter bytes in its backup.
Then v3→v4 creates a **new verified complete pre-structure backup** and journals only
descriptor/manifest/editorial generation/structure changes. Already-v3 chapter files
remain byte-identical. Do not claim the whole historical chain is byte-identical.

| Situation                                                                              | Required future behaviour                                                                                               |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| No component in v1/v2/v3                                                               | Deterministic flat read-time defaults, no enable or format write on open.                                               |
| Missing component in v4                                                                | Required-component error; retain everything, offer verified recovery; never silently flatten.                           |
| Stray component in older project                                                       | Preserve bytes, diagnose incompatible extension; block mutation/export until explicit recovery/adoption review.         |
| Malformed/newer schema, unknown content or duplicate keys                              | Retain original bytes; block affected operations, no default replacement or parsed rewrite stripping fields.            |
| Duplicate/missing chapter, cycle, unreachable node, invalid parent, traversal mismatch | Block publishing/structural writes; show located repair review and retain both candidates. Do not infer intended order. |
| Interrupted migration or multi-file edit                                               | Verify journal/backup, roll back before marker or forward after marker; mixed bundles unavailable until recovery.       |
| Partial/temp files, bad recovery hashes or unknown external edits                      | Recovery-required state; retain evidence and dirty drafts, no overwrite.                                                |
| Concurrent/stale command                                                               | Reject generation/hash/absence mismatch; preserve draft; refresh and explicitly re-review.                              |
| Failed/cancelled export                                                                | No source mutation or partial destination success; previous valid destination preserved.                                |

BS1 must extend backup/archive path allowlists, restored-project validation and
snapshot schemas **before** v4 can be created. Use snapshot schema v2 for v4 captures
with required structure inventory; keep v1 readers for historical captures. BS4 extends
that versioned inventory for edition selection, explicitly recording absence. Retain
all old snapshot bytes; never retrofit an old snapshot with today's hierarchy. Restoring
a pre-structure snapshot into v4 previews a freshly derived flat structure using
existing surviving leaf IDs and fresh IDs only for resurrected unmapped leaves; it
keeps v4 capability/version, takes mandatory safety capture and journals the complete
result. No downgrade-in-place. Comparison reports structure/selection metadata changes
by IDs; it remains read-only. Old periodic Chapter History is prose-only and does not
replace current structure. Chapter UUID references, Story Bible associations, anchors,
pending revision groups and retained conflict payloads survive moves. Deletion and
restore continue their established explicit orphan/conflict policies.

Portable backups include structure, edition selections, original content/assets and
required retained journals/drafts regardless of periodic-history choice. Restore stays
in a new folder and validates complete component closure. Independent recovery uses
manifest order and chapter JSON; invalid structure never makes those files disappear.
Keep originals before attempting manual extraction. There is no automatic downgrade,
unknown-data pruning or manuscript normalization in this design.

## Anthology and copying boundaries

An anthology assembled from two local source books should become a self-contained
destination: each source story becomes a destination part with fresh chapter/structure
IDs, attribution and immutable provenance, copied managed assets and captured source
revision hashes. Close/delete/unmount either source and the destination must still
open, back up and export reproducibly. A two-story example is documented with the
fixtures. Neither live multi-project references nor source mutation are safe defaults.

[BS5](planning/135-book-structure-follow-ups.md#bs5--local-anthology-assembly)
is a separate specification for assembly identity, provenance, attribution and updates.
[BS6](planning/135-book-structure-follow-ups.md#bs6--explicit-cross-book-copying)
separately specifies the reviewed copy/import primitive, mapping and recovery. Neither
workflow, a story entity, nor a source-link resolver is introduced here.

## Security and review gates

Entirely local, offline desktop operation; no account, hosted conversion, cloud
editor, collaboration or Pro dependency. Preserve restricted preload/IPC,
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, active-frame
authorization and validated real-root paths. Reject symlinks/junctions, traversal,
case collisions and nonregular inputs. Bound parser/work/resource use; retain drafts
on limits. Logs contain fixed error codes and operation IDs, never titles, prose,
raw JSON, annotations, provenance paths or serialized exceptions.

Owner review is required for the explicit v4 enable gate, exact flat-order invariant,
generated-only openings, selection-before-numbering, empty-container publication
errors, subset-only named editions, snapshot evolution and BS1–BS6 scope/classification.
The [follow-up register](planning/135-book-structure-follow-ups.md) is ready for that
review. Until approval and classified issue creation, #135 remains incomplete and
the PR must say `Related to #135`. Do not close it or auto-merge.
