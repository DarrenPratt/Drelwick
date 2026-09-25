# Testing

From the repository root:

```sh
pnpm test
pnpm test:e2e
pnpm test:watch
pnpm test:coverage
pnpm test --project @drelwick/shared
pnpm typecheck
```

`test` and `test:coverage` build workspace dependencies before running Vitest once
and return a nonzero exit code on failure. They do not enter watch mode, so CI can
use them directly. `test:watch` builds once before watching test/source changes;
rebuild dependencies if you change a package consumed through its `dist` exports.
The root README documents the pinned pnpm wrapper if pnpm is not installed globally.

## Desktop end-to-end tests

`pnpm test:e2e` builds the workspace and uses Playwright's Electron support to
launch the source-built desktop application. The Windows release-validation
scenario creates an isolated project, creates ten chapters, reorders them, writes
formatted prose and a scene break, verifies autosave, a runtime-created history
snapshot and the authoritative project files, then restarts and reopens the project. A second scenario force
terminates Electron, relaunches with the unclean session marker, recovers a
synthetic history candidate and verifies that recovery preserved the prior
chapter in history. Both tests use isolated temporary project/user-data folders
and remove only their own temporary data. The suite verifies the Windows runtime
path; standalone installer testing remains pending packaging issue #107, and
macOS/Linux execution requires those platforms.

The suite uses the Electron binary already pinned by the desktop workspace, so it
does not require a Playwright browser download. Linux agents without a display can
run it through `xvfb-run --auto-servernum pnpm test:e2e`. Playwright retains a
trace under `test-results/` when a run fails; generated reports and results are
ignored by Git.

Vitest and its V8 coverage provider are both pinned to 4.1.11, which passes this
repository's TypeScript 5.9 strict checks without suppressing declaration errors.
Node.js types match the supported Node 24 runtime. Tests explicitly import
`test` and `expect` from `vitest`; no test globals are added to production projects.

## Workspace conventions

Issue #122's Community theme tests live in `packages/renderer/test/themes.test.ts`
(strict configuration, six preset/target CSS goldens, exact semantic preservation,
offline/generic fonts) and `packages/core/test/book-presentation.test.ts`
(defaults, migration, portable persistence, failure/recovery and path boundaries).
Desktop unit tests exercise selection failure, cached restyling, restricted IPC
and stylesheet-hash CSP. The native Electron theme scenario switches every preset
offline, compares manuscript bytes and markup, renders generic fallback fonts and
restarts with the saved selection. See [the theme acceptance audit](../docs/book-themes-acceptance.md).

The root config discovers `packages/*/vitest.config.ts`,
`apps/*/vitest.config.ts` and the workspace-smoke config. New workspaces opt in by
adding a config using `defineProject` from `vitest/config`, a unique package name,
the Node environment and `include: ["test/**/*.test.ts"]`. Place unit tests under
that workspace's `test/` directory. This pattern excludes generated `dist/`,
coverage reports and future end-to-end suites from unit-test discovery.

`tsconfig.test.json` includes these configs and tests, extends the shared strict
settings and emits nothing. Production builds continue to include only `src/`.
If a future suite requires TSX or a browser environment, add its corresponding
test configuration and TypeScript settings with that implementation.

## Project schema and persistence coverage

The coverage requested by project-model task 41 (GitHub issue #42) is split
between model-level and filesystem integration tests:

| Acceptance criterion                                  | Evidence                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid project and chapter fixtures pass               | `packages/project-model/test/schemas.test.ts` validates project, book and chapter objects; `packages/core/test/project-loading.test.ts` creates and reopens a complete on-disk project.                                                                                                        |
| Malformed files and unsupported versions are rejected | `packages/core/test/project-loading.test.ts` checks malformed JSON and invalid schemas for the manifest, book metadata and chapter files, and unsupported versions for each. `packages/project-model/test/schemas.test.ts` also rejects unsupported versions at each persisted model boundary. |
| Atomic writes preserve valid data on failure          | `packages/core/test/atomic-writer.test.ts` covers serialization, temporary-file creation and rename failures, preservation of the prior target, and cleanup behavior.                                                                                                                          |
| Chapter ordering persists and reopens correctly       | `packages/core/test/chapter-ordering.test.ts` checks manifest order after reopen, unchanged chapter-file bytes, invalid requests, and preservation after manifest-write failure.                                                                                                               |

These checks exercise the implemented model and persistence behavior; DOCX,
publishing and migration coverage belongs with those later implementation
issues.

## Manuscript document schema coverage

Issue #43's editor-schema acceptance criteria are covered by headless tests:

| Acceptance criterion                       | Evidence                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported content round-trips without loss | `apps/desktop/test/manuscript-document.test.ts` JSON-serializes a paragraph with bold/italic marks, a block quote and a scene break, validates/deserializes it, then compares the restored editor JSON. |
| Invalid nodes are rejected                 | The same test rejects unknown nodes and marks, malformed block quotes, invalid inline nodes and scene-break presentation attributes through `ManuscriptDocumentSchema`.                                 |
| Scene breaks remain semantic               | `apps/desktop/test/scene-break.test.ts` verifies the stored node is `sceneBreak` and contains no decorative text; manuscript schema round-trip preserves that node.                                     |
| Tests run headlessly                       | The editor schema and semantic node tests run under Vitest with jsdom; they do not launch Electron or require a visible browser.                                                                        |

The schema tests verify the persisted ProseMirror document contract. Publishing
converters and print rendering remain outside this v0.1 issue.

## Semantic publishing elements (#112)

`apps/desktop/test/manuscript-document.test.ts` round-trips heading levels 1-6,
nested mixed lists, validated links, Unicode and attributed epigraphs through the
real TipTap extensions and `ManuscriptDocumentSchema`. It also rejects unsafe
link schemes. `editor-toolbar.test.ts` exercises the keyboard-focusable block,
list, link and epigraph controls, while `paste-sanitization.test.ts` verifies the
same supported HTML vocabulary and preservation of prose from unsupported
wrappers. `packages/core/test/chapter-saving.test.ts` saves, reopens and compares
the semantic JSON through the authoritative filesystem boundary. Existing
fixture and migration suites remain regression coverage for historical chapter
documents.

The new-project dialog tests opt into jsdom using a per-file Vitest environment
directive. They render React with `act`; native modal methods are stubbed because
jsdom does not implement their focus/layout behavior. Test TypeScript includes
the renderer's window API declaration, DOM types and JSX support. Desktop tests
also execute the built sandbox preload, so build before running Vitest directly.

The two initial tests verify loading the shared TypeScript entry and resolving
the built workspace dependency through its separate consumer. They validate the
test infrastructure; application behaviour tests arrive with their issues.

## Standard project fixtures

Issue #113 uses `synthetic-images.json` for tiny, deterministic PNG/JPEG bytes
through `tests/helpers/synthetic-images.ts`. Core image tests copy standard book
fixtures and exercise validation, failed writes, shared references and portability.
Editor/IPC tests cover controls, Unicode, missing assets and authorization. The
third Electron scenario imports an image through the privileged picker, verifies
remote paste causes no request, and reopens a copied project offline without the
source image. See [local image evidence](../docs/local-image-assets.md#evidence).

Canonical, publication-safe project fixtures live under `tests/fixtures/`. Their
UUIDs, timestamps and synthetic manuscript content are deterministic.

| Fixture              | Purpose                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `minimal-book`       | Small valid project with one empty paragraph chapter.                                           |
| `multi-chapter-book` | Three valid chapters whose manifest order differs from filename order.                          |
| `formatted-book`     | Nodes and marks accepted by the current `ManuscriptDocumentSchema`.                             |
| `unicode-book`       | UTF-8 punctuation, accents, Greek, Japanese and Arabic synthetic text.                          |
| `invalid-project`    | Valid book/chapter files with one deliberate error: a duplicated manifest chapter ID.           |
| `recovery-project`   | Valid authoritative chapter plus a newer, tracked manual history snapshot offered for recovery. |

Use `copyFixture` from `tests/helpers/fixture-projects.ts` instead of modifying a
canonical fixture. It recursively copies a named fixture to a unique temporary
directory and returns its project path plus an idempotent cleanup function. The
fixture validation tests open every intended-valid copy through the production
project loader, check the intentional invalid error, exercise recovery scanning,
verify Unicode bytes survive copying and confirm recovery history remains tracked
and unignored.

## Project migration regression tests (#111)

The canonical fixtures remain version 1 and also serve as historical migration
inputs. `packages/core/test/project-migration.test.ts` copies these real projects,
checks manuscript/backup bytes, and injects failures and child-process termination
at each journal/commit boundary. It also tests interruption during recovery itself,
malformed/newer versions, corrupt copies, path conflicts and subsequent edits.
Child processes use the built core entry; run `pnpm build` before invoking Vitest
directly. Desktop tests verify migration-before-open and recovery-before-scan.
See [format and recovery guarantees](../docs/project-format.md).

## Autosave and recovery audit (#44)

| Requirement                              | Executable evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debounce, retries and dirty-state races  | `packages/core/test/autosave.test.ts` uses fake timers for idle deadlines, in-flight edits, failed/rejected saves, concurrent flush failure and retry of the latest revision. `apps/desktop/test/document-state.test.ts` checks captured revisions and stale acknowledgements.                                                                                                                                                                                                                                    |
| Failed writes preserve the previous file | `packages/core/test/chapter-saving.test.ts` injects atomic replacement failure, checks unchanged file bytes, and retries successfully. `packages/core/test/recovery.test.ts` covers failed snapshot/replacement operations.                                                                                                                                                                                                                                                                                       |
| Safe chapter switch and shutdown         | `apps/desktop/test/project-workflows.test.ts` exercises failed switches, immediate edits, close-triggered flush and retry. `apps/desktop/test/recovery-lifecycle.test.ts` checks clean-marker gating.                                                                                                                                                                                                                                                                                                             |
| History and newer recovery candidates    | `packages/core/test/history.test.ts` verifies snapshot suppression, failure and retention; `apps/desktop/test/history-runtime.test.ts` verifies serialized interval scheduling, current saved content, failure isolation and timer cleanup. `apps/desktop/test/chapter-persistence-ipc.test.ts` verifies runtime retention and successful-save snapshots. `packages/core/test/recovery.test.ts` tests newer temporary/history candidates, timestamp boundaries, stale candidates and explicit recovery decisions. |

These are deterministic unit and filesystem integration checks. Native Electron
end-to-end testing and forced-process/platform shutdown validation remain separate
work; this audit does not claim those have been performed.

## Global error handling

Issue #49's failure tests cover the renderer and main-process boundaries:

| Requirement                            | Executable evidence                                                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main failures are logged and visible   | `apps/desktop/test/file-logger.test.ts` verifies sanitized uncaught-error records; `recovery-lifecycle.test.ts` verifies the native message, failure exit code and unchanged clean-session marker.        |
| Renderer failures show a useful screen | `apps/desktop/test/renderer-error-boundary.test.ts` injects render failures and checks the fallback and retry flow.                                                                                       |
| Dirty and on-disk content is preserved | The boundary test keeps synthetic dirty state above the failed subtree, restores it on retry and verifies that a copied fixture chapter remains byte-for-byte unchanged.                                  |
| Renderer reports remain sanitized      | The boundary sends only the error name; `renderer-error-ipc.test.ts` verifies sender authorization and rejects raw messages, extra payload fields, oversized values and untrusted frames without logging. |

## Shared book rendering (#121)

`packages/renderer/test/render.test.ts` validates every current node/mark against
an exact XHTML golden, strict XML parsing and independent exact reading-text
extraction. `packages/core/test/book-assembly.test.ts` checks canonical ordering,
writer-lock exclusion, changed-source detection, recovery refusal and validated
captured image bytes. Desktop workflow/IPC tests exercise save-before-preview,
failed-save cancellation and authorization. The `shared book preview` Electron
scenario verifies sandbox/CSP behavior, absent privileged globals, inaccessible
parent document, inert links, controlled images and no remote requests. See
[rendering evidence](../docs/book-rendering-acceptance.md).

## Coverage

Open `coverage/index.html` for the HTML report or use `coverage/lcov.info` with CI
reporting tools. A text summary is printed to the terminal. Coverage includes
Community package/application `src` TypeScript files, including untested files,
and excludes declarations and test files. Build output and the smoke consumer
are outside the coverage source patterns. Reports are ignored by Git.

The shared entry is currently empty, so the initial report has no executable
statements. A displayed 100% for zero statements is not application coverage.
Coverage thresholds should be set when application behaviour exists.

## Workspace smoke check

Run `pnpm check:workspace` from the repository root. It builds the workspace and
executes a separate TypeScript consumer of `@drelwick/shared` through Node.
A zero exit code verifies that the local `workspace:*` dependency resolves during
compilation and at runtime. A missing package, declaration or JavaScript entry
point fails the command.

This smoke consumer is bootstrap validation, not application behaviour testing.
