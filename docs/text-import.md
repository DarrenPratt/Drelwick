# Community TXT, Markdown and HTML import

Issue #117 adds local adapters to the existing [staged import pipeline](manuscript-import.md)
and [review workflow](import-review-ui.md). Select **Import manuscript** once;
main dispatches the native selection to DOCX, TXT, Markdown or HTML. These are
CORE features, without accounts, Pro packages, hosted conversion or network access.

## Support matrix

| Feature                 | TXT                                                                                                   | Markdown                                                                                                                                               | HTML                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Extensions              | `.txt`                                                                                                | `.md`, `.markdown`                                                                                                                                     | `.html`, `.htm`                                                                                           |
| Encoding                | Fatal UTF-8, optional UTF-8 BOM                                                                       | Same                                                                                                                                                   | Same; HTML charset declarations do not change decoding                                                    |
| Paragraphs              | Blank-line separated; consecutive nonblank lines remain in one paragraph with LF characters           | CommonMark/GFM paragraphs, soft breaks collapse to spaces, hard breaks preserved                                                                       | DOM reading order; HTML ASCII whitespace collapses, including across inline elements                      |
| Blank lines             | First separates blocks; additional blanks become empty paragraphs; a terminal newline adds no content | Markdown paragraph semantics                                                                                                                           | Empty explicit paragraphs retained; layout whitespace ignored                                             |
| Headings                | No guessing from short, uppercase or numbered lines                                                   | ATX/setext levels 1–6                                                                                                                                  | `h1`–`h6`                                                                                                 |
| Chapters                | One chapter, with ambiguity warning                                                                   | Top-level level-one headings propose boundaries, as DOCX does                                                                                          | Same                                                                                                      |
| Emphasis                | Literal text                                                                                          | Bold, italic, strike and code                                                                                                                          | `strong`/`b`, `em`/`i`, `s`/`del`, `u`, `code`                                                            |
| Lists                   | Literal text                                                                                          | Ordered/unordered, nested mixed lists, ordered start                                                                                                   | `ol`, `ul`, `li`, nested lists and ordered start                                                          |
| Quotes                  | Literal text                                                                                          | Blockquotes                                                                                                                                            | `blockquote`                                                                                              |
| Scene breaks            | Only an isolated `* * *` line, with warning; other separators remain literal                          | Thematic breaks, subject to normal Markdown precedence (e.g. setext headings)                                                                          | `hr`                                                                                                      |
| Links                   | Literal text                                                                                          | HTTP(S), mailto and fragments as semantic data                                                                                                         | Same; unsafe/relative targets become unlinked text with warning                                           |
| Images                  | Literal text                                                                                          | Explicitly selected PNG/JPEG only                                                                                                                      | Same; images become blocks with a warning about inline layout                                             |
| Code                    | Literal text                                                                                          | Fenced/indented blocks and inline code                                                                                                                 | `pre` and inline `code`; incompatible formatting warns                                                    |
| Tables                  | Literal text                                                                                          | Cell content recovered through HTML conversion, with warnings                                                                                          | Cells recovered in DOM order; table/layout semantics warn                                                 |
| Tasks/forms             | Literal text                                                                                          | Checkbox state recovered as `[x]` / `[ ]`, with warning                                                                                                | Controls become readable values/state; other form text retained, behaviour removed                        |
| Unsupported extensions  | Literal text                                                                                          | Recognized footnote definitions, definition lists, `$$` math and `:::` directives recover the **entire source** as one literal code block with warning | Unsupported wrappers recover readable content with warnings                                               |
| Raw HTML                | Literal text                                                                                          | The same HTML semantic sanitizer, plus raw-HTML warning                                                                                                | No arbitrary markup retained                                                                              |
| Active/embedded content | Literal text                                                                                          | Same policy as HTML                                                                                                                                    | Script/style/frame/object/embed/SVG/MathML/resource and navigation elements removed with located warnings |
| Metadata                | Warned title/author/language placeholders                                                             | Same                                                                                                                                                   | `title` becomes book title; other missing fields use warned placeholders                                  |

All warnings require individual approval in the existing review dialog. There is
no implied approval of omitted script/embedded content. Cancel if the reported
conversion is unacceptable. Unsupported extension recovery intentionally favours
recoverable literal content over guessing semantics. It can also conservatively
recover notation inside a code example. Unknown extension notation otherwise
follows CommonMark/GFM text rules; the Markdown scope warning makes this explicit.

All line endings (LF, CRLF, CR) normalize to LF before parsing. Decoding preserves
Unicode scalars, emoji and combining sequences without Unicode normalization.
Malformed UTF-8, UTF-16/legacy byte encodings and binary control characters block
inspection instead of silently inserting replacement characters. HTML numeric
entity repairs follow the HTML parser and produce repair warnings. Save a separate
UTF-8 copy when necessary; import never rewrites the source.

Level-one headings remain in their proposed chapters. Weaker headings do not
split chapters. A missing top-level level-one heading, or a single level-one
heading with weaker headings, produces an ambiguity warning. Every proposal
requires review. Authors can merge/split at existing top-level blocks using #116.
Long proposal titles are shortened at a Unicode boundary with a warning; complete
heading content remains. No authoritative schema changes are made.

## Image authorization and security

Selecting a manuscript authorizes **only that source file**. During inspection,
each distinct eligible relative image reference offers **Select image**, **Skip
image**, or **Cancel import**. Select image opens the existing style of native
PNG/JPEG picker. Only the exact selected file is read; its path is never inferred
from the reference. The chosen file may be a replacement for a missing original.
The selection authorizes reuse for occurrences of that same reference in this
single operation, not another source or later import.

Absolute/UNC paths, traversal, backslashes, URL schemes, encoded/ambiguous paths,
queries and fragments never trigger automatic reads or selection prompts. Only
simple relative names (including safe relative subdirectories) are eligible for
manual replacement. Skipped, remote and unsafe images retain an alternative-text
placeholder and located warning. Sources with no alternative text retain a generic
image placeholder. Remote images, stylesheets, fonts, scripts and embeds are
never fetched. Normal safe hyperlinks remain data and are never followed.

Selected images use the existing bounded reader, ancestor checks and strict image
decoder: symlinks/junctions, hard links, traversal, network paths, extension/signature
mismatch, malformed images and excessive dimensions are rejected. Only static
PNG/JPEG originals pass. UUID asset references and original bytes enter the same
intermediate validation, staging and commit as DOCX; source filenames never become
project paths. Approved images are validated again by the generic coordinator.

HTML is parsed with parse5 in the existing isolated VM/worker, not a browser DOM.
The semantic converter constructs a fixed vocabulary; it never serializes source
elements/attributes back into HTML. Event handlers, CSS, active URLs and arbitrary
attributes cannot enter the manuscript. Unknown wrappers preserve readable child
content with warnings. Script/style and active embedded subtrees are omitted with
warnings requiring review. Markdown output is untrusted and passes through this
same converter, including its raw HTML. No parser callbacks evaluate document code.

The VM has no filesystem, process, shell, browser, fetch, XHR or WebSocket APIs;
dynamic code generation and imports remain disabled. Native selection happens
outside the VM. The first isolated pass returns a validated placeholder manuscript
and bounded reference list. After individual selection and image validation, a
second isolated pass substitutes approved image bytes/UUIDs. The adapter returns
the same serialized `ImporterResult` as DOCX. It never writes project files.

## Bounds, warnings and recovery

The generic limits/timeouts remain in force. These adapters additionally limit:

| Resource                           | Limit                                              |
| ---------------------------------- | -------------------------------------------------- |
| UTF-8 source                       | 8 MiB                                              |
| Markdown-generated HTML            | 32 million UTF-16 code units                       |
| HTML tree nodes / traversal depth  | 100,000 / 32                                       |
| Markdown token values / nesting    | 100,000 / 32                                       |
| TXT paragraph blocks               | 100,000, further bounded by shared JSON validation |
| Warnings / proposed chapters       | 1,000 / 1,000                                      |
| Distinct eligible image references | 256                                                |
| Approved image originals           | 48 MiB aggregate; existing per-image limits        |

Exceeding limits blocks import; it never truncates content or hides further warnings.
Worker termination handles cancellation during parsing. Native selection and image
reads check cancellation before continuing. Staging, publication, cleanup, dirty
state and validated opening remain the existing generic lifecycle. Sources and
active projects are never written by inspection, cancellation or failed commits.

Warnings include format, bounded fixed descriptions and approximate locations.
HTML locations use source lines when available. Markdown HTML-conversion locations
refer explicitly to converted lines; other warnings use parser traversal/block
positions. These are source/proposal locations, not post-adjustment chapter numbers.
No manuscript text, raw parser exceptions, paths or image data are logged.

## Dependencies

- [Marked 18.0.14](https://marked.js.org/), MIT: maintained standalone CommonMark/GFM
  parser, zero runtime dependencies, no browser required. No plugins, hooks,
  highlighting or custom executable extensions are installed. Marked explicitly
  does **not** sanitize HTML; Drelwick always applies its semantic converter.
- [parse5 8.0.1](https://github.com/inikulin/parse5), MIT: WHATWG HTML parser already
  present transitively through jsdom; now pinned as a direct core dependency. It
  handles malformed markup and entities without browser resource loading.
- parse5's locked `entities` 8.1.0 dependency, BSD-2-Clause, decodes HTML entities.
- Existing esbuild 0.28.2, MIT, bundles the parser and licence notices into
  `dist/text-parser.bundle.js`. Runtime module loading remains unavailable.

Installed licences are included in the bundle. These dependencies do not choose
Drelwick's licence or alter its independent Community build.

## Executable evidence

- `tests/fixtures/import/novel.{txt,md,html}`: synthetic deterministic manuscripts.
- `packages/core/test/text-import.test.ts`: exact golden structures/reading order,
  Unicode/BOM/endings, unsupported recovery, raw active HTML, resource blocking,
  absence of VM network APIs, nesting/size/warning limits, selected/declined images,
  linked-path rejection, staging/write failures, cancellation and source preservation.
- `apps/desktop/test/manuscript-import-ipc.test.ts`: all extensions dispatched through
  the production registry, individual warning approvals, shared commit/validation/open,
  path-free previews and native image selection/skip/cancel.
- `tests/e2e/desktop.spec.ts`: real Electron offline TXT/Markdown/HTML inspection,
  review, import, edit, save, restart and reopen, comparing original source bytes.
- Existing #114/#116 suites retain invalid-intermediate, destination race, cleanup,
  active-project/dirty-state, warning decisions and project-open failure coverage.
