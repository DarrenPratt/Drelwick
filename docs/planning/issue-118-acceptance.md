# Issue #118 implementation audit

The starting checkout was clean `main` at `5d900ec` (Drelwick rename, merged
PR #181). The requested SAREL/BookEditor issue numbers remain valid in the renamed
`DarrenPratt/Drelwick` repository. Work uses one branch and one focused CORE PR.

## Verified prerequisites

| Issue | Merged implementation    | Code and executed regression evidence                                                                                                                  |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #30   | PR #97, merge `1c9c441`  | Core chapter loading/saving, validated IPC/preload, semantic validation and atomic writer; `chapter-saving.test.ts`, `chapter-persistence-ipc.test.ts` |
| #34   | PR #101, merge `4c1a788` | `App.tsx` transition flush, core autosave coordinator and revision reducer; `project-workflows.test.ts`, `autosave.test.ts`, `document-state.test.ts`  |
| #36   | PR #103, merge `436dbdc` | Core history service and desktop history runtime; `history.test.ts`, `history-runtime.test.ts`                                                         |

All three PRs were verified merged using GitHub, and the implementation was
inspected rather than inferred from issue state. Ordinary editor undo is supplied
by the existing TipTap history extension. No generic multi-chapter transaction
existed: the migration journal only publishes format/manifest changes. This issue
adds a narrowly scoped replacement rollback journal using the existing atomic
writer, chapter lock, history snapshots, path validation and directory sync helper.

## Evidence keys

- **Engine**: `packages/core/src/manuscript-search.ts`;
  **S tests**: `packages/core/test/manuscript-search.test.ts`.
- **Transaction**: `packages/core/src/manuscript-replacement.ts`, with journal
  validation in `packages/project-model/src/replacement-journal.ts`;
  **R tests**: `packages/core/test/manuscript-replacement.test.ts`.
- **UI**: `apps/desktop/src/renderer/ManuscriptSearch.tsx` and `App.tsx`;
  **U tests**: `apps/desktop/test/project-workflows.test.ts`.
- **IPC**: shared search contracts, project handlers and restricted preload;
  **I tests**: `apps/desktop/test/chapter-persistence-ipc.test.ts`.
- **E2E**: `tests/e2e/desktop.spec.ts`, scenario beginning “finds live prose”.

## Acceptance evidence

| #   | Requirement                        | Status | Implementation and executed test evidence                                                                                           |
| --- | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Current-chapter search             | PASS   | UI active document + Engine; U unsaved search and S positions                                                                       |
| 2   | Whole-manuscript search            | PASS   | UI canonical chapter loading + Engine; S chapter ordering and E2E three matches                                                     |
| 3   | Match navigation                   | PASS   | UI cyclic positions + existing chapter flush; E2E next/previous across chapters and U failed navigation                             |
| 4   | Match counts                       | PASS   | Engine match array + UI status; S counts, U edit/review invalidation, E2E 1/3 and 3/3                                               |
| 5   | Case option documented             | PASS   | Engine Unicode literal flags + UI checkbox; S exact/folded counts; manuscript-search.md policy                                      |
| 6   | Whole-word option documented       | PASS   | Engine Unicode character boundaries + UI checkbox; S accented/punctuation/CJK/underscore cases                                      |
| 7   | Unicode search                     | PASS   | Engine grapheme boundaries without normalization; S multilingual/emoji/combining matrix                                             |
| 8   | Unsaved current edits searched     | PASS   | UI active-document overlay; U live prose and E2E newly typed text                                                                   |
| 9   | Semantic structure preserved       | PASS   | Engine clones validated nodes and edits inline fragments; S structure/links, R snapshots, E2E bold/scene break                      |
| 10  | Cross-node policy defined          | PASS   | Engine concatenates adjacent inline text runs; S plain/bold/italic matches and documented hard boundaries                           |
| 11  | Cross-node tests                   | PASS   | S text-node and mark-boundary matches; U actual cross-mark editor replacement                                                       |
| 12  | No chapter-spanning matches        | PASS   | Engine searches each chapter separately; S explicit chapter boundary                                                                |
| 13  | Replace One                        | PASS   | UI live range revalidation and ProseMirror transaction; U replacement/undo                                                          |
| 14  | Replace One marks/nodes            | PASS   | First-character marks and range-only replacement; U cross-bold/italic transaction and undo                                          |
| 15  | Current-chapter Replace All        | PASS   | Transaction explicit chapter ID; R scoped deletion leaves other chapters unchanged                                                  |
| 16  | Whole-manuscript Replace All       | PASS   | Transaction canonical IDs; R three-chapter write and E2E persisted results                                                          |
| 17  | Explicit scope                     | PASS   | UI selector/review + IPC optional chapter ID; U whole-scope request and E2E review text                                             |
| 18  | Review before mutation             | PASS   | UI separate review/confirm; U verifies no bulk call before confirmation and displayed counts                                        |
| 19  | Pending edits flushed              | PASS   | App autosave flush before IPC; U call ordering and E2E newer prose survives                                                         |
| 20  | Failed flush preserves edits       | PASS   | App aborts without IPC; U failure retains dirty editor                                                                              |
| 21  | Pre-bulk snapshot                  | PASS   | Transaction mandatory history before journal/writes; R snapshot contents/reason and snapshot failure                                |
| 22  | Recoverable multi-chapter writes   | PASS   | Transaction pending journal, atomic chapter writes, rollback; R second-write failure and child exit                                 |
| 23  | No unknown silent mixed state      | PASS   | Reader gate + rollback; R restores all chapters, or blocks editing with retained pending journal on external conflict               |
| 24  | Cancellation preserves originals   | PASS   | Transaction cancellation checkpoints/rollback; R cancellation before writes 0/1/2                                                   |
| 25  | Cancellation preserves newer edits | PASS   | App flush cancellation guard + Transaction originals; U delayed flush cancellation and R newly flushed prose                        |
| 26  | Undo/recovery tested               | PASS   | U independent ordinary editor undo; R snapshot and reopen rollback                                                                  |
| 27  | Injected persistence failure       | PASS   | R fails before second write after first succeeds; all chapter contents restored and verified after reopen                           |
| 28  | Formatted-text search tests        | PASS   | S bold, italic, mixed text and links                                                                                                |
| 29  | Formatted-text replacement tests   | PASS   | S inheritance/surrounding marks, U actual transaction/undo, I disk result, E2E bold                                                 |
| 30  | Chapter-boundary tests             | PASS   | S explicit no cross-chapter match and canonical independent positions                                                               |
| 31  | No sensitive logging               | PASS   | Fixed domain errors and no new content logging; I logger assertions exclude search/replacement text                                 |
| 32  | Community builds without Pro       | PASS   | Only existing Community workspace dependencies; repository build/typecheck/workspace checks                                         |
| 33  | No story-bible search              | PASS   | UI reads only canonical chapter IDs and Engine text nodes; S excludes attributes, I restricted request validation, E2E scope counts |

## Full-diff review corrections

- Corrected positions after empty paragraphs to use ProseMirror's two-token block size.
- Added an independent undo boundary so replacement cannot undo preceding typing.
- Invalidated selected offsets with document identity and checked the live editor again.
- Captured the normalized editor document when selecting a match, so harmless coalescing of loaded adjacent text nodes does not prevent Replace One.
- Avoided reselecting matches on every editor update, which could move the caret.
- Refreshed chapter documents after navigation and workspace word counts after bulk success.
- Used structural equality for rollback validation rather than JSON property-order equality.
- Rechecked files before each publication and refused existing chapter recovery temporaries.
- Kept the editor read-only on uncertain transport/recovery outcomes; reset that state only after successful reopen.
- Reported lock cleanup failure instead of silently reporting success, without throwing directly from a finally block.
- Reused captured text runs during replacement instead of rebuilding the traversal for every no-op check.
- Kept read-only format compatibility detection ahead of replacement recovery, so opening a newer unsupported project cannot trigger rollback writes.

## Repository checks

Executed successfully in the Windows workspace:

| Command                                                                                                               | Result                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                      | PASS, unchanged dependency graph                                                                        |
| `pnpm lint`                                                                                                           | PASS                                                                                                    |
| `pnpm format:check`                                                                                                   | PASS                                                                                                    |
| `pnpm typecheck`                                                                                                      | PASS                                                                                                    |
| `pnpm test`                                                                                                           | PASS, 62 files / 732 tests                                                                              |
| `pnpm build`                                                                                                          | PASS                                                                                                    |
| `pnpm check:workspace`                                                                                                | PASS                                                                                                    |
| `pnpm test:e2e`                                                                                                       | PASS, 8 native Electron scenarios                                                                       |
| `pnpm test:coverage`                                                                                                  | PASS, coverage run completed with 731 tests before the final additional editor-normalization regression |
| `pnpm exec vitest run packages/core/test/manuscript-replacement.test.ts packages/core/test/project-migration.test.ts` | PASS, 103 tests                                                                                         |
| `pnpm exec vitest run apps/desktop/test/project-workflows.test.ts`                                                    | PASS, 67 tests                                                                                          |
| `pnpm exec playwright test --grep 'finds live prose'`                                                                 | PASS, replacement workflow and captured review screenshot                                               |
| `git diff main --check`                                                                                               | PASS                                                                                                    |

Early build/typecheck, lint and targeted-test failures were corrected and rerun;
no check remains failing. Build reports Vite's non-fatal bundle-size warning.
Coverage measures the existing repository as well as this change and is not a
claim of complete coverage. The captured review screenshot is a local Playwright
artifact under `test-results/desktop-finds-live-prose-r-39cb6-d-reopens-formatted-results/`.

## Platform and recovery limits

See [the operational documentation](../manuscript-search.md). In particular, bulk
undo is snapshot/recovery based; the history browsing UI remains #120. External
filesystem edits are not watched live. Conflicting external revisions, a live or
foreign-host owner, PID reuse and interrupted recovery claims fail closed with
artifacts retained. Physical power-loss behavior and native execution on macOS and
Linux have not been verified in this Windows session. These are explicit limits,
not claims of untested platform validation.
