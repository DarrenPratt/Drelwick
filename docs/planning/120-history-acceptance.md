# Issue #120 acceptance evidence

Starting state: clean `main`, `2484096` (PR #187). Implementation branch:
`feature/120-chapter-history`. Product: CORE. One focused PR; no merge.

## Dependency verification

The rename preserved issue numbers. #36 maps to stable plan 35 and merged PR
#103 (`8e892ff`); #37 maps to plan 36 and merged PR #105 (`0964d53`); #40 maps to
plan 39 and merged PR #108 (`85e850f`). Verified live issue/PR bodies and merged
state, then inspected the actual schemas, history service, runtime, save/dirty
coordination, retention and recovery implementation. Existing tests exercise
snapshot metadata/suppression/write failures, retention boundaries, and startup
recover/discard/cancel with preservation. Runtime scheduling is additionally
provided by PR #153. No prerequisite rewrite was required.

## Evidence references

- **H**: `packages/core/src/history.ts` / `packages/core/test/chapter-history.test.ts`:
  validated metadata and read-only preview; malformed version, identity, semantic
  content, filename, timestamp and truncated data; changed/pruned selection;
  missing chapter; retention; rich restore and repeated restore; failed snapshot
  creation, suppressed snapshot, absent persisted snapshot and wrong content;
  failed commit; complete/truncated interrupted writes; actual child-process exit
  before/after rename; image references; clock skew.
- **S**: `packages/core/src/chapter-saving.ts`, exercised by **H**. Existing
  `chapter-saving.test.ts`, `atomic-writer.test.ts`, `history.test.ts` and
  `recovery.test.ts` additionally cover ordinary persistence, atomic failure,
  retention boundaries and startup decisions.
- **UI**: `apps/desktop/src/renderer/App.tsx` and `ChapterHistoryDialog.tsx` /
  `apps/desktop/test/project-workflows.test.ts`: unchanged clean/dirty preview,
  separate confirmation/cancel, unsaved B flushed before restore, editor held
  unchanged during persistence, flush/snapshot/commit error responses, successful
  reload, missing chapter and pruned-selection refresh.
- **P**: `apps/desktop/test/history-preview.test.ts`: real TipTap semantic
  formatting, inert script-looking prose, read-only content, disabled link
  navigation, image placeholders and no local/remote resource requests.
- **IPC**: `apps/desktop/src/main/ipc/project-handlers.ts`, shared request
  schemas and preload / `chapter-persistence-ipc.test.ts` and `preload.test.ts`:
  real filesystem restore through privileged operations, authorization, strict
  IDs/path rejection, explicit confirmation, correct project/chapter, metadata-only
  listing, persisted safety content, deleted target and manuscript-free logging.
- **E2E**: `tests/e2e/desktop.spec.ts`, test **Chapter History preserves unsaved B
  before restoring rich OLD and remains usable after restart**: real Electron,
  offline, persisted A/unsaved B/OLD, confirmation, B safety snapshot, formatted
  OLD and unchanged identity, restart and preview of B with original timestamp.
- **Community**: repository build, strict typecheck, workspace smoke and complete
  test suites run in this Community checkout with no Pro dependency or service.

## Acceptance audit

| #   | Requirement                              | Result | Implementation and executable evidence                                                                                     |
| --- | ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Validated snapshot listing               | PASS   | H reader/list service; validated metadata and malformed-entry tests; IPC                                                   |
| 2   | Canonical chapter identity               | PASS   | H compares directory/file/envelope UUIDs; wrong/deleted target tests; IPC                                                  |
| 3   | Timestamps                               | PASS   | H validates ISO created and sorts deterministically; H metadata/tie tests; E2E reopened timestamp                          |
| 4   | Preview                                  | PASS   | Separate read-only semantic editor; P and E2E                                                                              |
| 5   | Preview leaves current content unchanged | PASS   | UI compares live JSON; H compares authoritative file bytes; E2E keeps persisted A                                          |
| 6   | Preview does not dirty                   | PASS   | UI asserts clean status/no save and unchanged revisions; E2E retains unsaved B status                                      |
| 7   | Explicit action                          | PASS   | UI Restore/Confirm controls and no restore call on selection; IPC rejects missing confirmation                             |
| 8   | Clear confirmation                       | PASS   | UI asserts safety/unsaved explanation and cancel; E2E checks confirmation before disk change                               |
| 9   | Synchronize current editor               | PASS   | App flush and clean/in-flight guards; UI checks save precedes restore                                                      |
| 10  | Preserve unsaved work                    | PASS   | UI request contains B; IPC saves B; E2E restarts and previews B                                                            |
| 11  | New snapshot before replacement          | PASS   | S creates before-replace under save lock; H inspects B snapshot inside commit callback before write                        |
| 12  | Verify persistence of safety snapshot    | PASS   | S re-reads and compares content/identity; H absent/wrong snapshot tests abort                                              |
| 13  | Snapshot failure aborts                  | PASS   | S; H throw/suppressed/absent/wrong-content tests; UI snapshot error retains B                                              |
| 14  | Flush failure retains edits              | PASS   | UI failed flush leaves B dirty, never calls restore; E2E success covers same flush path                                    |
| 15  | Validate historical content now          | PASS   | H current snapshot schema; S semantic and chapter validation; H invalid semantic/version tests                             |
| 16  | Shared persistence path                  | PASS   | History handler invokes saveChapter; S uses same atomic writer; H commit injection; IPC real disk                          |
| 17  | Failed restore recoverable               | PASS   | H failed commit retains B and safety; UI error does not replace editor                                                     |
| 18  | Interrupted restore uses recovery        | PASS   | H complete/truncated temporary tests and child-process exits use existing RecoveryService; S unchanged writer              |
| 19  | Prior content retained after success     | PASS   | H verifies B before commit and after reopen; E2E verifies/reopens B                                                        |
| 20  | Identity remains correct                 | PASS   | S preserves envelope/manifest; H checks ID/title/status/order; E2E checks ID                                               |
| 21  | Missing/deleted chapters safe            | PASS   | IPC membership check and S locked load; H deleted/wrong chapter rejection; UI disables missing target                      |
| 22  | Stale snapshots safe                     | PASS   | H current schema and fingerprint checks; H changed/pruned/unsupported tests; UI refresh invalidation                       |
| 23  | Invalid snapshots not restorable         | PASS   | H schema/identity/path reader shared by restore; malformed cases reject reads; S revalidates                               |
| 24  | Corrupt entries isolated                 | PASS   | H per-entry omission/count; malformed tests retain valid entry                                                             |
| 25  | Existing retention                       | PASS   | Existing applyHistoryRetention unchanged; history.test.ts controlled boundary tests; H pruning test                        |
| 26  | Safety not prematurely pruned            | PASS   | IPC settles prior work and retains after commit; H pre-write verification and post-retention B; E2E retained B             |
| 27  | Restart                                  | PASS   | E2E restarts Electron, checks OLD and previews B; H process exit/reopen tests                                              |
| 28  | Asset references                         | PASS   | Normal S asset semantics; H shared/missing image restore verifies unchanged bytes/references; P no resource fetching       |
| 29  | Restricted renderer access               | PASS   | Strict project/chapter/snapshot contracts, trusted IPC and bounded reader; IPC unauthorized/path/ID tests; preload routing |
| 30  | No manuscript logging                    | PASS   | History emits fixed domain errors; IPC asserts logs contain neither preview nor B; P does not log prose                    |
| 31  | No tracked-changes implication           | PASS   | UI exposes Chapter History/Snapshot/Preview/Restore, verified by UI/E2E; actual implementation is snapshot replacement     |
| 32  | No collaboration                         | PASS   | Local filesystem S/H and restricted local IPC; offline E2E asserts no HTTP requests                                        |
| 33  | Independent Community                    | PASS   | Community build/typecheck/workspace smoke and offline E2E; no added dependency                                             |

## Fresh diff review

Reviewed all changed persistence, IPC, UI, tests and documentation against the
issue's failure checklist. Corrections include stopping old runtime timers before
restore; synchronously freezing editing before flush; keeping editing disabled
on uncertain IPC outcomes; validating preview fingerprints at execution; advancing
modified time through clock skew; rechecking trusted frame after asynchronous
reads; avoiding overlapping poll reads; and resetting preview when selection or
refresh changes. The preview test was renamed to `.test.ts` to match actual Vitest
discovery, then executed successfully rather than relying on an undiscovered test.

No direct snapshot-to-chapter copy, new history schema, recovery decisions on
browse, snapshot consumption, title matching, silent undo/undelete or manuscript
logging was introduced. The full test/restart evidence covers actual behavior,
not just intended architecture.

## Limitations

History has the existing time-based retention and interval granularity; no
every-keystroke history is claimed. Preview does not resolve images. Deleted
chapters have no resurrection workflow. Unsupported snapshots need a compatible
version or manual inspection. Process interruption retains the existing explicit
stale-lock inspection requirement. Native execution in this session is Windows;
no macOS/Linux physical power-loss validation is claimed.

## Repository checks

Final command results are recorded in the PR and delivery response. Any failed
development checks were corrected before the final full verification.
