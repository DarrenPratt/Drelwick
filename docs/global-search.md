# Global local project search

Issue #167 is CORE, offline Community functionality. Use **Search project** above
the manuscript to search chapter titles and semantic text, characters and aliases,
locations, canon, timeline events and research notes. Select a record type, enable
Match case or Whole word, and enter a literal query. Tags and every approved
label/prose/source field participate; identities, links, revision metadata,
tombstones, recovery drafts and history do not.

Results identify type, title, field/passage and matching context. Chapter results
open the chapter through ordinary save-safe navigation and select the matching
text when its loaded document still agrees with the captured source. Reference
results open a read-only saved-record detail within search. Editing remains in the
existing Story Bible panels. Text and citations are rendered inertly, never as HTML
or executable links. Enter/Down from the query focuses the first result; Up/Down,
Home/End and Tab move between result buttons, Enter opens one, and Escape closes
search and restores focus to its opener. Loading, empty, failed, cancelled and
partial states are announced through status/alert regions.

## Matching and existing Find

The normative [Story Bible search contract](story-bible.md#search-and-export-isolation)
and [manuscript search policy](manuscript-search.md#matching-policy) remain unchanged.
Matching is literal and non-overlapping, with ECMAScript Unicode simple case
folding by default. Match case is exact. There is **no Unicode normalization**:
NFC `é` and NFD `e` plus combining acute remain distinct. There is no accent
stripping, locale collation, regex, fuzzy search or multi-character folding:
`ß` does not match `ss`. Grapheme boundaries protect combining text and joined
emoji. Whole word uses the existing Unicode letter/mark/number/connector rule.
Empty queries return no hits; whitespace is literal and is not trimmed.

Each reference field and array item is independent. Chapter extraction reuses
#118's semantic runs and ProseMirror UTF-16 positions, including text across inline
marks but never across structural boundaries. The shared literal matcher powers
both workflows. Global search does not add replacement behaviour or change
Ctrl/Cmd+F, live manuscript Find, Replace One, Replace All, history or undo.

Results sort by type identifier, title/name in Unicode code-point order and stable
ID; fields/passage order and match offset break remaining ties. Reference fields
sort by field name and retain array order. Chapter titles precede passages.

## Saved sources, refresh and navigation

Search flushes mounted manuscript and Story Bible editors through their existing
save mechanisms before reading sources. A failed/invalid save pauses search or
navigation and retains drafts. Explicit discard/cancel stays in the existing
editor workflow; search never silently discards or restores a record. Character
panels remain mounted when hidden, and save acknowledgements retain any newer
character edits made while saving. Search does not index recovery drafts or treat
an unsaved editor copy as authoritative.

Editor change notifications immediately invalidate visible results. Completed
saves, mutations, chapter renames/deletions/reordering and replacement refresh the
source generation. A 300 ms debounce flushes and rebuilds the snapshot; queries
have a separate 120 ms debounce. Query/filter changes hide old results immediately.
Cancellation aborts matching, releases the visible index and prevents late work
from publishing. A privileged snapshot read already in progress finishes its
bounded read/verification; its cancelled response is ignored. Queued reads remain
serialized with reference operations.

Every hit carries kind, stable ID, exact source SHA-256, field and range. Opening it
re-reads and validates the current authoritative target through restricted IPC,
checks manifest membership or active reference status and rejects changed/deleted
targets before using a range. Chapter editor selection is additionally checked
against the loaded semantic runs. External filesystem edits are not watched:
**Refresh search**, close/reopen search, or reopen the project to discover them.
Fingerprint validation still rejects stale external hits. Simultaneous external
writers after validation cannot be locked out; this has the same limitation as
the existing reference store.

## Boundaries and resource limits

`packages/core/src/global-search.ts` owns extraction, indexing, matching,
deterministic ordering, cancellation and range resolution. The existing core
reference operation service captures authoritative sources under its operation
lock and verifies the inventory, manifest and chapter fingerprints before returning.
The existing main/preload reference IPC adds only strict `search-snapshot` and
`search-resolve` requests. Sender/frame and active project authorization remain
mandatory. Requests accept IDs, never renderer paths; filesystem reads retain
containment, regular-file and symlink/junction checks. Queries stay in the renderer
and are never sent over IPC or logged. No source text, contexts or private reference
content are logged by the search implementation.

Shared DTOs are transient contracts in `packages/shared`; no persistent schema,
project-format change, migration, database or new file is introduced. Closing
search releases its snapshot; every reopen rebuilds from project files. Existing
atomic writes, recovery/history and Community dependency direction are unchanged.

| Resource                           | Ceiling / behaviour                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Indexed records                    | 10,000 chapters and active references combined                                                 |
| Indexed fields / semantic passages | 100,000                                                                                        |
| Retained searchable text           | 16,000,000 UTF-16 units (up to 32 MB of text storage, excluding object/runtime overhead)       |
| Single field or semantic run       | 262,144 UTF-16 units                                                                           |
| Individual chapter source          | 8 MiB UTF-8                                                                                    |
| Chapter source inventory           | 256 MiB, at most 10,000 manifest entries                                                       |
| Reference source inventory         | Existing 10,000-file / 256 MiB scan and 8 MiB record limits                                    |
| Query                              | 500 UTF-16 units                                                                               |
| Displayed matches                  | First 500 in deterministic order; narrow the query/filter to see others                        |
| Matching batches                   | Yield after about 65,536 text/work units, between fields; one bounded field may exceed a batch |

Oversize records are skipped as a whole; fields are never silently truncated into
false matches. Source scan limits, invalid/unavailable records, or index limits
produce a visible incomplete warning. Result limits produce a separate visible
message. Index text ceilings are not a bound on total Electron process memory:
the bounded validated source scan, parsing, object overhead and temporary verified
inventory also consume memory. These are reliability ceilings, not paid tiers.

## Dependency and validation evidence

Before implementation, #118, #164 and #165 were closed and their merged PRs #182,
#222 and #223 were verified in the main history. Their manuscript matcher and
replace pipeline, canon/research editors, timeline editor, schemas and restricted
reference service are reused. The #160 normative design and local publishing plan
document basic search as CORE; continuity, series and professional editorial
allocation remain separate post-#203 decisions.

- `packages/core/test/global-search.test.ts`: every approved field/type, filters,
  independent synthetic comparisons, Unicode/case/whole-word parity with #118,
  semantic positions, ordering, cancellation, all index limits and a synthetic
  300,000-word novel (120 chapters, 12,120 indexed fields).
- `packages/core/test/global-search-files.test.ts`: authoritative file rebuild,
  rename/delete/stale navigation, tombstone/history exclusion, corrupt source
  diagnostics and manifest membership.
- `apps/desktop/test/global-search.test.ts`: rapid queries, late reads, cancellation,
  refresh, save failure, keyboard focus/navigation, inert rendering and status states.
- `apps/desktop/test/character-manager.test.ts`: invalid drafts and edits made during
  the save captured for search remain dirty and visible.
- `apps/desktop/test/reference-ipc.test.ts`: project/frame authorization, traversal,
  unexpected path/query payload rejection, source resolution and content-free logs.
- `tests/e2e/global-search.spec.ts`: native offline search of all kinds, unsaved
  manuscript/character flush, hidden character draft preservation, reference and
  chapter navigation, keyboard focus, external stale hits and process restart.

Validation on Windows with Node 24.18.0 and pinned pnpm 10.34.5:

| Check                                  | Result                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`       | PASS                                                                                                                |
| `pnpm lint`                            | PASS                                                                                                                |
| `pnpm format:check`                    | PASS                                                                                                                |
| `pnpm typecheck`                       | PASS, including tests                                                                                               |
| `pnpm test`                            | PASS — 104 files, 1,213 tests                                                                                       |
| `pnpm build`                           | PASS                                                                                                                |
| `pnpm check:workspace`                 | PASS, including Community boundary enforcement                                                                      |
| Native Playwright regression selection | PASS — seven scenarios: global search, manuscript find/replace, canon, notes, locations, timeline and chapter links |
| `git diff --check`                     | PASS                                                                                                                |

The native selection used `pnpm exec playwright test --grep 'global search|finds live prose|canon form|note form|location form|timeline keyboard|chapter links'`
after the production build. The synthetic 300,000-word core benchmark measured
12 ms to build the index and 1,268 ms to search 12,120 fields with scheduled yields
on this Windows run. It measures extraction/matching, not filesystem reads, IPC or
end-to-end UI latency; timings vary with hardware and timer scheduling. The test
also independently checks the expected 120 matches and absence of truncation.

| Issue acceptance criterion                              | Result / evidence                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| All searchable kinds, filters and navigable results     | PASS — core fixtures and native all-kind/detail/chapter navigation                   |
| Reuse #118 without duplicating replacement              | PASS — shared matcher/runs and existing native find/replace regression               |
| Refresh edits/deletions and rebuild after reopen        | PASS — file-service, UI invalidation and native saved/dirty/restart tests            |
| Bounded disposable in-memory index                      | PASS — all index ceilings tested; rebuild creates no persisted index                 |
| Unicode/case semantics, cancellation and responsiveness | PASS — matching parity, cancelled/late queries, native keyboard UI and large fixture |

Changed implementation files are `packages/core/src/{global-search,manuscript-search,references}.ts`,
the core package export, `packages/shared/src/{global-search-contracts,reference-contracts,index}.ts`,
desktop `GlobalSearch.tsx`, `App.tsx`, the four Story Bible manager components,
`components/WorkspaceLayout.tsx` and `app.css`. Test files are listed above;
README, the documentation index, technical specification and local publishing plan
link this guide. The [native screenshot](screenshots/global-search.png) uses only
synthetic fixture data.

Remaining validation limits: the full unrelated native suite, coverage collection,
native macOS/Linux and assistive screen-reader testing were not run for this issue.
Vite retains its existing large-chunk warning; the frozen install reports ignored
dependency build scripts. Neither prevented the checks above passing. External
edits require explicit refresh, and cancellation does not interrupt a privileged
snapshot read already in progress, as described above.

Automatic reference replacement, continuity analysis, cloud, AI, persistent indexes
and Pro features remain outside this change.
