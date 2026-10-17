# Local timeline events (#165)

Product: CORE. Use **Timeline** in the workspace to create and edit local events.
The form follows the existing Story Bible/Locations autosave and dirty-state
patterns. Title is required; date, sequence, description and notes are optional.
Tags use the existing reference schema. Dates accept fictional labels such as
`Second moon` and are never parsed into calendar values.

## Ordering and associations

Events sort by numeric sequence ascending (including negative values and zero),
then events without a sequence. Equal sequences and unsequenced events sort by
stable UUID. Titles and dates do not change this order. The same pure core
comparator orders persisted listings and the editor's saved summaries.

Choose an existing chapter, character or location in the labelled native selector,
then **Add association**. Duplicate targets are excluded. Core allocates link IDs;
the editor retains them after saving and during subsequent edits. **Remove
association** is an explicit event edit. No target name, manuscript position or
filesystem path is persisted in a link.

**Open** saves pending event edits first. Chapter links use the existing manuscript
navigation/save guard. Character and location links read their current record
through restricted IPC and open a read-only detail view inside the panel. **Back
to event** restores focus to the opening button. Edit targets using their existing
Story Bible or Locations editor. General linking/backlinks and integrated target
editing remain #166; this issue does not add chapter backlinks.

**Refresh associations** reloads names and resolution without changing the event
or its draft. Renames retain IDs. Deleted, missing, invalid and unsupported targets
remain visible, with disabled Open controls and their stored IDs when no valid
label exists. Refresh failures retain links and report incomplete information.
New links require an active valid same-project target at save time; existing
unresolved links survive unrelated event edits.

## Persistence, compatibility and security

The implementation reuses `packages/project-model/src/reference.ts` and the #161
version-1 `timeline` schema. Authoritative files remain
`reference/timeline/<uuid>.json`; associations remain the shared `links` array.
No project, book, chapter or reference schema version changes, data conversion,
new database, seeded records or migration are needed. The existing verified
project v1-to-v2 migration preserves reference bytes. Backups include records,
tombstones, history and durable recovery drafts under the existing contract.

The form autosaves after 750 ms and supports **Save event**, application Save,
explicit discard, delete and restore. Hidden panels retain drafts. Project
switch/close, backup/import and application shutdown use the existing flush and
navigation guards with the timeline editor included. All reference editors and timeline association reads share the existing renderer
IPC queue, preventing background reads from racing event saves or discard/reload.
Only the captured form is acknowledged; edits typed during saving remain dirty. New core-assigned link IDs
are reconciled without clearing newer edits.

Validation failures leave the form editable. Stale/rejected saves keep the draft
and display an error; retry or explicitly discard/reload. Core uses the existing
project lock, revision and fingerprint checks, verified previous-state snapshots,
durable draft and atomic replacement. Failed writes preserve the prior valid
bytes. Pending/invalid recovery candidates block ordinary writes and are never
silently discarded. As with Locations, recovery requiring explicit candidate
review uses the existing #161 recovery API/independent file recovery; this PR does
not add a general recovery-review UI. Keystrokes never submitted to storage are
not recoverable after forced process termination.

All filesystem operations use `window.drelwick.references.execute` with authorized
project IDs and validated record IDs/content. No new Electron permissions, paths,
network calls, accounts or Pro dependencies are introduced. Errors remain fixed
content-free messages. Timeline content and links never become manuscript,
publication, EPUB, DOCX or PDF inputs.

## Dependency verification and acceptance evidence

On 17 October 2026, #161, #162 and #163 were closed and their PRs #219, #220 and
#221 were merged. Merge commits `8811b75`, `7bbd402` and `6716142` are ancestors of
this implementation. Their existing model, core, IPC, character and location
suites passed (93 tests) before implementation. The normative prerequisites are
[technical specification §69](technical-spec.md#69-timeline-model),
[design §27](design.md#27-timeline), the [Story Bible contract](story-bible.md), and
[owner sequencing](planning/local-publishing-plan.md#story-bible-design-and-owner-sequencing).
The commercial addendum explicitly classifies local CRUD and links as CORE;
advanced continuity/series/editorial allocation remains after #203.

| Acceptance criterion                                       | Result and evidence                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event CRUD and approved fields                             | PASS: timeline manager tests and offline Electron create/edit/delete/restore/reopen. Existing strict model schema remains authoritative.                                                                                               |
| Deterministic ordering, ties and optional/fictional dates  | PASS: core listing tests cover negative, zero, tied, maximum-safe and absent sequences with fictional/calendar/absent dates.                                                                                                           |
| Stable chapter/character/location selection and navigation | PASS: real IPC Electron test creates all three links, opens both record views and a manuscript chapter; native controls and focus return exercised with keyboard.                                                                      |
| Renamed/deleted/missing targets retained                   | PASS: core tests rename chapter/character, remove targets, delete references and preserve links across event edits/reopen. UI tests show all four unresolved states; Electron checks refreshed rename/deletion and unchanged link IDs. |
| Safe persistence and export isolation                      | PASS: core failure checkpoints preserve previous timeline bytes and recovery evidence; UI tests retain failed/in-flight drafts. Existing assembly/EPUB/DOCX and offline reference PDF tests cover reference exclusion.                 |

New coverage is in `apps/desktop/test/timeline-manager.test.ts`,
`packages/core/test/references.test.ts` and `tests/e2e/timeline.spec.ts`.
The latter also verifies unchanged manuscript bytes and no HTTP requests.
Malformed records, unsafe IPC/path requests, backups and reference recovery
continue to use the existing model/core/IPC regression suites.

Cross-platform native keyboard/screen-reader and filesystem durability validation
on macOS/Linux is not established by the Windows run. Global search (#167),
general backlinks (#166), cross-book chronology, continuity checking, cloud and
advanced commercial features remain outside this change.

Verification on Windows, 17 October 2026: frozen-lockfile install, `pnpm lint`,
`pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` (also run by
quality scripts), and `pnpm check:workspace` passed. The full Vitest run passed
100 files / 1,160 tests. Targeted Electron coverage runs the timeline, Locations,
and reference persistence/export scenarios; the final timeline scenario also
passed three consecutive runs after the shared reference queue fix. Vite retains
its existing large-chunk warning, and installation reports the existing ignored
build scripts. Neither prevented successful builds/checks. Full cross-platform
E2E and coverage measurement were not run for this issue.
