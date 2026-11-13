# Reusable local front and back matter templates

Design specification v1 for #134; **CORE, proposed, not implemented**. This PR
specifies the library, not a runtime importer, desktop UI or project migration.
The owner’s 2 October 2026 decision permits this CORE work before #52 and #203.
Public release and external contribution gates remain unchanged.

## Verified baseline and boundaries

#123 is closed; PR #191 merged on 25 September 2026. The existing
[publication workflow](../publication-matter.md) uses strict `publication.json`
v1, semantic documents, SHA-256 optimistic revisions and recoverable saves.
`packages/shared/src/publication-contracts.ts` defines the DTO;
`packages/project-model/src/publication.ts` validates documents and creates five
editable starters. `packages/core/src/publication.ts` persists them and rejects
omission of existing page IDs. `packages/core/src/book-assembly.ts` captures front,
body and back matter; `packages/renderer/src` renders semantic content.
`apps/desktop/src/renderer/PublicationDialog.tsx` edits project pages with explicit
Save/discard, and preserves text on type changes. Project-v3 saves already route
through `saveEditorialContext`; implementation must use the current transaction
boundary rather than reproduce the older v2 path.

Those starters belong to one book. A reusable library is application-local and
independent of every book. No book points to library content for opening, editing,
preview or export. `publication.json` remains strictly v1 with no new fields.
Library changes never propagate automatically. This design requires no manifest,
book, chapter, theme or publication schema migration.

## Library identity, revision and storage

Main resolves `<userData>/matter-templates/v1/`; the renderer never chooses this
path. Each entry has a UUID `id`, immutable UUID `revisionId`, `name` (1–200 XML-safe
characters), `description` (0–2000), UTC `createdAt` and `updatedAt`, `kind` (`page`
or `collection`) and ordered `pages`. Names are labels, not filenames or identity.
Each page has stable library `id`, existing matter `type`, `title`, `placement`,
`inclusion`, `document` and `bindings`. Page entries contain exactly one page;
collections contain 1–100 self-contained page snapshots, with all front pages
before all back pages. Collections do not reference other entries. Editing a
standalone page never changes a collection that previously copied it.

On disk, `entries/<uuid>.json` is a strict envelope
`{schemaVersion:1, entry, deletedAt?}`. Entry is the portable entry below;
`deletedAt`, when present, is a UTC timestamp tombstone. Every committed edit,
rename or deletion allocates a fresh revision UUID. `createdAt` is immutable;
`updatedAt` must not precede it. Content history is retained as immutable revision
snapshots of the complete prior envelope under
`history/<entry-uuid>/<revision-uuid>.json` before replacement.
Deletion removes an entry from listings, never a book or retained recovery copy.
A derived index is rebuildable and cannot be the sole source. Identity profiles
use `identities.json`, an independent strict
`{schemaVersion:1, identities:[...]}` file with at most 100 profiles, the same
write protocol and optimistic byte revision; profile removal cannot change books.

Strict schemas reject unknown properties, duplicate case-insensitive UUIDs,
invalid dates/XML text, unsafe semantic documents and invalid binding targets.
Read limits: 8 MiB per entry/import, 1–100 entries and 0–100 profiles per import, 100 pages per entry,
1000 bindings per page and 32 levels of document/binding traversal. Publication’s
existing 500-page/64 MiB bounds also apply to the resulting book; check the
aggregate before committing. No external assets in v1 templates: reject image
nodes, including references copied from a book, with an actionable message;
never silently strip them. Existing project images remain supported unchanged.

Serialize cooperating writes under a dedicated library lock and require an
expected byte SHA-256 revision (including tombstones). Stage a unique exclusive
temporary file on the same volume, validate staged bytes, flush, retain and verify
the previous snapshot, then atomically replace. Flush the directory where
supported; document Windows power-loss limitations as for existing persistence.
A failed save leaves the prior valid file and unsaved editor draft. Never steal
an unexplained lock or discard temporary evidence. Interrupted writes expose
read-only validated entries and a Recover/Keep current/Cancel review; do not
promote a candidate based only on timestamp. Recovery verifies identity, recorded
before/after hashes and ownership; divergent bytes require manual recovery.

Version dispatch precedes decoding. Future versions are preserved read-only,
never downgraded. Future migrations must stage and validate a complete new library
beside a verified retained backup and commit through a resumable journal; failure
keeps the old library available. No migration runs merely to open a book.

## Portable offline format

Use UTF-8 strict JSON, no BOM, duplicate object keys or non-finite numbers, with
extension `.drelwick-matter.json` and envelope
`{format:"drelwick-matter", schemaVersion:1, entries:[...], identities:[...]}`.
Each entry has exactly the fields described above. Pages use existing
`ManuscriptDocumentSchema` JSON and page fields, plus library-only `bindings`.
The [fixtures](../examples/matter-templates-v1/README.md) define the exact shape
with a test-only strict Zod declaration and semantic/reference checks. This is a
portable content format, not a ZIP, executable plugin or project backup.

Export selected current entries only, excluding tombstones/history/provenance and
private profiles by default. If identity profiles are included, explicitly select
each one and preview the personal information. Export is an atomic native-picked
local file; cancellation leaves library and destination unchanged. Import validates
the complete bounded candidate before review. It never overwrites by name.
Same ID/revision and identical normalized content is a no-op; same ID/revision
with different content is rejected as an identity conflict. Another revision of
an existing ID offers Skip, Import as duplicate (fresh entry/page/revision IDs),
or explicit Replace library entry after diff and expected-revision validation.
Imported revisions are untrusted labels, not signatures or chronological ordering.
An older revision is never silently installed. Each selected entry commits
atomically; report per-entry success and retain uncommitted candidates after
failure. No claim of batch atomicity. Profiles are separately opt-in and conflicts
require new IDs or explicit profile replacement. Source files are never modified.

## Author identities and safe substitutions

An identity is `{id, label, name, biography}`: UUID, 1–200 character label,
1–500 character display name, 0–20000 character biography, all XML-safe plain text.
It is a local pen-name profile, not a legal identity or account. At apply time,
explicitly choose Publication author (name from current publication metadata,
biography supplied in preview) or a named profile. No default silently selects a
legal name; private profiles stay out of exports unless selected. Variants are
independent duplicated templates or the same template resolved with different
profiles, not conditional expressions.

Bindings are `{path:[nonnegative integers], key}`. Starting at `document`, each
index descends through `content[index]`. The target must be an existing text leaf;
no duplicate target paths. Replace the entire leaf’s `text` with a plain string,
retaining supported semantic marks. Paths cannot name attributes, links or object
properties. Document edits must remap bindings or require explicit correction
before Save; never guess which text was intended. The leaf’s example text is
preview scaffolding and cannot be committed as an unresolved substitute.

The only keys are `book.title`, `book.author`, `book.language`, `book.description`,
`identity.name`, `identity.biography`, `input.copyrightYear`, `input.rightsHolder`.
Book values come from captured publication metadata, not `book.json`. Identity
selection does not change publication author: preview warns if they differ;
editing that metadata is a separate explicit action. Copyright year (four ASCII
digits) and rights holder (1–500 characters) are user-entered, never inferred as
legal advice. Missing/empty required values block Apply and identify the field.
Users can explicitly remove an optional description/biography binding and its
text leaf in the draft; empty values are not silently substituted. Resolved
values must pass XML/text and final semantic schema limits. There is no date
clock substitution, environment access, filesystem lookup, recursion, evaluation,
HTML parsing, remote fetch or arbitrary expression grammar. Strings containing
braces, dollar signs or markup remain literal escaped text, never another pass.

## Manage, preview and apply

A library view works with no open book: create a page or collection, edit semantic
content and binding controls, reorder, rename, duplicate and delete. Save explicitly
with dirty-state/discard protection; failed saves retain drafts. Saving selected
book pages as a template copies content and asks which text leaves become bindings;
no automatic personal-data detection or replacement. Duplication allocates new
entry, page and revision IDs. Renaming/editing preserves entry/page IDs and creates
a revision; deletion requires confirmation and offers recovery from a tombstone.
Deleting from the library never deletes or hides an applied page.

For application, flush all pending project edits or cancel on failure. Capture the
library revision and publication byte revision; select pages, identity, values,
front/back insertion anchors and inclusion flags. Preview resolved semantic text,
reading order and ebook/print views using existing rendering. Apply inserts copies
only after explicit confirmation. Allocate fresh UUIDs for every destination page,
unique across body and matter, on every application (including repeated applies).
Preserve relative order within front/back groups, existing content and inclusion;
never infer replacement from type or title. No change to cover or book metadata.

Validate the complete resulting `PublicationSchema`; recheck both captured
revisions at commit. If library content changed/deleted or the book changed during
preview, reject as stale and offer refresh; retain draft and selections. Commit
all selected pages in one existing publication save/project transaction, respecting
v3 generations/recovery. Report success only after the save commits. Cancellation,
validation failure and disk failure keep previous book bytes and editor drafts.
After application all substitutions are ordinary editable text and every binding
is gone. Later metadata, pen-name, template or theme changes do not rewrite prose.

## Optional provenance and deliberate update review

Provenance is optional application-local advisory data under
`<userData>/matter-templates/provenance-v1/<project-uuid>.json`, never extra fields
inside strict publication pages. It has version/project ID and records mapping
book page ID to library entry/page/revision IDs, applied publication hash, resolved
baseline page snapshot, selected identity ID and resolved substitution values.
It contains author content: protect it like library data, do not log it, and offer
explicit removal. It is not included in portable projects/backups by this design;
books moved to another machine simply lose update suggestions. Project ID alone
does not authorize access; validate the active authorized project and current page
hashes. Duplicate projects with the same UUID cannot authorize cross-book writes.

Write book first, provenance second. If provenance fails, report “Pages saved;
update tracking unavailable”; do not undo a valid book save. Before using any record,
match its baseline, page ID and recorded publication hash; a failed/stale record
never grants overwrite permission. Unrelated publication changes may make tracking
unavailable until explicitly re-associated after inspection. Missing records can
be re-associated only through explicit page/source selection and baseline review.

Check for updates only on request. Show baseline, current book and newly resolved
candidate, including local edits, identity/metadata changes, order and inclusion.
Resolve using newly confirmed values; never silently reuse a changed profile.
Actions per page:

- **Keep**: preserve current bytes and provenance; no automatic suppression or
  overwrite. The same update can be reviewed later.
- **Replace**: explicitly confirm discarding displayed local differences; preserve
  destination ID, placement, order, title and inclusion unless their changes are
  separately selected. Replace document/type only as reviewed. Retain a verified
  recoverable pre-operation publication copy before commit; block if it fails.
- **Insert Updated Copy**: preserve existing page and insert a fresh-ID candidate
  at the reviewed anchor. Track the new copy separately after successful save.

Added collection members are insert candidates; removed members are retained with
an explanation. No automatic deletion, merge or bulk replacement by collection
identity. Each review captures current publication and template revisions and
rechecks them at commit; any intervening edit requires renewed review. All selected
actions commit together or fail without mutation. Missing baseline prevents a
three-way comparison; show that limitation and allow insertion or an explicitly
reviewed manual replacement, never claim “no local edits”.

## Availability, themes, publishing and accessibility

Missing/deleted library entry: show “Source unavailable” only in the library/update
view. Corrupt entries: isolate and preserve bytes, list fixed-code errors, continue
with other validated entries. Unreadable library/root, unsupported version or
recovery-required state disables affected library writes/applications, with Retry,
export-readable-data and explicit recovery options. Never create an empty library
over unexplained data. Books continue to open, edit and publish from saved copies;
assembly and exporters never consult library or provenance. Corrupt publication
data still follows existing recovery rules; library tolerance does not bypass it.

Templates carry semantic content and inclusion flags, no CSS/fonts/raw HTML/script,
paths, resources, editor DOM classes or theme IDs. The existing semantic renderer
and `data-matter-type` hooks apply the destination theme. Preview in Classic,
Modern and Literary, and independent Standard/Large-print settings; do not promise
identical pagination across systems. Custom-theme design #133 is not a dependency.
Resolved pages follow existing [DOCX](../docx-export.md), [EPUB](../epub-export.md)
and [PDF](../print-export.md) support matrices, navigation/visibility rules and
fidelity warnings. No template interpreter runs during publishing.

All operations work offline without account, Pro, telemetry, sync or hosted
conversion. Keyboard-accessible controls include Move up/down alternatives to
dragging, labeled identity/field inputs, focus return after dialogs, readable
ordered text preview, announced errors/save status and non-colour-only conflict
indicators. Destructive dialogs name the affected entry/page and retain focus and
drafts on failure. Confirm discard on dirty close; block transitions during save.

## Security and implementation boundaries

Persistent schemas belong in `packages/project-model`, pure copying/substitution
and persistence in `packages/core`, renderer-safe DTOs in `packages/shared`, native
picker/profile/path authorization and restricted IPC in `apps/desktop`. Validate
trusted frames, active project/session, bounded payloads and expected revisions
in main. Import/export paths come only from native pickers; reject symlinks,
nonregular files and escaping paths. UUID filenames are generated/validated, never
built from display names. Revalidate after reads and before atomic commits.
Retain `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, existing
preview CSP and no-network policy. Reject unsafe links through the existing
semantic validator. Error logs contain fixed codes only, no prose, profiles,
parser payloads, raw filesystem causes or substituted values.

## Acceptance and delivery matrix

| #134 criterion                                       | Design contract                                 | Required implementation evidence                                                                            |
| ---------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Local library, import/export, cross-book application | Identity/storage, portable format, manage/apply | Round-trip files; duplicate/conflicting IDs; ordered application to another project                         |
| Copied content; explicit updates                     | Apply and optional provenance/update review     | Independent edits; fresh IDs; Keep/Replace/Insert, stale review, retained pre-operation bytes               |
| Missing templates cannot block books                 | Availability and publishing                     | Rename/remove/corrupt library and provenance; reopen and DOCX/EPUB/PDF byte/content checks                  |
| Pen names, theme adaptation, safe versions           | Identity/substitution, themes, storage          | Both synthetic identities; hostile/literal values; all themes/targets; future versions and migration faults |
| Classification and follow-ups; no sync               | CORE status and backlog below                   | Community-only checks; offline UI/IPC tests; no remote access                                               |

The checked-in conformance test validates documentation examples, binding paths,
semantic documents, resolved publication v1 and rejection cases. It is **not**
evidence of runtime persistence, recovery, UI or export implementation. Follow-ups
must add fault injection before/after backup, flush, replacement and provenance
write; killed-process restart; corrupt/future entries; import bounds/duplicate keys;
concurrent writers; book-v2/v3 integration; exact unchanged chapter bytes; lost
library; failed autosave; keyboard/focus tests; offline preview/export and
independent DOCX/EPUB/PDF content inspection. Do not infer readiness from design tests.

## Follow-up backlog and non-goals

- [A: Implement local matter template model and recoverable storage](https://github.com/DarrenPratt/Drelwick/issues/240)
- [B: Build local matter template library UI and copy-on-apply workflow](https://github.com/DarrenPratt/Drelwick/issues/241)
- [C: Add explicit pen-name selection and safe matter template substitutions](https://github.com/DarrenPratt/Drelwick/issues/242)
- [D: Add deliberate matter template update review with optional local provenance](https://github.com/DarrenPratt/Drelwick/issues/243)
- [E: Add safe explicit publication matter page deletion and recovery](https://github.com/DarrenPratt/Drelwick/issues/244)

No live cross-book dependencies, automatic updates, remote sync, accounts, shared
libraries, arbitrary template expressions, custom styling, bundled assets, plugin
runtime, legal boilerplate guarantees, book-wide author identity schema or theme
migration. Safe deletion of existing publication pages is separately tracked:
current saves prohibit it; it is not needed for copy-on-apply, Replace or Insert.
No runtime or desktop implementation belongs in #134’s closing PR.
