# Offline DOCX-to-EPUB release validation

Related to #127 and #208. Classification: CORE (`product:core`). The automated
publishing and EPUB conformance gates pass in the current Windows source-built
checkout. Manual reader/accessibility review and one-OS-at-a-time Linux/macOS
execution evidence are deferred to #208; packaged-app validation remains in
#107.

## Validation identity

Fresh validation was performed on 2026-10-05 from the current Drelwick `main`
checkout after merged PR #207. PR #207 added Linux source-built publishing and
packaged validation jobs, packaging hardening and the publishing fixtures; it
did not provide macOS execution or manual-reader evidence. The application
uses Node 24, pnpm 10.34.5, Electron 39.1.2 and Playwright 1.63.0.

The deterministic Electron scenario retains the UI-produced files in the
Playwright output directory. The generated archive contains a current
`dcterms:modified` timestamp, so its SHA-256 is expected to differ between
runs. The project fixture and asserted semantic content remain deterministic.

## Automated tests — PASS

The scenario
`tests/e2e/desktop.spec.ts:2007` imports a synthetic DOCX, reviews and approves
warnings, edits Unicode prose, adds front/back matter and a managed cover,
selects the Literary theme, saves, restarts with the same profile, reopens the
project, and exports EPUB plus editable manuscript DOCX. It independently
inspects both output formats and preserves the source DOCX.

| Acceptance area                                 | Current executable evidence                                                                                                                 | Result |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| DOCX import and warning review                  | Publishing E2E plus the adjacent warning/mapping scenario, including blocked approval, located warnings, cancellation and unchanged source  | PASS   |
| Editing, save/restart/reopen                    | Publishing E2E and adjacent import E2E assert exact prose after restart                                                                     | PASS   |
| Front/back matter, metadata, cover and theme    | Publishing E2E, publication persistence E2E and publication core tests                                                                      | PASS   |
| EPUB and editable DOCX export                   | Real native export adapters; independent ZIP/XML inspection and DOCX re-import                                                              | PASS   |
| Exact supported text, reading order and Unicode | OPF manifest/spine and DOCX reading-order assertions compare literal fixture content                                                        | PASS   |
| Navigation, assets, image alternatives and CSS  | EPUB nav/manifest/spine checks, image-byte checks, cover property, alt text and theme CSS assertions                                        | PASS   |
| Semantic round-trip expectations                | DOCX exporter/importer tests cover headings, marks, lists, links, tabs and hard breaks; renderer XHTML goldens cover EPUB semantics         | PASS   |
| Long-book fixture                               | 100 chapters × 100 paragraphs × 10 words, with exact paragraph and spine-order assertions                                                   | PASS   |
| Missing assets                                  | Assembly, EPUB cover/asset and DOCX asset tests reject missing or changed managed assets                                                    | PASS   |
| Failed export and source preservation           | EPUB atomic output tests cover write/commit failure and cancellation; DOCX failure tests preserve output/project/source                     | PASS   |
| Privileged IPC and path validation              | Parameterized DOCX/EPUB IPC authorization and destination safety tests                                                                      | PASS   |
| Renderer isolation                              | Preload, main-window and security-baseline tests cover context isolation, disabled node integration and restricted APIs                     | PASS   |
| Offline/no-network operation                    | Publishing E2E runs with Playwright offline mode and asserts no HTTP(S)/WebSocket requests; setup downloads are outside the application run | PASS   |
| Manuscript-free logs                            | Publishing E2E and file-logger tests reject fixture prose in logs                                                                           | PASS   |

These tests are evidence for the behaviors they assert. They are not a
replacement for official EPUBCheck, native-reader review or accessibility
testing.

## EPUBCheck — PASS

The previous candidate was stale relative to the current build and exposed
three exporter defects: unsupported package version `3.3`, missing
`dcterms:modified`, and XML-invalid manifest IDs. The exporter now emits EPUB
package version `3.0`, a UTC `dcterms:modified` value without milliseconds,
and name-safe prefixed manifest IDs. Focused regression coverage protects
these requirements.

| Field         | Evidence                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool          | Official W3C EPUBCheck 5.4.0                                                                                                                                                                                                             |
| Java          | Eclipse Temurin JRE 21.0.12.1 LTS                                                                                                                                                                                                        |
| Candidate     | Fresh UI-produced `test-results\desktop-completes-the-offl-3a61a-ently-inspects-both-outputs\published.epub`                                                                                                                             |
| SHA-256       | `A0CF96BECDD9F3C9529BA309EBF070337B186F9A02BB158E4A4E3FB4F90500CC`                                                                                                                                                                       |
| Exact command | `& 'artifacts\issue-127\tools\java\<jdk-folder>\bin\java.exe' -jar 'artifacts\issue-127\tools\epubcheck-5.4.0\epubcheck-5.4.0\epubcheck.jar' 'test-results\desktop-completes-the-offl-3a61a-ently-inspects-both-outputs\published.epub'` |
| Exit code     | `0`                                                                                                                                                                                                                                      |
| Diagnostics   | `0 fatals / 0 errors / 0 warnings / 0 infos`                                                                                                                                                                                             |
| Result        | PASS                                                                                                                                                                                                                                     |

The CI quality job repeats official EPUBCheck 5.4.0 against the candidate
produced by the Linux publishing E2E. It downloads only test tooling; the
application's publishing path remains fully local and offline.

## Manual reader and accessibility evidence — DEFERRED TO #208

No reader or screen-reader sign-off has occurred. Issue #208 owns this gate.
An owner must generate a
fresh release-candidate EPUB after the tested commit, retain the exact file
validated by EPUBCheck, disable reader networking, and record date, candidate
SHA-256, application commit, OS, reader/version, settings and tester. Record
PASS, FAIL or NOT TESTED for each item and attach screenshots or locations for
findings.

- EPUB opens successfully in the reader.
- Cover is visible in the library and reading view without clipping.
- Title, author and language metadata are correct.
- Table of contents, every entry, return/back navigation and keyboard navigation work.
- Sequential reading order matches cover, front matter, chapters and back matter.
- Front matter and back matter contain the expected prose without blank or clipped pages.
- Unicode including combining accents, curly punctuation, em/en dashes, Greek, CJK, Arabic, Hindi and emoji renders and reads in the expected order.
- Embedded images have correct size and useful alternative text; inspect image announcements with assistive technology.
- Theme/CSS rendering, fallback fonts, spacing and headings remain usable.
- Text reflows at narrow/wide sizes, at default and 200% font size, and with reader font/theme overrides.
- Internal links navigate and return; external links are inspected without enabling network retrieval.
- Observe heading hierarchy, language/reading order, contrast, focus visibility, keyboard navigation and screen-reader output.
- Record obvious rendering defects and accessibility limitations; EPUBCheck is not accessibility certification.

The fixture intentionally does not prove every possible semantic, link or image
combination. Use the existing semantic/image/link candidate in addition to the
main publishing candidate where needed. Do not claim manual validation from
structural tests.

## Platform and packaged-app evidence

| Scope                                            | Result           | Evidence or limitation                                                                                                                                                                               |
| ------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows source-built Electron                    | PASS             | Full current `pnpm test:e2e` ran 17 tests, including the publishing workflow, on Windows.                                                                                                            |
| Windows official EPUBCheck                       | PASS             | Portable Temurin 21.0.12.1 and EPUBCheck 5.4.0 validated the fresh candidate above.                                                                                                                  |
| Linux source-built Electron                      | DEFERRED TO #208 | PR #207 adds `xvfb-run -a pnpm exec playwright test tests/e2e/desktop.spec.ts --grep "complete.*DOCX to EPUB"` to the Ubuntu quality job; #208 runs and records the current result one OS at a time. |
| macOS source-built Electron                      | DEFERRED TO #208 | PR #207 adds a macOS source-built publishing job; #208 records its current result.                                                                                                                   |
| Windows/Linux/macOS packaged publishing workflow | NOT TESTED       | Electron Builder targets and package inspection do not establish packaged runtime publishing support; general packaged-app work remains in #107.                                                     |
| Native EPUB readers                              | NOT TESTED       | Owner/manual reader execution is required on the selected release candidate.                                                                                                                         |

No runtime or release claim is inferred from an Electron Builder target,
TypeScript build, source test on another OS or an unrun workflow.

## Repository validation — current checkout

| Command                                                                                              | Result                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------------- |
| `pnpm lint`                                                                                          | PASS                          |
| `pnpm format:check`                                                                                  | PASS                          |
| `pnpm typecheck`                                                                                     | PASS                          |
| `pnpm test`                                                                                          | PASS — 963 tests / 86 files   |
| `pnpm build`                                                                                         | PASS                          |
| `pnpm check:workspace`                                                                               | PASS                          |
| `pnpm test:e2e`                                                                                      | PASS — 17 tests               |
| `pnpm exec vitest run packages/core/test/epub-export.test.ts packages/core/test/epub-output.test.ts` | PASS — 8 tests                |
| `pnpm exec playwright test tests/e2e/desktop.spec.ts --grep "complete.*DOCX to EPUB"`                | PASS — 1 test                 |
| Official EPUBCheck 5.4.0                                                                             | PASS — exit 0, no diagnostics |

Focused security and publishing coverage is included in the full unit suite;
the targeted command used for the relevant regression surface is:

```text
pnpm exec vitest run packages/core/test/epub-export.test.ts packages/core/test/epub-output.test.ts packages/core/test/docx-export.test.ts packages/core/test/book-assembly.test.ts apps/desktop/test/docx-export.test.ts apps/desktop/test/security-baseline.test.ts apps/desktop/test/file-logger.test.ts apps/desktop/test/preload.test.ts apps/desktop/test/main-window.test.ts
```

## Known limitations and outstanding validation

- Manual EPUB reader, accessibility and screen-reader review is still required.
- Linux and macOS source-built publishing jobs are configured but have not
  produced current-run evidence in this checkout.
- Packaged-app publishing and installer acceptance remain untested on all
  platforms; unsigned validation artifacts are not official releases.
- EPUBCheck does not certify accessibility, reader typography, exact Word
  pagination, embedded-font behavior or cross-reader rendering.
- Supported semantic degradations remain those documented in the DOCX import
  and export support matrices.

Issue #127 now covers the automated workflow and EPUBCheck evidence. Use
`Related to #127` while its automated change is under review; #208 is the
separate end-of-cycle gate. The remaining owner actions for #208 are only:

1. Run the Linux and macOS CI publishing jobs and retain their results.
2. Generate and manually inspect the EPUBCheck-passing candidate in a native
   reader and with the chosen accessibility technology.
3. Record PASS/FAIL/NOT TESTED observations, findings and limitations here,
   then reassess every #127 acceptance criterion.
