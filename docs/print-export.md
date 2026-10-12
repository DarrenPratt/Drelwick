# Community local print PDF export

Issue #130 (`product:core`). PR #215 is merged. The 12 October 2026 local review
verifies the PDF acceptance criteria and adds the fixes and evidence below.
All required checks now pass, including all 20 desktop E2E scenarios. The changes
are ready for PR review; review and merge remain separate.

## Workflow and supported output

Open **Export → Print PDF / preflight**. Pending editor changes must save before
the existing print preview pipeline captures a revision. Review the actual PDF
pages and basic preflight findings. Errors disable **Export PDF**; warnings
require acknowledgement for that revision. Findings identify chapter titles,
settings or a **Review page** action. Chapter-only measurements link to the first
nonblank page of that chapter. **Review print settings** opens the settings dialog.
Correct the source/settings and explicitly refresh to produce a new proof.

Export selects a destination through Electron's native save dialog. Existing
files require a separate **Replace** confirmation, defaulting to keeping the
file. Export progress identifies revision checking, destination selection,
temporary-file validation and publication. **Cancel PDF export** requests
cancellation before publication; a native dialog can also be cancelled.
Cancellation during filesystem or PDF work is cooperative, checked between
operations. Once atomic publication has completed, cancellation cannot undo it.

The main process retains one successful preview for the active project and
trusted frame. The renderer sends only project/revision identifiers and warning
acknowledgement, never bytes or destination paths. Export uses exactly the
retained bytes, without re-pagination. Read-only source captures before selection
and before publication reject changed content, assets, metadata, themes or print
settings. A failed refresh retains the previous preview but does not authorize
export of a stale revision. Reopen/refresh after a renderer restart.

The existing [print pipeline](print-preview.md) supplies mirrored margins,
recto starts, running matter, Roman/decimal folios, manual hyphenation and bundled
Noto fonts. Title, author and language are embedded before preview, so metadata
does not change during export. Page boxes, page count, title/author/language and
embedded font programs are inspected on the final PDF and again on staged bytes.
Staged bytes must equal preview bytes exactly.

## Preflight scope

Blocking errors include invalid trim/margins, missing/invalid images, unsupported
font characters or font loading failures, measured overflow/clipping, inconsistent
page count/boxes, missing embedded fonts, metadata mismatch and unreadable PDFs.
Resource/render failures stop generation rather than returning a partial book.
Missing resources may prevent any PDF from being produced; the error names the
affected chapter when known, or directs the author to settings/resources otherwise.
Missing or corrupt bundled fonts request local installation repair. Chromium font
and image decode failures retain those actionable classifications; parser/I/O
payloads are not forwarded or logged.

Unexpected blank pages are warnings because authored empty material can be
intentional. Recto separator pages are marked intentional and are not warnings.
The existing DOM and section-PDF measurements detect horizontal overflow,
oversized unbreakable blocks, clipped scroll boxes and text bounds outside the
content area. They do not prove exhaustive text/image collision detection or
preservation of every glyph's ink. The final font check verifies embedded font
program presence, not licensing compliance or comprehensive font validity.

There is no publisher-specific margin/page-count policy, bleed, colour-space,
image-DPI, PDF/X, accessibility certification or universal printer-upload promise.
Review a physical proof. Large-print presets (#136), richer semantics (#137) and
packaged cross-platform release evidence (#131) remain separate work.

## Persistence, security and platform constraints

All work stays local and requires no account, service or Pro package. The render
surface retains the existing sandbox/CSP/network denial. No manuscript body or
underlying parser/I/O error payload is logged. No project schema changes occur.

PDF and EPUB share the established destination validation and binary publication
primitive. Destinations must be absolute, ordinary files with the correct suffix,
outside all detected project folders; linked paths and unsafe Windows names are
rejected. A unique exclusive temporary file is created in the destination folder,
written, synced, read back, compared and validated. The destination identity is
rechecked before publication. Approved existing files are atomically renamed over;
new files use the repository's atomic hard-link publication convention to avoid
clobbering a file concurrently created at that path. There is no delete-first or
copy fallback. This is a deliberate distinction from using rename for new files:
portable Node rename cannot promise no replacement of a concurrently created file.

Temporary files are removed on success, cancellation or failure. Cleanup failures
are reported explicitly. A crash can leave a uniquely named `.drelwick-pdf-*.tmp`
in the destination directory. Local filesystems must support same-directory
atomic replacement and hard links; unsupported/removable/network filesystems can
fail safely rather than receive a non-atomic fallback. Windows open-file locks can
prevent replacement. This is not a power-loss durability or concurrent external
writer guarantee. Platform-specific PDF identity and macOS/Linux packaged print
support remain unverified here. Existing render limits remain 2,000 pages,
1,000 sections, 64 MiB and bounded render/resource deadlines.

## Acceptance coverage and validation status

| Criterion                                                         | Evidence                                                                                                                                                                                                              | Result |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Exact preview revision, dimensions, metadata and fonts            | Retained main-process bytes; stale checks before selection and publication; staged byte equality; PDF page-box, metadata/language, font and page-count corruption tests                                               | Pass   |
| Page count, missing resources, invalid margins, clipping/overflow | Core preflight classification; native missing/corrupt image and font fixtures; oversized heading/word measurements; geometry and resource bounds                                                                      | Pass   |
| Actionable findings and severity                                  | Chapter names in resource errors; page links for chapter-only findings; settings action; errors block export and warnings require revision acknowledgement                                                            | Pass   |
| Atomic destination, overwrite, cancellation and cleanup           | Real destination publication; explicit replacement/rejection; picker and cooperative cancellation; stale destination/source tests; partial ENOSPC write, sync, rename and link fault injection; cleanup warning test  | Pass   |
| Offline Community                                                 | Offline native Export workflow; zero renderer HTTP requests and zero hits at the isolated render surface's HTTP probe; independent Community dependency validation                                                    | Pass   |
| IPC, paths, source and logs                                       | Strict identifier-only requests; trusted-frame/project ownership; unauthorized path/cancel rejection; linked/project/unsafe path rejection; source byte comparisons; sanitized IPC failure and log-content assertions | Pass   |

The review reuses the existing pipeline and atomic writer. It fixes missing-font
and image-decode failures losing their actionable classifications, replaces
chapter UUIDs with chapter titles in author-facing resource errors, adds preflight
navigation, and strengthens the existing tests. No dependencies, project formats,
security controls or publishing limits change.

`tests/e2e/print.spec.ts` independently reads the exported bytes with PDF.js,
checks every used font has loaded embedded data without system-font fallback,
and compares the typography fixture's complete text/positions with its Windows
golden and a repeated production render. A separate 175-page novel fixture
verifies all 1,000 paragraph markers in order and every page's 432 × 648 point
view. Both published PDFs must equal the retained preview bytes.

A separate review-only pypdf 6.20.0 installation independently parsed the saved
16-page typography PDF and 175-page novel PDF. Every MediaBox, CropBox and TrimBox
was `[0, 0, 432, 648]`; both had title `A Printed Book`, language `en-GB` and the
fixture's empty author. Noto Serif regular/bold and running-matter fonts contained
nonempty embedded font programs. Independent extracted text preserved all 1,000
novel paragraph markers in order. The review tool is outside the application's
dependency graph; PDF.js checks remain in the executable repository E2E test.

The desktop scenario independently checks its three-page exported PDF's title,
author, dimensions and all three chapters. It also checks offline operation,
unchanged project/book/manuscript bytes, no temporary files, overwrite rejection,
stale-source rejection, failed-refresh retention and absence of manuscript text
in application logs. Unit/filesystem tests additionally cover cancellation at
written/commit boundaries, warning acknowledgement and disk failure preservation.

## Review checks (12 October 2026)

Windows, Node 24.20.0, pnpm 10.34.5 and Electron 39.1.2. The earlier PR's dependency
access problems did not recur. Fresh local results:

- `pnpm install --frozen-lockfile`: pass.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`: pass.
- `pnpm test`: 1,006 tests pass across 93 files.
- `pnpm test:coverage`: the same 1,006 tests pass; 72.02% statements,
  64.15% branches, 71.51% functions and 74.08% lines repository-wide.
- `pnpm check:workspace`: pass, including 20 boundary tests, six Community
  workspaces and the separate smoke consumer; no Pro dependency.
- `pnpm test:e2e`: all 20 pass (1.3 minutes), including both PDF scenarios.
  The follow-up E2E fix explicitly focuses the ebook Contents link before its
  mouse click and also checks keyboard navigation. Find and Replace now waits
  for the visible saved state and completed chapter navigation before capturing
  replacement review. Both affected tests pass three consecutive focused runs.
  Original navigation, source-preservation and replacement assertions remain;
  no forced clicks, sleeps, retries or security relaxations were introduced.

Build emits the existing Vite chunk-size advisory; installation reports the
existing ignored dependency build scripts. These do not fail the checks.
Windows source-built evidence does not establish macOS/Linux packaged operation;
#131 retains that release scope. Basic preflight is not PDF/X or exhaustive
collision certification. Cancellation and time limits remain cooperative.

No known #130 acceptance or validation blockers remain. The follow-up PR can use
**Closes #130**; review and merge remain separate.
