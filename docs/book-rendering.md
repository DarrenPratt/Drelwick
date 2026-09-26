# Shared semantic book rendering

Issue #121 provides the Community foundation for local preview, EPUB and print.
There is one semantic serializer in `packages/renderer`. The editor's TipTap DOM
and Chapter History's authoring preview are not publishing serializers.

```text
save/flush current editor
  -> core assembleBook (project operation lock)
  -> BookRevision + captured validated image bytes
  -> renderer renderBook (pure semantic XHTML fragments)
  -> target wrapper + theme/styles + asset/link mapping
```

## Dependencies verified

#112 (merged PR #158) defines and validates the semantic vocabulary, including
headings, nested lists, links and epigraphs. #113 (merged PR #159) adds immutable
project-managed PNG/JPEG assets and image editing. Project format v2 and journaled
v1 migration came from #111, not #113. Actual schemas, editor extensions, load/save
validation, image decoding and their tests are the dependency evidence. No missing
prerequisite required a schema change.

## Assembly and consistency

`packages/core/src/book-assembly.ts` owns filesystem access. `assembleBook` rejects
linked/network paths and acquires the existing `.chapter-create.lock` before any
project content reads. Chapter saves, ordering, organisation, replacement,
migration, image import and recovery use this same operation boundary. A held or
retained lock fails as busy; assembly never reclaims a recovery lock. `openProject`
checks migration/replacement readability, manifest/component versions and ordered
chapter identity. Assembly bypasses summary caches and validates every chapter
document against `ManuscriptDocumentSchema`. Recoverable chapter `.tmp` files
block assembly without deletion. No authoritative files are written; normal asset
validation can refresh the disposable summary cache.

The manifest's `manuscript.order` is the canonical body order. Issue #123 adds
ordered front/back matter around that body and an ebook-only cover, using the
same serializer. See [publication assembly and inclusion](publication-matter.md).
All documents and
validated original image bytes are captured while holding the lock. Captured
source files are compared again before release to detect external modifications.
The result owns its in-memory data; consumers must use these captured bytes, not
reopen image paths after release. `revision` is a SHA-256 identity of the assembled
semantic input and image content hashes, not a wall-clock timestamp. Identical
input yields the same identity, even if a file's timestamp changed.

The consistency guarantee covers cooperating Drelwick writers on the existing
local filesystem lock protocol. Rechecks detect ordinary external changes but
cannot provide a transaction against arbitrary tools that ignore locks and change
files during verification. Live network-folder synchronization is unsupported.
Assembly bounds individual captured files at 64 MiB; image validation retains
the existing 20 MiB/pixel limits. Assembly is an in-memory foundation, not a
streaming exporter for unbounded projects.

The desktop synchronously freezes editing, flushes the existing autosave
coordinator and checks dirty/in-flight state before requesting assembly. Failed
saves preserve edits and cancel preview. The dialog displays a captured saved
revision; #124 adds explicit Refresh and stale-state checks (see
[ebook preview](ebook-preview.md)). Core and the pure renderer know nothing about
editor dirty state. Future export callers must use this same flush boundary.

## Contracts and determinism

`BookRevision` contains project/revision identity, current title/language, ordered
chapter IDs/titles/types/documents and validated asset descriptors or unavailable
asset states. It contains no paths, Electron handles, HTML input or Pro imports.
`AssembledBook.assets` holds captured original bytes separately for target adapters.
Issue #121 added no persistent metadata fields or schema versions. Issue #122 adds
independently versioned presentation settings, captured separately by assembly;
they do not change the semantic revision or renderer input.

`renderBook` returns ordered `RenderedChapter` objects, semantic targets, referenced
asset IDs, located diagnostics and an `ok` flag. Each chapter is an XHTML-compatible
fragment with one section and a distinct title/body boundary. Wrappers supply the
XHTML namespace for EPUB, document language, metadata and styles. Chapter splitting
and package paths are target decisions.

Chapter anchors are `chapter-<lowercase UUID>`; heading anchors append
`-node-<zero-based content path joined by hyphens>`. Positions are semantic tree
indices, not editor offsets. Anchors remain stable for the same input and may
change when content is inserted before a heading. No clock, random IDs, locale,
filesystem enumeration, DOM globals or process state affects serialization.

## Semantic support matrix

| Node/mark        | Representation and hook                               | Details                                                                             |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `doc`            | Children in `.chapter-body`                           | Empty documents accepted                                                            |
| chapter envelope | `section.chapter`, `h1.chapter-title`                 | Stable ID and `data-chapter-type`; no file splitting                                |
| `text`           | Escaped XML text                                      | No raw HTML interpretation                                                          |
| `paragraph`      | `p`                                                   | Empty paragraphs retained                                                           |
| `heading`        | `h1`–`h6` with deterministic ID                       | Semantic level; all inline marks retained                                           |
| `hardBreak`      | `br /`                                                | Marks may wrap the break                                                            |
| `blockquote`     | `blockquote`                                          | Recursive block content                                                             |
| `epigraph`       | `figure.epigraph > blockquote`, optional `figcaption` | Attribution escaped exactly, including empty attribution                            |
| `bulletList`     | `ul`                                                  | Ordered child traversal                                                             |
| `orderedList`    | `ol start`                                            | Integer start preserved; standard HTML list `type` values preserved                 |
| `listItem`       | `li`                                                  | Leading paragraph and nested mixed lists retained                                   |
| `codeBlock`      | `pre > code`                                          | Escaped text; optional escaped `data-language`                                      |
| `sceneBreak`     | `hr.scene-break /`                                    | No ornamental glyph or appearance decision                                          |
| `horizontalRule` | `hr /`                                                | Distinct from scene-break hook                                                      |
| `image`          | `img.manuscript-image.image-<size> /`                 | Escaped alt, `data-asset-id`; small/medium/large/full hooks, no physical dimensions |
| `bold`           | `strong`                                              | Semantic emphasis                                                                   |
| `italic`         | `em`                                                  | Semantic emphasis                                                                   |
| `underline`      | `u`                                                   | Existing vocabulary preserved                                                       |
| `strike`         | `s`                                                   | Existing vocabulary preserved                                                       |
| `code`           | `code`                                                | Model prohibits combinations with other marks                                       |
| `link`           | `a`, or inert `span.manuscript-link` in preview       | Validated URL and optional escaped title; editor target/class/rel discarded         |

Marks have a fixed outer-to-inner order: link, bold, italic, underline, strike,
code. Every text run is independently balanced, so partial/overlapping emphasis
preserves reading order without duplicate text. Stored mark-array ordering does
not affect output. Unknown list presentation `type` values are ignored; they are
not prose or semantic list ordering. The schema remains the source of truth and
the exhaustive dispatch/golden inventory must be extended together with it.

## Links, assets and diagnostics

The renderer reuses `isSupportedManuscriptLink`: absolute HTTP, HTTPS, mailto and
nonempty publication fragments only. Whitespace/control characters, local files,
relative source links, protocol-relative URLs and executable/custom schemes fail.
Nothing fetches a link. Stored target, rel and class never become capabilities.

Fragments resolve against exposed chapter/heading targets across the whole book.
`resolveInternalLink(target, fromChapterId)` can map those identities to safe
package-relative references. Core semantics never contain EPUB paths. Unknown
fragments retain their label and marks as text with an
`unresolved-internal-link` warning; this is the sole recoverable diagnostic.
Exporters may elevate warnings in preflight and must never ignore errors.

`resolveAsset(descriptor, { chapterId, path })` is a trusted deterministic target
function. It returns a strict publication-relative path or a PNG/JPEG base64 data
reference; absolute paths, traversal, network URLs and other data MIME types fail.
It never receives a filesystem path. The desktop adapter only encodes captured
validated bytes. EPUB can emit package-relative paths and include those same
original bytes. The pure serializer checks reference safety, while core validates
file boundaries, checksums, container completeness and full raster decoding.

Missing records/references and invalid/unsupported images produce an error per
occurrence and a `.missing-image` placeholder with escaped accessible alternative
text and asset identity. No privileged path or broken file URL is emitted. Partial
preview is explicitly labelled incomplete; it cannot be reported as publishable.
Invalid chapter structures, unsupported nodes/marks, unsafe URLs and XML 1.0
unrepresentable characters block that chapter and set `ok: false`. The source is
unchanged. Multiple safely discoverable failures are reported; there is no silent
success after losing content.

Diagnostics contain only codes, severity, validated chapter/asset identity, known
node vocabulary and structural paths. Arbitrary unknown type strings, prose, alt
text, link labels, URLs, resolver exceptions and schema error payloads are not
copied into diagnostics or logs. Invalid disk documents fail assembly with fixed
domain errors before a supposedly validated revision is produced.

## Preview safety

The restricted `book:preview` request accepts only the active project UUID.
Main-process handlers validate it, authorize the current main frame, serialize
project operations, settle history and recheck sender/project identity. The result
is a passive `BookPreview` DTO, not a project API. The preview document uses inert
links and a restrictive CSP: no script, connect, frames, objects, base or
forms; only embedded raster image sources are permitted. Issue #122 authorizes
only the generated preset stylesheet by its SHA-256 hash, with style attributes
and font resources still blocked. There are no remote
fonts, images, CSS or scripts. Text and attributes escape XML metacharacters and
encode CR/LF/tab to prevent attribute normalization from altering alternatives.

`BookPreviewDialog` uses `iframe sandbox=""`, without scripts, same-origin access,
popups, top navigation or preload. Referrers are disabled. The application retains
context isolation, sandboxing, disabled Node integration and restricted IPC.
The native Electron test verifies unavailable Node/process/preload/IPC globals,
inaccessible parent document, inert clicks, decoded local images, no network
requests and blocked injected scripts/event handlers even when test code bypasses
the semantic renderer. Main-frame authorization separately rejects preview frames.

## Styling and extension seams

The semantic package owns element meaning, escaping, stable hooks and deterministic
serialization only. `renderBook` emits no CSS. The dialog shell controls its own
dimensions; the separate [theme generator](book-themes.md) supplies presentation.
The real Book preview panel opens this saved-revision view; Book design selects
a persisted Community preset.

- #122 supplies validated themes/styles targeting the documented hooks, outside
  the semantic traversal. Preview authorizes the generated CSS by hash while
  retaining isolation and no remote resources.
- #123 extends assembly/project structure with publication matter and metadata,
  then feeds ordered semantic documents into this pipeline. This change implements
  no matter workflows, cover selection or schema migration.
- #126 wraps the returned chapter fragments in XHTML documents and supplies
  asset/internal-link mappings before packaging. It must require `ok` and validate
  the final package. No EPUB ZIP, OPF, navigation or packaging exists here.
- #129 adds print styles, pagination and an isolated Chromium adapter to the same
  semantic fragments. No PDF generation or pagination exists here.

Future built-in semantic additions extend the project model, explicit dispatch,
support matrix and golden/text tests in one change. Typed resolver callbacks and
chapter results are internal composition seams, not dynamically loaded plugins.
There is no renderer registry, arbitrary module loading, Pro dependency or licence
gate. Community remains independently buildable.

## Test evidence

`packages/renderer/test/fixture.ts` covers all 14 node types and all six marks,
all heading levels and image sizes, nested mixed lists/quotes, attributed epigraphs,
overlapping marks, hostile text and Unicode. `golden/book.xhtml` asserts exact
serializer bytes and is intentionally excluded from formatting. Strict XML parsing
rejects malformed output. The exact-text helper recursively derives source text,
adds one LF per hard break, image alt at each image and attribution after epigraph
paragraphs. It compares that result to independent DOM traversal of `.chapter-body`
with no whitespace folding. Chapter titles are compared separately. This detects
omissions, duplicates and reordered segments rather than mere substring presence.

`packages/core/test/book-assembly.test.ts` verifies canonical order, deterministic
revision/output, lock exclusion against real saves/assembly, recovery refusal,
external modification detection, unchanged source files and captured asset bytes.
Existing migration/replacement/image suites supply crash/journal/path/decoder
regressions. Desktop workflow tests cover successful flush and failed-save
cancellation; IPC/preload tests cover authorization and the narrow contract.
`tests/e2e/desktop.spec.ts` exercises the real Electron iframe security boundary.

See [the acceptance evidence](book-rendering-acceptance.md) for the issue audit.
