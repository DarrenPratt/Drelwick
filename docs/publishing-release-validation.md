# Offline DOCX-to-EPUB release validation

Related to #127. Classification: CORE (`product:core`). **Release gate remains
open**: EPUBCheck fails on the exported candidate; manual reader review and
platform release validation remain outstanding. Automated structural tests are
not EPUBCheck or reader evidence.

## Validation identity

The evidence in this document was originally recorded in the archived
`D:\Source\BookEditor` checkout and recovered into `D:\Source\Drelwick` on
2026-10-03. Its synthetic candidate and raw log files were also copied to the
ignored `artifacts/issue-127/` directory; the recorded candidate hash was verified.
The historical checks below are not claims of fresh checks in Drelwick. See the
[recovery review](planning/bookeditor-recovery.md) for validation of the port.

Original validation date: 2026-10-03. Windows 11 Pro x64, build 10.0.26200; Node 24.18.0,
pnpm 10.34.5, Electron 39.1.2 and Playwright 1.63.0. Source-built application,
not an installer. Base HEAD: `4d93afedfd9be257c1939eb8a9ef88065dc34e88`, with
uncommitted publishing and packaging work already present, plus the focused
validation changes described here. HEAD alone does not reproduce this working
tree. No commit, issue closure, merge or publication was performed.

Prerequisites #126, #125, #116, #124, #45 and #47 are closed. Corresponding
implementation exists in the EPUB/DOCX exporters, import UI, ebook preview,
Electron tests and synthetic fixtures. Merged PRs #205/#206, #204, #179, #193,
#146 and #147 respectively provide the dependency history. This validates the
current working implementation, rather than inferring functionality from plans.

## Automated acceptance evidence

The existing `tests/e2e/desktop.spec.ts` scenario named
`completes the offline DOCX to EPUB publishing workflow and independently inspects both outputs`
imports synthetic DOCX, approves warnings, edits, adds dedication/author matter
and a cover, selects Literary, saves, restarts with the same profile, reopens the
project and exports both formats. The restart was added during the recovery review.
It retains
`published.epub` and `published.docx` in its Playwright output directory for
external validation. Generated IDs/timestamps vary: the fixture content and
expectations are deterministic, not the archive hash across separate runs.

| Requirement                           | Executable evidence and scope                                                                                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCX import and warning review        | Publishing E2E plus `reviews DOCX warnings and chapter mapping...`: blocked approval, located warnings, mapping, cancel and unchanged source                                                                                                          |
| Editing and save/restart              | Adjacent DOCX import E2E verifies exact edited text after process restart/reopen; publishing E2E saves before export                                                                                                                                  |
| Front/back matter, metadata and cover | Publishing E2E; adjacent publication E2E persists/reopens matter and cover; `publication.test.ts` checks inclusion and source preservation                                                                                                            |
| Theme and persistence                 | Publishing E2E selects Literary and checks CSS; `Community themes...survive restart` E2E verifies saved selection and unchanged prose                                                                                                                 |
| EPUB and editable DOCX export         | Real native export adapters in publishing E2E; independent `yauzl` ZIP / strict `sax` XML inspection, DOCX re-import                                                                                                                                  |
| Exact text/order and Unicode          | Publishing E2E resolves OPF manifest/spine and compares every content document's text to literal expectations, including front/body/back order; DOCX export tests compare exact reading text/order and re-imported chapters                           |
| Metadata/navigation/assets            | Publishing E2E checks title, author, language and exact TOC labels; `epub-export.test.ts` checks packaged image bytes, cover property, alt text and internal links; `docx-export.test.ts` independently checks media relationships and metadata       |
| Semantic round-trip                   | `docx-export.test.ts` covers headings, emphasis, nested lists/starts, links, tabs, hard breaks and explicit degradations; renderer `render.test.ts` has semantic XHTML goldens. EPUB is generated output, not an editable project round-trip          |
| Long book                             | New focused EPUB fixture: 100 chapters × 100 paragraphs × 10 words = 100,000 synthetic words, with exact paragraph text and spine order checks. This is export-scale evidence, not a long-book UI performance or reader benchmark                     |
| Missing assets                        | Existing assembly test now also verifies EPUB rejection after deleting a managed image descriptor; focused EPUB test rejects a missing selected cover; existing DOCX export test rejects missing assets                                               |
| Failed export/source preservation     | `epub-output.test.ts` injects write/commit failures and cancellation, retains old output, checks temporary cleanup and unchanged project snapshot; existing DOCX failure tests cover atomic replacement and declined destinations                     |
| IPC/path authorization                | Existing DOCX IPC test parameterized for EPUB too: trusted frame, active project, malformed/path-bearing payload and busy state; EPUB destination tests reject project-internal paths and wrong extensions                                            |
| Networking disabled/no requests       | Publishing E2E sets Playwright browser context offline before import, records HTTP(S) context requests and WebSocket openings, expects none. It is not an OS firewall isolation or main-process packet capture test; setup downloads occur separately |
| Manuscript-free logs                  | Publishing E2E requires a nonempty log directory and rejects fixture prose in each log; `file-logger.test.ts` tests sanitization; preload/main-window tests cover renderer isolation                                                                  |

The new assertions fill gaps in the earlier broad evidence summary; the existing
Windows workflow was reused. Successful tests establish only the behaviors they
assert, not EPUB conformance or universal accessibility.

## EPUBCheck: executed, failed

A portable Java runtime and the official CLI were downloaded into the ignored
`artifacts/issue-127/tools` directory; no global Java/PATH change was needed.
The earlier environmental blocker is resolved.

- Official release: [W3C EPUBCheck 5.4.0](https://github.com/w3c/epubcheck/releases/tag/v5.4.0),
  downloaded as `epubcheck-5.4.0.zip`, retaining the JAR and `lib` directory together.
- Java: Eclipse Temurin OpenJDK JRE `21.0.12.1+1-LTS`, Windows x64 HotSpot,
  downloaded through the official Adoptium API. Archive SHA-256 verified against
  its API checksum: `d35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636`.
- `--version` prints `EPUBCheck v5.4.0`.
- Candidate: actual UI-produced `published.epub`, copied from the passing
  deterministic publishing E2E to `artifacts/issue-127/published.epub`.
- Candidate SHA-256: `3bf70f103a75a97e2e994ab5b71ba4374ff06a66eb2ed273a0af4fe2f81b826b`.
- Exact PowerShell command from `D:\Source\BookEditor`:

```powershell
& 'artifacts/issue-127/tools/java/jdk-21.0.12.1+1-jre/bin/java.exe' -jar artifacts/issue-127/tools/epubcheck-5.4.0/epubcheck.jar artifacts/issue-127/published.epub
```

Exit code **1**. Complete finding:

```text
Messages: 0 fatals / 1 error / 0 warnings / 0 infos
ERROR(OPF-001): artifacts/issue-127/published.epub/OEBPS/package.opf(-1,-1): There was an error when parsing the EPUB version: Version not supported.

EPUBCheck completed

Check finished with errors
```

Raw output is retained at `artifacts/issue-127/epubcheck.txt`. The exporter writes
package `version="3.3"`; [EPUB 3.3's package specification](https://www.w3.org/TR/epub-33/#sec-package-elem)
requires `3.0`. Inspection also shows no required `dcterms:modified` metadata.
The latter is a source-inspection finding, not a diagnostic from this run:
EPUBCheck stopped at the unsupported version. Other defects may be masked.
Production conformance repair and a fresh EPUBCheck run remain release blockers;
this validation change does not alter the exporter or patch the candidate ZIP.

Validated build SHA-256 values:

- `apps/desktop/dist/main/main.js`: `1959f0ede8ef23ab2a4e8bc7093613aca2904fe4facb0884b3cd2b904510ff2e`
- `packages/core/dist/epub-export.js`: `1c5612336bf073f8a21e6610393ac1b3c41ef753009a87f592cf42c5c62906f8`

The initial focused candidate also failed with the same finding; its hash was
`4a6f6145b79af74c97d15ed32d42a4e1fa340d87a862cd4ac91b6b2dc3e24d8e`.
The candidate recorded above is from the final passing full Electron suite.

To reproduce: build, run the focused scenario, copy its output to a candidate
directory outside `test-results` (Playwright clears that directory on later
runs), hash it, then execute the command above with the candidate path. Keep
version, exit code, complete output, source revision/diff and candidate hash
together. Require zero errors before claiming EPUBCheck conformance. Internal
structural validation remains useful but cannot substitute for EPUBCheck.

## Manual reader checklist — NOT EXECUTED

Owner: generate a fresh release-candidate EPUB after conformance repairs and
retain the exact file validated by EPUBCheck. Record date, candidate SHA-256,
application build/commit, OS, reader name/version, settings and tester. Open it
locally in an EPUB 3 reader with networking disabled. For each item record
PASS/FAIL, or NOT TESTED with reason, plus screenshots/locations for findings.
Do not mark a missing feature as passed because this small fixture omits it.
Use an additional synthetic semantic/image/link candidate where necessary.

- [ ] Cover: visible in library and reading view, correct image, aspect ratio and no clipping. The fixture uses a synthetic cover, not production artwork.
- [ ] Title/metadata: `Offline Fixture`, `Synthetic Author`, `en-GB`; inspect library metadata and language behavior. Record fields the reader does not expose.
- [ ] TOC/navigation: Opening → Chapter One → Chapter Two → About the author; follow every link, test return/back navigation and keyboard operation. Cover/dedication are intentionally excluded from this TOC.
- [ ] Reading order: Ebook cover → Dedication → Opening → Chapter One → Chapter Two → About the author. Confirm sequential page/scroll navigation agrees with TOC.
- [ ] Front/back matter: dedication says `Dedicated offline.`; author page says `About the synthetic author.`; no missing/blank/clipped pages.
- [ ] Unicode: compare `Café é “quotes” — – Ελληνικά 中文 العربية हिन्दी 🌱` in Opening/Chapter One, including combining accent, RTL text and emoji. Opening additionally ends ` edited locally`. Record missing glyphs or ordering issues.
- [ ] Images/alt text: inspect sizing and cover alternative `Offline Fixture cover`; with assistive technology inspect body-image alternatives in the semantic fixture. Record duplicate/unhelpful announcements.
- [ ] Theme/CSS: inspect Literary headings, body indentation/spacing and fallback fonts; record reader overrides, duplicated imported chapter headings or styling loss.
- [ ] Reflow: use narrow/wide viewports and at least default and 200% font size; verify readable text, no overlap/clipping and usable navigation. Repeat with reader font/theme overrides.
- [ ] Links: follow internal chapter links and return; inspect external links in a synthetic link fixture without enabling network retrieval. This publishing fixture has TOC links but no body links.
- [ ] Accessibility observations: inspect heading hierarchy, reading/language order, cover/image alternatives, contrast, focus visibility and keyboard/screen-reader navigation. Record assistive technology/version and limitations; EPUBCheck alone does not certify accessibility.

Manual result: **NOT TESTED**. No reader, screen-reader or accessibility sign-off
is claimed. No embedded fonts, exact Word pagination, print layout or identical
cross-reader typography is promised. Supported semantic degradations remain
those in the DOCX import/export support matrices.

## Platform evidence

| Platform/scope                        | Evidence/status                                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows source-built Electron         | Exercised locally by the full E2E suite and focused publishing scenario                                                                                                                                                                                          |
| Windows official EPUBCheck CLI        | Executed with portable Windows Java; candidate failed as recorded above                                                                                                                                                                                          |
| Linux build/unit CI, earlier revision | GitHub Actions run `37046179573`, commit `2f0be8bb2deeac7db0e423e3d3a12b28043ebff6`, Quality checks succeeded; not evidence for this uncommitted tree                                                                                                            |
| Linux publishing runtime              | `xvfb-run -a pnpm exec playwright test tests/e2e/desktop.spec.ts --grep "complete.*DOCX to EPUB"` added to Ubuntu Quality checks. **Not executed here or claimed passed**; no push/CI run requested. Only Docker Desktop's WSL distribution is installed locally |
| macOS runtime                         | **Unverified**; no macOS environment available                                                                                                                                                                                                                   |
| Windows/macOS/Linux packaged workflow | **Unverified in this validation pass**. Existing packaging work and a configured Linux packaging job do not establish publishing acceptance on a packaged build                                                                                                  |
| Native EPUB readers                   | **Unverified on every platform**                                                                                                                                                                                                                                 |

Do not infer cross-platform runtime, installer or reader support from Windows,
TypeScript builds or generic Electron support. Owner must execute and record
applicable platform candidates or explicitly retain those release limitations.

## Repository checks

Originally executed in BookEditor on Windows on 2026-10-03:

| Command                                          | Result                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                 | PASS, exit 0; unchanged lockfile                                                |
| `pnpm lint`                                      | PASS, exit 0, including final test changes                                      |
| `pnpm format:check`                              | PASS, exit 0                                                                    |
| `pnpm typecheck`                                 | PASS, exit 0, including final test changes                                      |
| `pnpm test`                                      | PASS on rerun, exit 0: 961 tests / 84 files                                     |
| `pnpm build`                                     | PASS, exit 0                                                                    |
| `pnpm check:workspace`                           | PASS, exit 0                                                                    |
| `pnpm test:e2e`                                  | PASS, exit 0: 17 tests                                                          |
| Focused publishing E2E command below             | PASS, exit 0: 1 test; final strengthened scenario also passed in the full suite |
| Focused publishing/security Vitest command below | PASS, exit 0: 34 tests / 9 files                                                |
| Official EPUBCheck command above                 | FAIL, exit 1: 1 error, no warnings; release blocker                             |

```text
pnpm exec playwright test tests/e2e/desktop.spec.ts --grep "complete.*DOCX to EPUB"
pnpm exec vitest run packages/core/test/epub-export.test.ts packages/core/test/epub-output.test.ts packages/core/test/docx-export.test.ts packages/core/test/book-assembly.test.ts apps/desktop/test/docx-export.test.ts apps/desktop/test/security-baseline.test.ts apps/desktop/test/file-logger.test.ts apps/desktop/test/preload.test.ts apps/desktop/test/main-window.test.ts
```

The first full unit run had 960 passes and one failure in the existing DOCX
captured-assets test: regenerating identical content crossed a ZIP timestamp
tick. The assertion now compares every independently extracted archive entry
instead of timestamp-bearing ZIP bytes, retaining the captured-content guarantee.
Both the focused rerun and complete suite passed after that correction.

Non-fatal tooling messages: frozen install ignored `electron-winstaller`'s build
script; Vite reported its existing >500 kB chunk-size advisory; Playwright reported
the `NO_COLOR`/`FORCE_COLOR` environment conflict. These do not establish installer
validation. No new dependency or production behavior was added.

Raw local logs are retained under ignored `artifacts/issue-127/`, including
`test.log` (initial failure), `test-rerun.log`, `test-e2e.log`,
`focused-tests-final.log`, `check-results.txt` and `epubcheck.txt`. These are not
committed release artifacts and must be archived with the candidate before
release approval.

## Remaining owner/release actions

1. Repair the EPUB conformance defects, regenerate from the application and rerun
   official EPUBCheck; retain all newly exposed findings until resolved.
2. Perform and record the manual reader/accessibility checklist against that same
   hashed candidate; record limitations rather than treating automation as review.
3. Execute the added Linux CI step after an explicitly authorized commit/push;
   obtain macOS and applicable packaged-platform publishing evidence before
   claiming support. Preserve any untested platform limitations in release notes.
4. Review the completed evidence against every #127 acceptance criterion. Use
   `Related to #127` while any gate remains outstanding; do not close the issue.
