# Read-only manuscript revision comparison

Product: CORE (`product:core`), issue #172. Open **Manuscript snapshots → Compare
manuscript revisions**. Choose before/after snapshots, or a saved-current view,
and explicitly choose accepted/proposed text on each side. Snapshot names are not
identities: controls also show capture time, generation and UUID. Current capture
first flushes pending manuscript/discussion/reference edits through the existing
workflow. A failed flush retains drafts and cancels comparison.

The panel shows chapter additions, removals and relative reordering, title/status,
book/publishing metadata, grapheme text edits, marks, structural nodes, attributes,
and image identities/byte hashes. Chapter and change selectors support keyboard
navigation; Previous/Next change moves focus to the labelled before/after article.
Formatting appears in the reading view, with explicit labels for breaks, images
and link targets. Links are inert and no image/network resource is fetched.
Expandable semantic details retain exact slices/positions. Large changes display
an excerpt, while the bounded complete change remains available in memory.

Comparison has no apply, review, accept/reject or restore command. It neither
migrates inputs nor creates a named snapshot. Restore remains in the snapshot and
Chapter History workflows; pending-revision review belongs to #173.

## Sources and compatibility

`captureComparisonSource` reuses #171's read-only scope, immutable manifest/hash,
asset closure and #170 bundle validators under the existing project lock. It
rechecks source bytes and optional-file absence before returning. Only transient
project/chapter metadata, selected semantic documents and image hashes are retained;
private discussions and image bytes never enter the comparison result.

The current adapter supports project v3, chapter v2, editorial v1 and snapshot v1,
with the currently supported empty pending-revision envelopes. Accepted/proposed
projections are explicit even when equal. Existing validators reject nonempty or
unsupported review envelopes; #173 must add validated projection/replay coverage
when it implements pending changes. Comparison does not enable revision mode early
and #173 is not a prerequisite. Older/newer unsupported sources are reported
unavailable without migration or false equality.

Main owns at most two opaque captured-source handles, scoped to the active project,
session epoch and authorized main frame. Captures are revalidated before comparison;
saved-current generation/inventory changes require recapture. Project open/close
clears handles and cancels work. Each result identifies both immutable source
tokens (kind, ID, project ID, generation, inventory hash, snapshot manifest hash,
label, time and projection). A saved-current comparison checks currency after
completion, on focus and every five seconds. Later edits mark it stale while its
captured inputs stay unchanged. Cancel/close and request-generation guards prevent
obsolete responses replacing newer output.

## Determinism, limits and diagnostics

`ComparisonV1` uses `semantic-grapheme-v1`: align chapter UUIDs; additions in new
order, removals in old order, survivors in new order. Moves compare surviving
relative order, so adding a chapter alone does not label all following chapters
moved. Metadata changes precede chapter changes. Open/close/atom tokens retain
ProseMirror paths/positions; Unicode graphemes span adjacent marked runs without
normalization or whitespace folding. Myers shortest edit scripts choose deletion
on tied frontiers. Aligned token marks/attributes compare separately from text.
Consecutive changed tokens form readable hunks; ordinals are consecutive from zero.

The contract ceilings are 10,000 chapters, 256 MiB semantic data per source,
1,000,000 tokens and 10,000,000 frontier/snake expansions per chapter. A conservative
100,000-change result ceiling also bounds output. Limits can be lowered, never
raised, by internal callers. Tokenization, diff, backtracking and hunk enumeration
cooperatively check cancellation and yield on a four-millisecond work target
(checked every 128 work units). Saved-source validation uses the existing bounded
filesystem/schema readers; OS scheduling and garbage collection are not real-time
guarantees.

Chapter limit failures retain completed chapters, mark the result incomplete and
report located `LIMIT` diagnostics. Missing images produce `MISSING_ASSET` with
their ID; malformed inputs produce `INVALID_SOURCE`; incompatible sources produce
`UNSUPPORTED_VERSION` during capture. Failed source capture has no comparison
result and cannot claim equality. Errors use fixed messages and never expose raw
exceptions, filesystem paths or manuscript/private discussion payloads.

## Validation

`packages/core/test/manuscript-comparison.test.ts` covers C01–C02: deterministic
tie/slice goldens, identical sources, supported marks and link/heading/list
attributes, joined emoji and combining characters across mark boundaries,
scene/hard breaks, images and asset hashes, UUID-aligned structure, source byte
inventories, immutable current capture, incompatible/corrupt sources, cancellation
and lowered resource ceilings. The representative synthetic 300,000-word novel
(60 chapters, 50 paragraphs of 100 words each) compared in about 4–6 seconds on the
local Windows development machine, with one inserted semantic paragraph. This is
measured evidence, not a cross-platform latency guarantee.

Desktop tests cover authorized frame/session/project tokens, strict path-free IPC,
stale-source rejection, sanitized errors, cancel, failed flush, explicit labels,
read-only semantic rendering, change focus and discarded late responses. The native
Electron scenario in `tests/e2e/manuscript-comparison.spec.ts` exercises offline
saved-current flush, snapshot equality, keyboard navigation, private-content
exclusion and unchanged saved/immutable bytes. Native evidence is Windows only;
macOS/Linux and assistive-technology validation are not claimed.
