# Chapter references and backlinks (#166)

Product: CORE (`product:core`). Explicit local chapter links support characters,
locations, canon, timeline events and research/general notes, offline without an
account or Pro dependency. Automatic mention detection, scene/range anchors,
continuity analysis, global search (#167), AI and cloud collaboration are excluded.

## Using links

Open **Chapter references and backlinks** above the manuscript. The panel lists
references linked to the current chapter. Choose any Story Bible record, open its
read-only details, and select **Attach current chapter**. The details list every
linked chapter, with **Open chapter** and **Remove chapter link** controls. Chapter
links and reference details are available in this panel without leaving or
unmounting the manuscript editor. Edit reference prose in its existing Story Bible
editor. **Refresh chapter links** rereads saved records, labels and resolutions;
no title is used as an identifier. Duplicate names are distinguished by kind/UUID.

Navigation flushes manuscript autosave and uses the existing chapter-selection
workflow. A failed save blocks navigation and retains the editor and its edits;
retry saving or continue editing to cancel navigation. There is no new destructive
manuscript discard shortcut. Existing reference editors retain their established
save/discard/cancel controls. Read-only reference navigation does not discard their
drafts. A concurrent reference edit is protected by revision/fingerprint checks:
refresh the link panel before retrying; if an open reference editor holds an older
revision, preserve its draft and reload that record before reapplying the edit.

Controls use native labels, selects and buttons, with visible status/error text.
Opening details focuses the heading; returning focuses the selector. Unresolved
chapter links display their UUID/title and resolution, disable navigation and
remain removable. **Retarget to current chapter** requires explicit confirmation
and retains the edge ID. Deleted references remain listed with their links and
read-only details; restore through the corresponding Story Bible editor before
changing their links. Incomplete reference inventories disable mutations, retain
saved edges and report the incomplete result.

## Authoritative data and compatibility

Reuse `packages/project-model/src/reference.ts`'s strict version-1 reference/link
contracts and the [Story Bible contract](story-bible.md#link-schema-and-resolution).
Each reference record owns its chapter edges in `reference/<kind>/<uuid>.json`.
The chapter panel is an inbound view of these same edges, not a second store.
Reference prose and links never enter manuscript documents. Link IDs and target
UUIDs are stable; names, paths, rendered positions and backlink indexes are not
persisted in links. Backlinks rebuild under the core operation lock from captured
records and chapter membership, sorted by source UUID then edge UUID. Outgoing
links retain their authoritative array order.

The restricted existing `reference:execute` IPC adds `link-attach`, `link-remove`
and `link-retarget`. Requests require the source kind/UUID, project ID, expected
revision, exact-byte SHA-256 fingerprint and generation. Attach/retarget also need
a valid chapter UUID; remove/retarget identify the existing chapter edge. Main
checks the sender/top frame and active project, accepts no renderer filesystem
path, and preserves sandbox/context isolation/disabled Node integration. Core
validates active targets, uniqueness and strict project-model schemas, then uses
the existing snapshot/draft/atomic replacement protocol. No private payloads are
logged. Failed writes preserve the previous valid record and available recovery
evidence. Pending recovery continues to use the existing Story Bible recovery
contract; this issue does not add a general recovery UI.

No format migration is required: project v2, format v1, chapter v1 and reference v1
remain unchanged. Empty `reference/` remains valid. The existing project v1→v2
migration and backup preserve reference metadata. No database or backlink file is
introduced. Older record editors must preserve link arrays; the character editor
now does so as the other existing editors already did.

| Operation                          | Result                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Rename/reorder/status/content edit | IDs and links unchanged; refresh derives new labels.                                             |
| Soft-delete/restore reference      | Payload and edges retained; deleted sources visible in this panel and restored with the same ID. |
| Delete chapter                     | Edges retained as missing; restoring the same manifest identity resolves them.                   |
| Duplicate chapter                  | New identity has no copied links.                                                                |
| Split chapter                      | Links stay on the original identity; the new chapter has none.                                   |
| Merge chapters                     | Survivor links remain; removed identities become missing until explicit removal/retargeting.     |
| Remove then attach                 | New edge UUID; prior state remains in reference history.                                         |

## Prerequisite and boundary evidence

Verified on 17 October 2026: issues #119, #162, #163, #164 and #165 are closed.
Their merged PRs #185 (`2d4c8ec`), #220 (`7bbd402`), #221 (`6716142`),
#222 (`418fb4d`) and #223 (`2e2f0a8`) are ancestors of the implementation branch.
Actual implementations inspected: core chapter organisation/deletion/rename,
strict reference model and atomic core service, and CharacterManager,
LocationManager, CanonResearchManager and TimelineManager/TimelineAssociations.
The #160 Story Bible contract, design §§24–28, technical specification §§13/69
and local publishing plan document the design and CORE boundary. Advanced
commercial allocation remains the separate post-#203 owner review.

## Acceptance evidence

| Acceptance criterion                                        | Evidence                                                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Attach/remove and bidirectional navigation                  | Core tests cover all five kinds; desktop panel tests and native Electron chapter-links scenario cover both directions and keyboard controls.                                         |
| Stable, versioned, recoverable metadata outside manuscripts | Existing strict project-model v1 schema; new operations reuse atomic drafts/snapshots; tests compare unchanged manuscript bytes and preserved record bytes after failures.           |
| Rename/delete/duplicate/split/merge and unresolved links    | Core integration tests execute real chapter lifecycle operations, reopen and retarget; desktop tests display missing/invalid/unsupported/deleted states.                             |
| Dirty-state preservation and rebuilt backlinks              | Desktop failed-flush/retry tests, real pending-edit Electron navigation, deterministic multi-source core rebuild/reopen tests.                                                       |
| No automatic mentions or range anchors                      | Only explicit chapter UUID requests, existing strict link schema and scoped panel.                                                                                                   |
| Export isolation                                            | Core tests compare semantic publication inputs before/after links and inspect DOCX/EPUB archives; existing offline reference Electron scenario inspects actual DOCX/EPUB/PDF output. |
| Restricted IPC and offline Community                        | IPC tests reject paths, invalid IDs/fingerprints, foreign projects and untrusted frames; native scenario records zero network requests.                                              |

All five issue acceptance criteria above: **PASS**. Validation on Windows:

- `pnpm install --frozen-lockfile`: PASS (pinned pnpm 10.34.5).
- `pnpm lint` and `pnpm format:check`: PASS.
- `pnpm typecheck`: PASS, including its `pnpm build`.
- `pnpm test`: PASS, 101 test files / 1,183 tests.
- `pnpm check:workspace`: PASS, including architecture checks and workspace build.
- `pnpm exec playwright test tests/e2e/chapter-references.spec.ts tests/e2e/references.spec.ts`:
  PASS, both native Electron scenarios, including generated PDF inspection.
- `git diff --check`: PASS.

Builds retain the existing advisory about renderer chunks over 500 kB; no build
failure. Frozen install reports ignored optional dependency build scripts as on
the existing checkout. No dependencies were changed. Native verification is Windows only;
no new macOS/Linux native runtime claim is made. External non-cooperating writers
remain subject to the existing stale-write limitations. Reference recovery UI,
advanced linking and global search remain outside #166.

## Changed files

- Core and transport: `packages/core/src/references.ts`,
  `packages/shared/src/reference-contracts.ts`. Existing project-model link schemas
  are reused unchanged.
- Desktop: `apps/desktop/src/renderer/ChapterReferences.tsx`, `App.tsx`,
  `CharacterManager.tsx` (all three in the renderer directory).
- Tests: `packages/core/test/references.test.ts`,
  `apps/desktop/test/chapter-references.test.ts`, `character-manager.test.ts`,
  `reference-ipc.test.ts` (the latter three in desktop tests), and
  `tests/e2e/chapter-references.spec.ts`.
- Documentation: `README.md`, `docs/README.md`, this document,
  `docs/technical-spec.md`, `docs/planning/local-publishing-plan.md`.
