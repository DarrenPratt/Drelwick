# Issue #119 acceptance audit

Starting state: clean `main`, `06efb98` (merged PR #184). Work is confined to
`feature/119-chapter-organisation`. The initial implementation checkpoint is
`180d9b9`; subsequent review hardening belongs to the same PR. No merge is part
of this work. Product classification: CORE / `product:core`.

## Evidence key

- **Core**: [chapter organisation](../../packages/core/src/chapter-organisation.ts),
  [semantic splitting/merging](../../packages/core/src/chapter-semantics.ts),
  [ordering helper](../../packages/core/src/chapter-ordering.ts).
- **Transaction**: [shared journal/commit/recovery](../../packages/core/src/manuscript-replacement.ts),
  [journal validation](../../packages/project-model/src/replacement-journal.ts),
  [history](../../packages/core/src/history.ts),
  [recovery scan](../../packages/core/src/recovery.ts).
- **UI/API**: [App](../../apps/desktop/src/renderer/App.tsx),
  [typed contracts](../../packages/shared/src/index.ts),
  [privileged handler](../../apps/desktop/src/main/ipc/project-handlers.ts),
  [preload](../../apps/desktop/src/preload/preload.ts).
- **Operations tests**: [chapter-organisation.test.ts](../../packages/core/test/chapter-organisation.test.ts).
- **UI tests**: [project-workflows.test.ts](../../apps/desktop/test/project-workflows.test.ts),
  `chapter organisation` describe block.
- **IPC tests**: [chapter-persistence-ipc.test.ts](../../apps/desktop/test/chapter-persistence-ipc.test.ts)
  and [preload.test.ts](../../apps/desktop/test/preload.test.ts).
- **E2E**: [desktop.spec.ts](../../tests/e2e/desktop.spec.ts),
  `organises formatted chapters offline with duplicate split merge status and restart`.

## Acceptance criteria

Every PASS below has executable evidence, not just a design statement.

| #   | Criterion                                      | Result | Implementation and test evidence                                                                                                                                           |
| --- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Duplicate exists                               | PASS   | Core duplicate branch; operations test `duplicates rich semantic content…`; E2E navigator action.                                                                          |
| 2   | Duplicate has a new unique identity            | PASS   | Core UUID generation/exclusive publication; duplicate identity assertions and retained-orphan collision tests.                                                             |
| 3   | Duplicate preserves nodes/marks                | PASS   | Validated source content retained; exact rich-document equality after disk read.                                                                                           |
| 4   | Duplicate preserves assets                     | PASS   | Content references retained; real PNG/JPEG shared-asset test verifies original bytes and directory counts.                                                                 |
| 5   | Duplicate preserves order                      | PASS   | Shared ordering helper inserts after source; exact ordered UUID assertion and reopen.                                                                                      |
| 6   | Split uses explicit cursor                     | PASS   | UI ProseMirror selection and core position; UI test asserts actual position 6 and exact flushed document; E2E keyboard placement.                                          |
| 7   | Split conserves content                        | PASS   | Semantic tree cut; all accepted rich-document positions compare text, marks and atoms exactly once.                                                                        |
| 8   | Split preserves nodes/marks                    | PASS   | Ancestor/mark retention and schema validation; exact formatted-run, quote/list/epigraph and scene-break tests.                                                             |
| 9   | Split preserves assets                         | PASS   | Atom moves intact; real shared-asset test splits references between chapters.                                                                                              |
| 10  | Split creates one new identity                 | PASS   | Core UUID/new-file branch; split/reopen test asserts original and second IDs and exact order; collision rejection.                                                         |
| 11  | Split preserves order                          | PASS   | Insert immediately after source; split/reopen ordered UUID equality.                                                                                                       |
| 12  | Invalid boundaries rejected                    | PASS   | Core schema/position/grapheme checks; start/end/empty/out-of-range/surrogate/combining and UI selection tests.                                                             |
| 13  | Merge requires explicit adjacent selection     | PASS   | Checkboxes and confirmation plus core validation; E2E explicitly checks both chapters.                                                                                     |
| 14  | Nonadjacent merge rejected                     | PASS   | Canonical index check; operations test for nonadjacent/repeated/unconfirmed requests.                                                                                      |
| 15  | Merge uses canonical order                     | PASS   | Sort selected IDs by manifest order; reversed-selection test and E2E.                                                                                                      |
| 16  | Merge conserves content                        | PASS   | Concatenated block arrays; exact semantic equality and text conservation in merge/reopen test.                                                                             |
| 17  | Merge preserves nodes/marks                    | PASS   | Semantic document concatenation; rich-document and E2E italic paragraph assertions.                                                                                        |
| 18  | Merge preserves assets                         | PASS   | No asset mutation; real shared/distinct PNG/JPEG reference and byte assertions.                                                                                            |
| 19  | Merge identity is deterministic                | PASS   | First ID retained, second removed; merge test checks removed file/order and first title/status.                                                                            |
| 20  | Existing statuses exposed                      | PASS   | Canonical schema options in native select; UI test enumerates all four options.                                                                                            |
| 21  | Status persists                                | PASS   | Core journaled chapter update; every canonical status read back from disk.                                                                                                 |
| 22  | Invalid statuses rejected                      | PASS   | Canonical schema shared across boundaries; core invalid-status and privileged IPC tests.                                                                                   |
| 23  | Pending edits flushed                          | PASS   | Existing autosave coordinator; UI split test verifies save-before-operation event order and exact content.                                                                 |
| 24  | Save failure aborts safely                     | PASS   | Guard checks flush result/dirty/pending state; UI tests for duplicate, split and merge retain unsaved formatted content and never invoke operation IPC.                    |
| 25  | Snapshot precedes restructuring                | PASS   | Transaction snapshots before pending journal/writes; snapshot failure abort tests, original-content snapshot assertion and forced-snapshot recovery exclusion test.        |
| 26  | Recoverable multi-file persistence             | PASS   | Shared transaction extends existing journal; manifest-write failure and process-exit tests exercise chapters plus manifest.                                                |
| 27  | Manifest write failure tested                  | PASS   | Injected manifest writer failure for duplicate/split/merge after chapter writes; tests inspect changed destination and consumed-file removal before throwing.              |
| 28  | Recovery yields known valid state              | PASS   | Validated rollback and reopen; exact original envelopes/order after failures and restart.                                                                                  |
| 29  | Cancellation preserves originals               | PASS   | Native confirmation precedes operation; UI split/merge cancel tests retain unsaved document, no save or IPC; core cancellation after writes rolls back.                    |
| 30  | Interruption cannot silently leave mixed state | PASS   | Pending journal gates opening; process exits before and after manifest publication for all three operations; conflicting external revision is retained and reopen blocked. |
| 31  | Formatted round trips tested                   | PASS   | Rich semantic fixture includes heading, combined marks, lists, quote, scene break, link, Unicode and image; exact disk/reopen assertions and real E2E.                     |
| 32  | Status survives restart/reopen                 | PASS   | Every status uses `openProjectForEditing`; native application restart verifies final status.                                                                               |
| 33  | No accidental ID reuse                         | PASS   | Canonical order validation/exclusive publication; unique-ID, existing-ID and orphan `.json`/`.json.tmp` collision tests.                                                   |
| 34  | Independent Community build                    | PASS   | Repository build/typecheck/workspace smoke run with only Community packages; no Pro dependency added.                                                                      |

## Review corrections

- Extended the existing replacement transaction rather than composing chapter
  writes with an independent manifest update. Retained old journal compatibility.
- Kept new chapter publication exclusive and rejected UUID collisions with
  authoritative files and retained recovery files; pending manifest temporaries
  also block restructuring.
- Reused the ordering helper for ordinary reorder and structural updates, retaining
  manifest extension metadata and rechecking the manifest revision.
- Rejected grapheme boundaries across mark changes; corrected a test position
  that landed inside an emoji rather than weakening validation.
- Made malformed journal validation return a failed parse rather than throwing
  from a nested refinement, and added invalid identity/order journal tests.
- Guarded shutdown during pending operations, restored editor focus after success,
  ignored stale merge selections, and kept editing disabled on uncertain recovery.
- Added exact active-project authorization in main; all parser/operation errors
  use fixed messages without manuscript payload logging.

## Limits

Native execution was on Windows. macOS/Linux native smoke checks were not run.
The existing filesystem durability and external concurrent-editor limitations
remain. Invalid list-container boundaries are rejected; they are not silently
repositioned. History browsing remains #120; structural operations do not enter
editor undo. Existing missing assets retain their established placeholders.

The [behaviour and recovery guide](../chapter-organisation.md) records the exact
identity/title/status, boundary, cancellation and asset rules.

## Executed checks

Node `v24.18.0`, pinned pnpm `10.34.5`, Windows. Final full suite: 791 tests in
64 files; native E2E: nine tests. These commands were executed successfully:

| Exact command                                                     | Result                                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                  | PASS                                                                 |
| `pnpm lint`                                                       | PASS                                                                 |
| `pnpm format:check`                                               | PASS                                                                 |
| `pnpm typecheck`                                                  | PASS                                                                 |
| `pnpm test`                                                       | PASS — 791 tests                                                     |
| `pnpm build`                                                      | PASS — also executed by typecheck/test/E2E/smoke scripts             |
| `pnpm check:workspace`                                            | PASS                                                                 |
| `pnpm test:e2e`                                                   | PASS — nine Windows Electron tests                                   |
| `pnpm test:coverage`                                              | PASS — 791 tests; 67% statements, 69.37% lines across the repository |
| `pnpm exec playwright test --grep 'organises formatted chapters'` | PASS                                                                 |
| `pnpm exec playwright test`                                       | PASS — nine tests                                                    |
| `pnpm exec tsc -p tsconfig.test.json`                             | PASS                                                                 |
| `git diff --check`                                                | PASS                                                                 |

Focused Vitest runs also covered chapter organisation, ordering, replacement,
journal schemas, renderer workflows, persistence IPC and preload. Initial
development runs of build/typecheck failed on a semantic return type, the new API
mock, DOM options iteration and a test-edit syntax error; all were corrected.
Initial focused tests failed because one purported valid boundary was inside an
emoji and a new journal fixture omitted required timestamp milliseconds. Both
fixtures were corrected without weakening validation. Final full tests and
typecheck pass.

The existing Vite bundle-size warning remains informational. Native macOS/Linux
execution was unavailable in this Windows session; no such pass is claimed.
