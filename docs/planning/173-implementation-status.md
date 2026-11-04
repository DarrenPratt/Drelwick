# #173 local revision review delivery

Product classification: CORE. This branch implements local revision review only.
Read-only comparison remains the existing #172 implementation. No cloud, AI,
licensing or Pro work is included. Review and merge are separate from this PR.

## Prerequisites and reused foundations

The starting working tree was clean on `main` at `37982eb`. GitHub issue state,
merged PRs and actual implementations were checked before changes:

| Issue | Merged PR and commit                             | Functional reuse                                                                                  |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| #169  | #226, `24f9d144e6172e90fdb9c44b16d89ab593a233ea` | Approved workflow, format and R/E/F contracts; CORE scope                                         |
| #170  | #227, `60761ca4758db3f9e6242503b6fd309636908a3c` | Strict v3 bundle, transactions, mapping companions, drafts, recovery and restricted editorial IPC |
| #171  | #229, `1f987f2267d5b596f7d98f153bafdfa1fbb95622` | Consistent named snapshots, mandatory safety capture, asset closure and restore                   |

All three issues were closed; these merge commits are ancestors of the branch.
The prerequisite editorial-editing, editorial-transactions and snapshot suites
were executed, rather than treating documentation as implementation evidence.

## Implementation and acceptance mapping

| Requirement                                                         | Delivered behavior and files                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit controls and visible insert/delete/format changes          | `RevisionTracking.ts`, `RevisionPanel.tsx`: saved per-chapter mode, indicator, decorations, accessible original/proposed review and format detail                                                                                   |
| Individual and explicitly scoped bulk review                        | `revision-service.ts`, `revision-handler.ts`, `revision-contracts.ts`: opaque frame/session token, exact generation/revision/file hashes and group IDs, mandatory #171 safety capture, atomic #170 decision transaction             |
| Pending/comment integrity across save, reopen, history and recovery | `revision-replay.ts`, `revision-anchors.ts`, `editorial-editing.ts`, `chapter-saving.ts`: native companion validation, exact inverse targets, immutable original evidence, retained discussions and existing dirty acknowledgements |
| Explicit output policy and privacy                                  | `book-assembly.ts`, `revision-projection.ts`, DOCX/EPUB/print/preview adapters: accepted/proposed/cancel for each operation, exact source binding, semantic output allowlist; Word review import rejected explicitly                |
| Previous valid content and stale rejection                          | Shared transaction journal/images/drafts and named snapshots; no partial stale bulk decision, unknown external bytes preserved, original receipt retry                                                                              |
| Command and chapter integration                                     | Typing/IME, paste, formatting, spelling, Replace One, scoped Replace All; review-first split/merge/history restore; projected duplicate; complete recoverable deletion                                                              |

`packages/project-model` owns strict patches and replay/grapheme validation;
`packages/core` owns normalization, projections, review, anchors and persistence;
`apps/desktop` owns TipTap/UI and restricted Electron adapters. The renderer-safe
revision subpath imports no privileged filesystem code. Existing security settings
remain context isolation, sandbox and disabled Node integration.

## Approved validation matrix

All fixtures contain synthetic content. Tests use real files, actual TipTap steps,
I/O fault injection and process termination; they do not require network services.

| Case | Executable evidence                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01  | `revisions.test.ts`, `revision-editor.test.ts`, native `revision-review.spec.ts`: insertion, typing/IME grouping, exact combine preview/cancel and superseded identity                                |
| R02  | Pure touching/overlap closure, exact consent IDs, canceled source immutability, native collision controls                                                                                             |
| R03  | Insert/delete/replace/semantic structures, disjoint decisions in either order, annotation inverse targets, review-created retained-slice comments, backup/reopen                                      |
| R04  | Tracking-off disjoint/collision fixtures, native off indicator and three choices, scoped replacement consent and cancellation                                                                         |
| R05  | Format before/after and native editor undo/redo, saved review companion undo, Unicode emoji/combining sequences, headings/lists/quotes/epigraphs/scene breaks/images                                  |
| R06  | Stale generation/byte-hash/exact group sets; IPC frame/epoch/cancel ownership; no partial writes                                                                                                      |
| E01  | Actual DOCX/EPUB selected text controls, independent preview choice, cancel preserves destination; native Chromium PDF accepted/proposed controls and PDF export cancellation                         |
| E02  | Same-generation external byte mutation blocks DOCX/EPUB publication; PDF source/projection must match reviewed preview                                                                                |
| E03  | Every DOCX/EPUB ZIP part inspected; actual PDF page text, metadata, annotations, outline and attachments inspected for private canaries and revision IDs                                              |
| E04  | DOCX parser fixtures reject all unresolved Word revisions and comment parts/anchors explicitly, preserving source and staging boundaries                                                              |
| F01  | IPC preview/cancel writes no source bytes and is session-scoped; pending envelopes reopen without any implied review decision                                                                         |
| F02  | `revision-failures.test.ts`: actual safety copy/sync, draft sync, first/last publication and commit-marker failures preserve exact previous pending bundle                                            |
| F03  | `revision-recovery.test.ts`: real terminated review before marker rolls back complete generation; shared #170 tests verify after-bundle draft offer                                                   |
| F04  | Termination after committed marker recovers after generation; original operation retry returns original identity and rehydrates companion evidence                                                    |
| F05  | Shared `editorial-transactions.test.ts` kills writers/recovery at direction boundaries and blocks external changed hashes/missing images; revision payload restart tests repeat recovery idempotently |
| F06  | Real editor B during paused save A (success and failure), exact captured acknowledgements, dirty B retained and subsequent save validated; existing navigation/quit/session-marker suites             |

Pending snapshot capture/restore and portable archive round-trips are exercised in
`revision-workflows.test.ts`, including exact retained deletion targets and both
comparison projections. No #172 diff engine was duplicated.

## Checks and practical limits

Executed checks (Node 24.18.0, pnpm 10.34.5, Windows):

| Check                            | Result                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS                                                                                                                            |
| `pnpm lint`                      | PASS                                                                                                                            |
| `pnpm format:check`              | PASS                                                                                                                            |
| `pnpm typecheck`                 | PASS, including production build and test TypeScript                                                                            |
| `pnpm test`                      | PASS: 135 files, 1,382 tests                                                                                                    |
| `pnpm build`                     | PASS; existing Vite chunk-size advisory remains                                                                                 |
| `pnpm check:workspace`           | PASS, including Community boundary tests and workspace smoke                                                                    |
| `pnpm test:e2e`                  | PASS: all 37 native Electron cases                                                                                              |
| Final focused validation         | PASS: 14 unit/integration cases and both native revision workflows after the final Unicode-safe retained-comment context change |

Actual DOCX/EPUB ZIP-part and Chromium PDF text/metadata/annotation inspections
passed. The original native run exposed a stale-message wording regression and
test synchronization races; fixes were verified by the clean full rerun above.
Timeline restart now uses normal quit so reference refreshes drain, and annotation
keyboard tests wait for editability after asynchronous save acknowledgement.
The tested
native platform is Windows; this does not claim native macOS/Linux or physical
IME/device power-loss certification. Composition metadata is exercised through
the actual ProseMirror plugin. Existing cross-platform code paths remain shared.

Split/merge and text-only restore intentionally require review first. Bulk review
is explicitly scoped to one chapter; Replace All has its own explicit manuscript
scope and one transaction. Oversized native replacement combine previews require
review in the affected chapters first (16,000-character dialog bound). No hidden
partial combination is applied. Existing document/group/payload/token/companion
limits fail safely with previous content and drafts retained.

Original/superseded review evidence stays in retained transaction images. The UI
flushes the prior unit before opening a combine decision, and privileged save
refuses a superseded unit without an exact saved predecessor. No background pruning,
second journal or independent persistent undo stack is introduced. Keystrokes not
durably staged remain outside recovery guarantees. Unknown external changes block
recovery; users retain files/images for explicit inspection.
