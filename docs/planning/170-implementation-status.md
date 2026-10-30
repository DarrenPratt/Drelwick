# #170 working implementation evidence

The audit below records the interrupted checkpoint. It is retained as history;
the [resumed implementation and validation](170-validation.md) supersedes its
FAIL/PARTIAL assessments for the resumed branch.

This is an implementation audit of the current working branch, not a completion
claim. Product classification is CORE. #169 merged in PR #226 and #119 in PR #185.
The approved [delivery matrix](169-editorial-delivery.md) remains normative.

| Requirement                               | Status  | Evidence and remaining work                                                                                                                                                                            |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Strict schemas and v3 migration           | PARTIAL | Runtime schemas and verified-backup migration exist. Complete encoding, slice validation, limits and interruption matrix still require audit.                                                          |
| Atomic transactions and generation checks | PARTIAL | Before/after images, hash preconditions, manifest-last publication, replay receipts and recovery preflight are tested. Complete bundle validation and request preconditions must cover every mutation. |
| Draft recovery                            | FAIL    | Rolled-back transaction discovery and verified image reading exist. DraftV1 staging, preview, recover/discard/cancel and desktop recovery offers are incomplete.                                       |
| Editor anchor mapping and companion undo  | FAIL    | Pure mapping helpers exist. Editor edits currently invalidate anchors; StepMaps and companion deltas are not captured in atomic autosave.                                                              |
| Chapter lifecycle and history             | PARTIAL | v3 lifecycle and history restore paths exist. Restore preserves other-chapter segments and retained evidence. Full operation/mapping validation remains.                                               |
| Annotation CRUD and sidebar               | PARTIAL | Comments, replies, edits, tombstones, resolution, reattachment, filters and lost-text display exist. Focus restoration, tombstone restore and full keyboard tests remain.                              |
| Dirty state and autosave                  | FAIL    | Sidebar drafts guard common navigation/shutdown and have failed-save/discard tests. A complete text/editorial autosave bundle and all navigation paths remain unverified.                              |
| Archive and publication isolation         | PARTIAL | Editorial archive paths and semantic publication separation exist. Full DOCX/EPUB/PDF canary matrix is still required.                                                                                 |
| Empty revision envelopes                  | PASS    | Runtime chapter schemas reject nonempty pending revisions and unsupported tracking mode. Revision review remains #173.                                                                                 |

## Test mapping

`editorial-anchors.test.ts` exercises insertion affinity, points, deletion,
overlap, grapheme rejection and structural helper maps. This is partial A01-A09
coverage; it does not substitute for editor/undo/persistence integration. A10
remains incomplete.

`editorial-transactions.test.ts` exercises migration/reopen, staged transactions,
rollback/rollforward, receipt retries, manifest-last publication, external conflict
preservation, draft image corruption, comment persistence and structural operations.
It provides partial F02-F05/M01-M02 evidence. Killed-process coverage at every
required boundary, interrupted recovery and complete unsupported-input cases remain.

`editorial-sidebar.test.ts` verifies failed-save and refresh preservation, canceled
and confirmed discard, and successful-save dirty acknowledgements. Existing
`document-state.test.ts` covers captured manuscript acknowledgements. Neither
establishes F06 for a unified editorial/manuscript bundle.

Partial implementation is committed at the owner's request using `Related to
#170`. No `Closes #170` claim or completion PR is appropriate until all remaining
requirements and applicable repository/Electron checks pass.

The editor now captures bounded transaction steps by revision and retains newer
evidence across earlier save acknowledgements. Core companion undo helpers capture
touched records, preserve disjoint discussion edits and reject stale replay. These
pieces are not yet connected to core step replay, ProseMirror history or atomic
text/editorial autosave, so the corresponding FAIL assessments remain.
