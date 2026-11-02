# #170 resumed implementation and validation

Product: CORE. GitHub confirms #169 merged in PR #226 and #119 in PR #185;
repository implementations and merge ancestry were checked before resuming.
The [approved matrix](169-editorial-delivery.md) remains normative.

## Work preserved and completed

The resumed tree already contained strict schemas/codec, migration, transactions,
generation checks, step replay, companion history, structural mapping, annotation
CRUD, sidebar controls, draft recovery, archives and export fixtures. These were
implementation candidates, not completed acceptance evidence. No changes were
reset or discarded; the earlier checkpoint commits remain intact.

This session fixed companion-redo test typing, native save/refresh contention,
metadata-only history coverage, stale recovery caused by editability updates,
filter labelling, mutation controls during refresh and routine upgrade notices
being announced as errors. Non-editorial projects return upgrade status without
acquiring the writer gate. The sidebar displays chapter context and invalid-draft
diagnostics. Failed/uncertain commands retain drafts and retry their original ID.

Durable drafts now have independent flushed/verified images under the approved
`drafts/<id>/files/` layout. Corrupt candidates remain preserved. Publication
rechecks the entire after inventory before committing. Additional filesystem,
process-kill, migration, import, privacy and IPC tests cover the required matrix.

## Acceptance evidence

| Contract                                                             | Executable evidence                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A01–A03 insertion edges/interior/points                              | Core `editorial-anchors.test.ts`, `editorial-editing.test.ts`: actual maps, affinities and immutable evidence.                                                                                                                                                                             |
| A04–A07 deletion, replacement, Unicode, overlapping targets and undo | Core `editorial-editing.test.ts`; desktop `editorial-history.test.ts`, `editorial-codec.test.ts`: exact lost slices, identical replacement orphaning, formatting, real history across saved generations, stale-event refusal and bounded deltas.                                           |
| A08–A09 split/merge/deletion/history restore                         | Core `editorial-anchors.test.ts`, `editorial-transactions.test.ts`: identities, multiple segments, semantic offsets and retained evidence. Existing #119/#120 suites remain regression coverage.                                                                                           |
| A10 import/paste                                                     | Core `editorial-import.test.ts`: identical title/text imports get new IDs and empty discussions; original files remain unchanged; paste uses actual maps.                                                                                                                                  |
| F02 file API failures                                                | Core `editorial-failures.test.ts`: safety-image write, draft fsync, first/last publication rename and commit-marker rename failure; prior bytes restored or recovery blocked with evidence retained.                                                                                       |
| F03–F05 process death/recovery                                       | Core `editorial-transactions.test.ts`: killed writers at draft/prepared/first/last publication/commit boundaries; killed rollback/rollforward at direction/image boundaries; repeated recovery, receipts, external conflicts and corruption.                                               |
| F06 newer edits during save                                          | Core `autosave.test.ts`; desktop `document-state.test.ts`, `project-workflows.test.ts`: captured acknowledgements retain newer transactions, serialized flush, failed switch/quit and retained dirty text/sidebar drafts.                                                                  |
| M01 migration                                                        | Core `editorial-migration.test.ts`: complete Unicode/assets/reference/history fixture; exact backup/unrelated bytes; interrupted backup/image/prepared/publication/commit; unsupported extensions preserved.                                                                               |
| M02 compatibility and IPC                                            | Model `editorial-runtime-schema.test.ts`, shared `editorial-contracts.test.ts`, desktop `ipc-contracts.test.ts`, `chapter-persistence-ipc.test.ts`: strict versions/encoding/bounds, old-schema rejection, trusted frame, active project, IDs/hashes/generation and private-log exclusion. |
| Publication and backups                                              | Core `editorial-exports.test.ts`: every DOCX/EPUB ZIP part, private canaries and review markup; exact archive/restore evidence without periodic history. Native `editorial.spec.ts` extracts actual Chromium PDF text/metadata/annotations with a positive manuscript control.             |
| Accessible local workflow                                            | Native `editorial.spec.ts`: keyboard selection/create, saved undo/redo, tombstone restore, offline reopen, retained discussions after last-chapter deletion and recovery preview/cancel/apply. Sidebar tests retain failed/uncertain drafts.                                               |

Empty revision envelopes require matching accepted/proposed content. Nonempty
pending groups and tracking mode are rejected until #173. No account, hosted
service, Pro dependency or manuscript AI modification is introduced.

## Validation and limits

Final Windows validation on 30 October 2026:

- PASS: `pnpm install --frozen-lockfile`.
- PASS: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`.
- PASS: `pnpm test` — 121 files, 1,284 tests.
- PASS: `pnpm check:workspace`, including Community architecture checks.
- PASS: `pnpm exec playwright test` — all 31 native Electron tests.
- PASS: `git diff --check`.

Earlier validation caught and corrected a TypeScript test error,
native contention/recovery failures, a routine upgrade alert regression and a
five-second timeout in the multi-generation filesystem scenario. Its dedicated
timeout now allows twenty seconds for real flushes during the concurrent suite.

Windows execution uses pinned repository tools. Native macOS/Linux execution is
unavailable. Existing directory-sync limits apply: killed-process and injected-I/O
tests do not prove hardware power-loss durability. Unwritten keystrokes cannot be
promised recovered. Partial images without a published journal remain preserved
and block recovery for manual inspection. External changes are never overwritten
as an automatic timestamp winner. Named snapshots, comparison and revision mode
remain #171–#173. No merge is authorized.

No #170 acceptance criteria remain outstanding on the tested Windows platform.
The next delivery steps are to commit the focused changes and open the PR with
`Closes #170`, preserving the checkpoint commits. If interrupted, inspect Git
status/log first, push the existing branch if needed and prepare that PR; do not
restart implementation or merge. Review and merge remain separate owner actions.

## Resumed working-tree file inventory

- [apps/desktop/src/main/ipc/project-handlers.ts](../../apps/desktop/src/main/ipc/project-handlers.ts)
- [apps/desktop/src/renderer/app.css](../../apps/desktop/src/renderer/app.css)
- [apps/desktop/src/renderer/App.tsx](../../apps/desktop/src/renderer/App.tsx)
- [apps/desktop/src/renderer/components/Editor.tsx](../../apps/desktop/src/renderer/components/Editor.tsx)
- [apps/desktop/src/renderer/components/EditorialDecorations.ts](../../apps/desktop/src/renderer/components/EditorialDecorations.ts)
- [apps/desktop/src/renderer/EditorialSidebar.tsx](../../apps/desktop/src/renderer/EditorialSidebar.tsx)
- [apps/desktop/test/chapter-persistence-ipc.test.ts](../../apps/desktop/test/chapter-persistence-ipc.test.ts)
- [apps/desktop/test/editorial-codec.test.ts](../../apps/desktop/test/editorial-codec.test.ts)
- [apps/desktop/test/editorial-history.test.ts](../../apps/desktop/test/editorial-history.test.ts)
- [apps/desktop/test/editorial-sidebar.test.ts](../../apps/desktop/test/editorial-sidebar.test.ts)
- [apps/desktop/test/project-workflows.test.ts](../../apps/desktop/test/project-workflows.test.ts)
- [docs/editing-revisions.md](../../docs/editing-revisions.md)
- [docs/editorial-format.md](../../docs/editorial-format.md)
- [docs/planning/170-implementation-status.md](../../docs/planning/170-implementation-status.md)
- [docs/planning/170-remaining-work.md](../../docs/planning/170-remaining-work.md)
- [docs/planning/170-validation.md](../../docs/planning/170-validation.md)
- [packages/core/package.json](../../packages/core/package.json)
- [packages/core/src/chapter-deletion.ts](../../packages/core/src/chapter-deletion.ts)
- [packages/core/src/chapter-loading.ts](../../packages/core/src/chapter-loading.ts)
- [packages/core/src/chapter-ordering.ts](../../packages/core/src/chapter-ordering.ts)
- [packages/core/src/chapter-organisation.ts](../../packages/core/src/chapter-organisation.ts)
- [packages/core/src/chapter-saving.ts](../../packages/core/src/chapter-saving.ts)
- [packages/core/src/editorial-anchors.ts](../../packages/core/src/editorial-anchors.ts)
- [packages/core/src/editorial-bundle.ts](../../packages/core/src/editorial-bundle.ts)
- [packages/core/src/editorial-editing.ts](../../packages/core/src/editorial-editing.ts)
- [packages/core/src/editorial-history.ts](../../packages/core/src/editorial-history.ts)
- [packages/core/src/editorial-service.ts](../../packages/core/src/editorial-service.ts)
- [packages/core/src/editorial-transactions.ts](../../packages/core/src/editorial-transactions.ts)
- [packages/core/src/index.ts](../../packages/core/src/index.ts)
- [packages/core/src/project-archive.ts](../../packages/core/src/project-archive.ts)
- [packages/core/src/project-migration.ts](../../packages/core/src/project-migration.ts)
- [packages/core/src/project-snapshot.ts](../../packages/core/src/project-snapshot.ts)
- [packages/core/test/editorial-editing.test.ts](../../packages/core/test/editorial-editing.test.ts)
- [packages/core/test/editorial-exports.test.ts](../../packages/core/test/editorial-exports.test.ts)
- [packages/core/test/editorial-failures.test.ts](../../packages/core/test/editorial-failures.test.ts)
- [packages/core/test/editorial-import.test.ts](../../packages/core/test/editorial-import.test.ts)
- [packages/core/test/editorial-migration.test.ts](../../packages/core/test/editorial-migration.test.ts)
- [packages/core/test/editorial-transactions.test.ts](../../packages/core/test/editorial-transactions.test.ts)
- [packages/project-model/package.json](../../packages/project-model/package.json)
- [packages/project-model/src/editorial-codec.ts](../../packages/project-model/src/editorial-codec.ts)
- [packages/project-model/src/editorial.ts](../../packages/project-model/src/editorial.ts)
- [packages/project-model/src/index.ts](../../packages/project-model/src/index.ts)
- [packages/project-model/test/editorial-runtime-schema.test.ts](../../packages/project-model/test/editorial-runtime-schema.test.ts)
- [packages/shared/src/index.ts](../../packages/shared/src/index.ts)
- [packages/shared/test/editorial-contracts.test.ts](../../packages/shared/test/editorial-contracts.test.ts)
- [pnpm-lock.yaml](../../pnpm-lock.yaml)
- [README.md](../../README.md)
- [tests/e2e/editorial.spec.ts](../../tests/e2e/editorial.spec.ts)
- [tests/helpers/editorial-project.ts](../../tests/helpers/editorial-project.ts)
- [tests/README.md](../../tests/README.md)
