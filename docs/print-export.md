# Community local print PDF export

Related to #130 (`product:core`). This working-tree implementation is not yet
validated: the final quality checks and independent generated-PDF inspection
are blocked by dependency access errors in the current execution environment.
Do not treat the test cases below as passing evidence.

## Workflow and supported output

Open **Export → Print PDF / preflight**. Pending editor changes must save before
the existing print preview pipeline captures a revision. Review the actual PDF
pages and basic preflight findings. Errors disable **Export PDF**; warnings
require acknowledgement for that revision. Findings identify chapter titles,
settings or a **Review page** action where the measurement has that location.
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
Missing resources may prevent any PDF from being produced; the error directs the
author to the affected chapter when known, or to settings/resources otherwise.

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

| Criterion | Implementation and tests added | Status |
| --- | --- | --- |
| Exact preview revision, dimensions, metadata, fonts/content | Main-process cached bytes, source identity, final PDF inspection; actual PDF unit fixture and offline E2E artifact inspection | Unverified |
| Page count, resources, margins, clipping/overflow | Shared preflight, existing render diagnostics, blocking generation errors, corruption/geometry tests | Unverified |
| Actionable errors/warnings | Preview preflight panel in Export centre, located findings, warning acknowledgement, progress/cancel UI | Unverified |
| Local atomic destination, overwrite and cancellation | Shared export primitive; preservation, validation failure, destination race, stale revision, cancellation and restricted IPC tests | Unverified; new files use atomic no-clobber hard links |
| Offline Community operation | Existing isolated Chromium renderer, no new dependencies; offline desktop workflow test | Unverified |

New tests are in `packages/core/test/print-output.test.ts` and
`apps/desktop/test/print-export.test.ts`, with IPC coverage in
`chapter-persistence-ipc.test.ts`. Existing `tests/e2e/print.spec.ts` now compares
the atomically published multi-page artifact to preview bytes before independent
PDF.js text/position inspection. The desktop PDF scenario uses the Export centre,
inspects exported dimensions/metadata/content offline, rejects overwrite and
checks stale-source preservation. Existing resource/font/overflow fixtures are
reused, not replaced.

The initial frozen-lockfile install succeeded before environment permissions
changed. The final attempts at lint, format check, typecheck, tests, build and
desktop E2E stopped at `EPERM` reading installed ESLint/Prettier/TypeScript files.
The workspace check stopped resolving TypeScript. A later frozen install aborted
without modifying dependencies because it required interactive module removal.
An intermediate typecheck identified missing API methods in a test mock, which
were added; that fix and subsequent changes have not been revalidated. No new
PDF properties have been independently verified in this session.

Completion requires a working pinned dependency environment, formatting and all
requested checks, successful native desktop tests, independent PDF inspection,
and resolution of any failures found. Use **Related to #130**, not a closing
reference, until that evidence exists.
