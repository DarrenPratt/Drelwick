# Issue #117 implementation audit

Starting state: clean `main`, `818fbf0` (merged #116). Working branch:
`feature/117-text-markdown-html-import`. Product classification: CORE.
No project/component schema changes, Pro dependencies or merge actions.

## Prerequisites verified against implementation

- #114, merged in `1ff6cc1`: `packages/project-model/src/manuscript-import.ts`
  defines/validates metadata, chapters, assets and located warnings with bounded
  JSON validation. Core `manuscript-import.ts` implements bounded source reads,
  private digest-checked staging, preview, repeated schema/image validation,
  empty-destination authorization, exclusive publication, cancellation and cleanup.
  `import-parser.ts`/`import-parser-worker.ts` bound and isolate conversion. The
  main import handler enforces trusted frames and operation ownership; preload
  exposes no paths or arbitrary parsing programs. Existing import tests exercise
  invalid intermediate data, races, rollback, cleanup failure, source preservation
  and isolated execution. No material prerequisite gap found.
- #116, merged in `818fbf0`: the welcome/workspace and File menu share the import
  command and navigation/dirty-save guard. `ImportManuscriptDialog.tsx` provides
  metadata, located warnings with individual decisions, chapter boundary/title
  adjustment, cancellation and operation progress. Main handles native source and
  empty-destination selection, review validation, commit and a one-use open grant.
  Normal project-open validates identity/content before activation. Workflow, IPC
  and Electron tests cover failed saves/commits/opens and retention of the active
  project. Its registry/renderer selected DOCX only; #117 extends dispatch. The
  earlier workflow did not authorize linked sibling images; #117 adds individual
  native selection while retaining the existing asset reader/validator.

## Evidence key

- **Parser**: `packages/core/src/text-import/parser.ts` — semantic conversion,
  conservative chapters, safe links, active-content removal and limits.
- **Adapter**: `packages/core/src/text-importer.ts` — fatal UTF-8 check, isolated
  passes, native-selection callback and existing image validation.
- **Pipeline**: `packages/core/src/manuscript-import.ts` and
  `packages/project-model/src/manuscript-import.ts` — unchanged authoritative
  validation/staging/commit architecture; format-neutral errors and image-picker
  cancellation compatibility are the only generic-coordinator changes.
- **Desktop**: `apps/desktop/src/main/ipc/import-handlers.ts` and
  `apps/desktop/src/renderer/ImportManuscriptDialog.tsx` — native dispatch and the
  existing shared review lifecycle.
- **Core tests**: `packages/core/test/text-import.test.ts`.
- **IPC tests**: `apps/desktop/test/manuscript-import-ipc.test.ts`.
- **E2E**: `tests/e2e/desktop.spec.ts`.
- **Existing reliability**: `packages/core/test/manuscript-import.test.ts`,
  `packages/core/test/import-review.test.ts`,
  `apps/desktop/test/project-workflows.test.ts`, and
  `apps/desktop/test/project-open-ipc.test.ts`.

## Acceptance audit

PASS here means implementation plus executed test evidence, subject to the
documented [support matrix](../text-import.md); it does not claim arbitrary HTML,
every Markdown extension, exact page rendering or execution on all platforms.

| #   | Criterion                                 | Result | Implementation and test evidence                                                                                                                                                |
| --- | ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | TXT importer                              | PASS   | Parser TXT adapter; core TXT exact golden and E2E TXT                                                                                                                           |
| 2   | Markdown importer                         | PASS   | Marked through Parser; core Markdown exact golden and E2E MD                                                                                                                    |
| 3   | HTML importer                             | PASS   | parse5 through Parser; core HTML exact golden and E2E HTML                                                                                                                      |
| 4   | Explicit UTF-8                            | PASS   | Adapter fatal decoder plus VM decoder; each-format malformed bytes/BOM/endings tests                                                                                            |
| 5   | Unicode                                   | PASS   | No Unicode normalization; each-format Unicode golden, combining marks and E2E restart                                                                                           |
| 6   | Paragraph/reading order                   | PASS   | Ordered conversion and inline traversal; exact golden arrays, nested-inline and TXT blank-line cases                                                                            |
| 7   | Markdown semantic mapping                 | PASS   | Marked/semantic allowlist; golden paragraphs, marks, lists, quotes, links and breaks                                                                                            |
| 8   | HTML semantic mapping                     | PASS   | Parser allowlist; equivalent exact HTML golden                                                                                                                                  |
| 9   | Headings                                  | PASS   | Levels 1–6 and level-one proposals; all-heading-levels, golden and weaker/nested-heading tests                                                                                  |
| 10  | Lists                                     | PASS   | Ordered starts and nested list items; golden and nested mixed-list exact output                                                                                                 |
| 11  | Quotes                                    | PASS   | Existing blockquote vocabulary; both format goldens and nested heading in quote                                                                                                 |
| 12  | Scene breaks                              | PASS   | Existing sceneBreak nodes; TXT/Markdown/HTML goldens and ambiguous TXT separators                                                                                               |
| 13  | Unsupported syntax warnings/errors        | PASS   | Located recovery/removal warnings and bounded rejection; tables/tasks/custom tags, footnotes/definitions/math/directives and preformatted recovery tests                        |
| 14  | Ambiguous chapters                        | PASS   | Conservative TXT, absent/weaker level-one and mixed-heading warnings; TXT and weaker/nested-heading tests                                                                       |
| 15  | Shared proposal preview                   | PASS   | Desktop auto dispatch and existing review; all-extension IPC review/commit/open plus E2E                                                                                        |
| 16  | Active HTML sanitized/blocked             | PASS   | Allowlisted semantic construction; both-format adversarial scripts/events/SVG/embedded/resource tests                                                                           |
| 17  | Scripts cannot execute                    | PASS   | VM has no host APIs; no evaluation/HTML rendering; throw-if-executed adversarial source and actual bundle isolation test                                                        |
| 18  | Dangerous URL schemes                     | PASS   | Parser safe-scheme checks plus model validation; javascript/file/data adversarial tests                                                                                         |
| 19  | No remote resource fetching               | PASS   | No parser network capability, no URL resolver; actual bundle absence-of-network-APIs test and offline E2E                                                                       |
| 20  | Markdown raw HTML cannot bypass policy    | PASS   | Same converter; shared Markdown/HTML adversarial test and raw-HTML warnings                                                                                                     |
| 21  | Explicit local asset authorization        | PASS   | Adapter/native per-reference selection; selected/declined asset tests and native selection/skip/cancel IPC                                                                      |
| 22  | No unauthorized local reads               | PASS   | No reference-to-path resolution; VM cannot read files; callback only for eligible refs, skip placeholders and cancellation-before-read tests                                    |
| 23  | Traversal prevention                      | PASS   | Reference eligibility plus existing bounded reader; relative/absolute traversal adversarial cases and selected junction/symlink rejection                                       |
| 24  | Approved asset validation                 | PASS   | Existing validateImageContent plus pipeline revalidation; real PNG bytes, corrupt image rejection and selected-assets commit/source-removal tests                               |
| 25  | #114 staged architecture                  | PASS   | Adapter returns ImporterResult only; each-format staged success/failure/cancellation tests                                                                                      |
| 26  | #116 shared preview/commit                | PASS   | Single Desktop workflow; all-extension IPC tests and three Electron import/edit/reopen cases                                                                                    |
| 27  | Shared cancellation                       | PASS   | AbortSignal and inherited worker/coordinator checks; each-format five checkpoints, image selection cancellation and existing worker termination tests                           |
| 28  | Preserve active project on failure/cancel | PASS   | Pipeline never mutates active project; each-format source/active-project comparisons plus existing dirty-save, failed commit/open workflow tests                                |
| 29  | Sources never modified                    | PASS   | Read-only bounded source/selected-asset reads; tests compare bytes on invalid encoding, parser rejection, inspection, cancellation, stage/write failure, success and E2E reopen |
| 30  | Golden fixtures                           | PASS   | `tests/fixtures/import/novel.txt`, `.md`, `.html`; exact core semantic arrays for headings/lists/quotes/breaks/Unicode                                                          |
| 31  | Adversarial HTML tests                    | PASS   | Core active-content tests, malformed HTML/inline order, depth/size/warning limits, traversal and isolated execution                                                             |
| 32  | Failure/cancellation tests                | PASS   | Core format-specific staged failures/checkpoints/invalid bytes; IPC cancellation; existing invalid-intermediate/cleanup/destination/open tests retained                         |
| 33  | Desktop selection                         | PASS   | Native picker extensions match auto dispatch; all six extension variants plus uppercase DOCX and unsupported/binary IPC tests                                                   |
| 34  | Independent Community build               | PASS   | Only existing Community packages and permissive parsers; workspace build/smoke, full tests and offline Electron run without Pro                                                 |

## Fresh diff review

Reviewed production adapters, generic compatibility changes, desktop boundary,
dependency build, fixtures/tests and documentation. No direct project writes,
renderer path grants, source writes, network calls, manuscript logging, new schema,
Pro dependencies or placeholders were introduced. Review corrections:

- Footnote definitions could be mistaken for invisible Markdown link definitions:
  recognized unsupported extension syntax now retains complete literal source.
- HTML indentation and adjacent inline whitespace needed deterministic collapse:
  conversion now collapses ASCII whitespace across inline boundaries.
- Preformatted conversion could flatten away image blocks or hard breaks:
  it now preserves their positions and warns about reduced layout.
- Native **Cancel import** during image selection needed to retain cancellation
  status through the generic catch path; it now does, without staging or opening.

Test-development failures were corrected, not suppressed: fixture helpers needed
`await`, `loadChapter` required its object argument, loaded chapter content needed
schema narrowing in a test, and the bundled entities notice path needed correction.
Lint also caught the missing URL import and control-regex rules; production checks
now iterate code points rather than disabling lint rules.

## Executed checks

Final successful results in this Windows session (Node 24.18.0, pnpm 10.34.5):

| Exact command                                                                                                 | Result                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                              | PASS, before implementation and after dependency update                                   |
| `pnpm --filter @drelwick/core build`                                                                          | PASS                                                                                      |
| `pnpm exec vitest run packages/core/test/text-import.test.ts`                                                 | PASS, 33 tests at that checkpoint; subsequent heading/link cases included in coverage run |
| `pnpm exec vitest run packages/core/test/text-import.test.ts apps/desktop/test/manuscript-import-ipc.test.ts` | PASS, 55 tests at that checkpoint                                                         |
| `pnpm exec tsc -p tsconfig.test.json --noEmit`                                                                | PASS, including final added tests                                                         |
| `pnpm lint`                                                                                                   | PASS                                                                                      |
| `pnpm format:check`                                                                                           | PASS                                                                                      |
| `pnpm typecheck`                                                                                              | PASS                                                                                      |
| `pnpm test`                                                                                                   | PASS, 681 tests before six additional regression cases                                    |
| `pnpm test:coverage`                                                                                          | PASS, final 687 tests across 60 files                                                     |
| `pnpm build`                                                                                                  | PASS                                                                                      |
| `pnpm check:workspace`                                                                                        | PASS                                                                                      |
| `pnpm test:e2e`                                                                                               | PASS, all 7 Windows Electron scenarios                                                    |
| `git diff --check`                                                                                            | PASS                                                                                      |

The coverage run executes the real bundled worker. V8's source-file percentages
do not instrument that isolated bundle; parser correctness evidence is the
executed semantic/security assertions, not the reported percentage.

Initial failed attempts were corrected before the final successful runs:
core-only build used stale workspace declarations; the first workspace build
found an incorrect entities licence path; the first importer test run found six
test-helper/API mistakes; lint found four code-style/global issues; typecheck
found one later test's missing schema narrowing. No test or check was disabled.

## Delivery limits

No known issue-117 acceptance gap remains. Unsupported forms and resource limits
are explicit in the support matrix. Electron runtime verification is Windows;
macOS/Linux execution remains a platform-validation task. Existing Vite bundle-size
and pnpm ignored-esbuild-script notices are non-failing; both builds and tests run.
Review and merge remain separate human actions.
