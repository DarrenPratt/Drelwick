# Proposed book-structure v1 design fixtures

These are **documentation fixtures, not implemented production schemas or loadable
Drelwick projects**. Do not place them in a real project. The normative proposal is
[book-structure.md](../../book-structure.md); delivery is [BS1–BS6](../../planning/135-book-structure-follow-ups.md).
All identities are valid synthetic UUID v4s. There is no real author manuscript.

Each file wraps a proposed `structure` component, synthetic `chapterCatalogue`
(titles/types only, no chapter prose), authoritative `manifestOrder`, a publication-v1
example and expected results. `editions`, where present, is proposed selection v1.
The wrapper's `proposedDesign`, `description`, `expected`, catalogue and manifest
order are documentation context, not fields to add to production components.
No real project/chapter schema is modified by these examples.

Run from the repository root:

```sh
node scripts/check-book-structure-fixtures.mjs
```

The dependency-free checker verifies UUIDs, ownership/parents/depth, references,
exact manifest equality, inclusion/override inheritance, numbering and expected
semantic item/navigation orders for every target/selection. It rejects synthetic
future versions, unknown fields, malformed references, cycles, unreachable/repeated
nodes, stale order, invalid edition inheritance and empty included groups. It also
checks per-part reset/unnumbered exceptions and deliberate group exclusion.
All eight content/navigation flag combinations are checked independently.
It is deliberately not a production schema validator, JSON duplicate-key detector,
migration runner, EPUB validator or PDF pagination test. BS1/BS3 must add those tests.

## Traversal and output walkthrough

For readability, numbers below are the final digits of UUIDs; JSON contains full IDs.
`opening 301` means stable output identity `structure-<full-node-UUID>-opening`.
Navigation expectations record `{id,parent}` edges; `null` is a top-level entry.
Every output's full expected item/number/navigation arrays are embedded in JSON.

| Example      | Canonical chapter traversal | EPUB and print semantic item order                                                                           | Numbering                                                                                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Single novel | 101, 102, 103, 104          | title 801; those four chapters; author 802                                                                   | All unnumbered; prologue/epilogue stay in authored positions.                                                                  |
| Multipart    | 101, 102, 103, 104          | 801; opening 301; 101, 102; opening 302; 103, 104; 802                                                       | Chapters 1–4 continuously; Part I/II.                                                                                          |
| Multivolume  | 101–107                     | 801; opening 401; 101; opening 301; 102, 103; opening 302; 104; opening 402; opening 303; 105, 106; 107; 802 | Unnumbered prologue 101; 102–104 = 1–3; 105–107 = 1–3 (explicit counted epilogue). Part I/II in Volume I, Part I in Volume II. |

Multivolume demonstrates chapters directly in volumes, nested parts, independent
subtitles/openings, recto starts and Volume II logical-page reset. Physical blank
placement/page counts require actual pagination; this checker makes no PDF claim.
To choose per-part numbering change only `numbering.chapters`; prologue remains
unnumbered, each part restarts and direct-volume counted leaves share the ungrouped
book counter. No title or chapter body changes. Empty groups may be saved while
editing; publishing them requires explicit exclusion or actual descendant content.

## Edition variants

Base EPUB includes chapters 101, 102, 103; base print includes 101, 103, 104.
Chapter 102 is EPUB-only and hidden from navigation. Chapter 104 is print-only.
Both retain every chapter and canonical traversal 101, 102, 103, 104 on disk.

Named `Reader selection` (701) explicitly includes 102 in print/navigation and
excludes 104 from print. Its EPUB/print chapters are both 101, 102, 103 numbered
1–3. `Quiet navigation` (702) inherits 701 and hides the part's navigation entry;
all three chapter links become top-level, while part opening and content remain.
Print Standard/Large Print may each render any of these selections with their
independent existing profiles; this example does not duplicate `print.json`.
Navigation never controls content inclusion or chapter counters.

## Migration and integrity walkthrough

A legacy flat project with order 101–104 opens as that exact flat view without
creating a file or allocating persistent structural IDs. First explicit enable
previews the same order, verifies a pre-migration backup and persists leaf IDs
201–204 in the proposed gated format. Already-v3 chapter bytes/UUIDs remain exact.
Older envelope upgrades retain byte-exact originals in their separate backups.
Turning that view into two parts allocates 301/302 and changes only grouping;
DFS still equals 101–104. Moving chapter 102 after 103 updates the child arrays
and manifest to 101,103,102,104 in one generation or rolls back both. It cannot
leave a successfully committed mismatch.

Missing structure in declared v4 is an error; it is not a flat fallback. Missing
chapter references, duplicates, cycles and unsupported fields/versions retain bytes
and block publishing. Prepared interrupted edits roll back; committed interrupted
edits roll forward from verified images. Export failure leaves the project and
previous output intact. The checker confirms design invariants only; production
fault-injection and byte-preservation evidence belongs to BS1.

## Deferred anthology walkthrough

Source A contains story “The Harbour”, chapters A1/A2 and a lantern illustration.
Source B contains story “The Crossing”, chapters B1/B2 and an illustration with
the same filename but different bytes. Suppose A1 and B1 also have equal UUIDs.
Author selects both stories, reviews source projection, credits, asset/link mappings
and destination order A1,A2,B1,B2, then confirms a new local anthology project.

Expected destination: fresh project UUID, two fresh story/part IDs, four distinct
fresh chapter IDs in that order and two independently verified managed assets.
Navigation has one part per story with its two chapters. Attribution matter is
explicitly authored/approved; provenance captures source project/entity IDs and
revision hashes privately. Neither filename nor equal UUID is a deduplication key.
Remove both source folders: the anthology still opens, exports and restores from
its own backup. A later edited source is a new reviewed update proposal; divergent
destination prose is never overwritten automatically.

This scenario is an assessment, not a fifth runtime fixture or a claim that story
entities/import schemas exist. BS5 must supply two complete source projects and
destination/asset/provenance fixtures after separate schema/scope review. BS6 must
provide the copy/mapping primitive, explicit confirmation, Story Bible and private
editorial choices, failure recovery and proof of unchanged sources. Live links,
automatic updates, royalty accounting and commercial allocation are deferred.
