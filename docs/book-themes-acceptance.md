# Issue #122 acceptance evidence

Starting state: clean `main` at `f10ff6f` (merged #121 / PR #189). Implementation
branch: `feature/122-local-book-themes`. Product classification: CORE Community.
One focused PR; review and merge remain separate human actions.

## Dependency verification

PR #189 is merged at `f10ff6f45352cd1a880d4dad51eb50faaffb3308`. Actual code supplies
locked assembly, a path-free `BookRevision`, ordered semantic chapter fragments,
typed diagnostics, controlled asset/link resolvers, deterministic XHTML serialization
and a passive sandboxed preview. The existing chapter/body/title, epigraph, scene
break and image hooks are sufficient: no semantic traversal changes were needed.
Theme generation attaches at the documented wrapper/style seam.

## Evidence key

- **M**: `packages/project-model/src/book-theme.ts`, shared `theme-contracts.ts`;
  schema/type validation and hostile-value tests in renderer `themes.test.ts`.
- **T**: `packages/renderer/src/themes.ts`; `packages/renderer/test/themes.test.ts`
  and all six `test/golden/*-{ebook,print}.css` fixtures. The same #121 manuscript
  fixture includes all nodes/marks; `render.test.ts` retains exact source-text coverage.
- **P**: `packages/core/src/book-presentation.ts`, `book-assembly.ts`, archive root
  inclusion; `packages/core/test/book-presentation.test.ts` (old/default/migration,
  switch/reopen/backup, unknown IDs, atomic failure, lock/recovery, external changes,
  linked paths and unchanged chapter bytes).
- **I**: shared request schemas, restricted preload, `main/ipc/project-handlers.ts`;
  `apps/desktop/test/image-assets-ipc.test.ts` and `preload.test.ts`. Cached restyling
  retains the exact original markup even after a different revision reaches disk.
- **U**: `App.tsx`, `BookThemeSelector.tsx`, `BookPreviewDialog.tsx`, WorkspaceLayout;
  `project-workflows.test.ts` checks selection, fallback notice, failed persistence,
  no theme-induced save, identical editor semantics and preview reuse.
- **S**: `main/book-preview.ts`; `book-theme-preview.test.ts` verifies exact CSS hash,
  passive content and restrictive CSP. Existing semantic/security tests remain intact.
- **E**: native Electron tests in `tests/e2e/desktop.spec.ts`: “Community themes
  switch offline without rewriting prose and survive restart” and “shared book
  preview saves pending prose and isolates active content, assets and privileges”.
  Networking is unavailable, every preset is switched, generic-only fonts are
  exercised, exact markup/text/chapter bytes compared and the app restarted.
  Injected unapproved CSS/style attributes/scripts/resources are blocked.
- **W**: Community workspace build and `tests/workspace-smoke/src/index.ts` execute
  semantic rendering and theme generation under plain Node with no Pro/Electron.

## Acceptance audit

Each PASS references implementation and executed tests, not documentation alone.
Scope exclusions additionally received a full diff review.

| #   | Criterion                               | Result | Implementation and test evidence                                                                               |
| --- | --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | Typed theme model                       | PASS   | M, inferred `BookTheme`; strict typecheck and validation tests                                                 |
| 2   | Explicit version                        | PASS   | M, literal schemaVersion 1; version 2 rejected                                                                 |
| 3   | Stable canonical IDs                    | PASS   | M/T, finite ID schema and catalogue; persistence round trip P                                                  |
| 4   | Strict definitions                      | PASS   | M/T, strict nested schemas; invalid fields/ranges/overrides rejected                                           |
| 5   | Typography                              | PASS   | T, fixed font tokens/size/leading/paragraph treatment; six goldens                                             |
| 6   | Chapter openings                        | PASS   | T, `.chapter-title` rules; goldens and computed appearance E                                                   |
| 7   | Quotes                                  | PASS   | T, native blockquote rules; shared fixture/goldens                                                             |
| 8   | Epigraphs                               | PASS   | T, `.epigraph`/figcaption rules; shared fixture/goldens                                                        |
| 9   | Scene breaks                            | PASS   | T, semantic hr with empty decorative CSS; goldens/no generated prose test                                      |
| 10  | Small Community preset set              | PASS   | T, exactly Classic/Modern/Literary; U/E selection and W                                                        |
| 11  | Meaningfully distinct                   | PASS   | T, per-role distinctness assertions and six goldens; E screenshots                                             |
| 12  | Safe fonts/assets                       | PASS   | T, constant local/generic chains and empty assets; E offline                                                   |
| 13  | Required attribution                    | PASS   | No files redistributed; T asserts no assets/font-face; dependency/diff review confirms no font addition        |
| 14  | Missing fonts fallback offline          | PASS   | T generic-only policy; E renders generic serif visibly with networking unavailable                             |
| 15  | No remote fonts                         | PASS   | T no font-face/URL, S font-src none, E no requests                                                             |
| 16  | No remote theme resources               | PASS   | T empty resources/no URLs/imports; E offline and rejected hostile resource probes                              |
| 17  | Selection persists                      | PASS   | P atomic sidecar save/reopen; E restart                                                                        |
| 18  | Separate from manuscript                | PASS   | P independently versioned sidecar; byte-identical chapter and semantic revision tests                          |
| 19  | Switching preserves prose               | PASS   | T exact markup/text, P chapter bytes, U no save, E byte equality                                               |
| 20  | Older projects safe                     | PASS   | P absent/default before and after existing migration without chapter writes                                    |
| 21  | Unknown saved ID safe                   | PASS   | T deterministic resolver; P retains unavailable ID; U notice                                                   |
| 22  | Ebook overrides                         | PASS   | M/T typed relative overrides; ebook goldens                                                                    |
| 23  | Print overrides                         | PASS   | M/T point size/leading overrides; print goldens                                                                |
| 24  | No target prose duplication             | PASS   | T no manuscript parameter; same fixture/markup comparisons for both targets                                    |
| 25  | No target semantic renderer duplication | PASS   | T separate style generator; shared renderBook goldens, I cached markup reuse                                   |
| 26  | Uses #121 hooks                         | PASS   | T selectors and semantic fixture; S/E applied styles                                                           |
| 27  | No semantic traversal in themes         | PASS   | T function accepts only validated presentation and target; W independent generation                            |
| 28  | No arbitrary CSS                        | PASS   | M strict schema, finite tokens/numbers; T hostile CSS rejected; I extra css key rejected                       |
| 29  | No active theme content                 | PASS   | M/T hostile strings rejected; S hashes only generated CSS; E injected content blocked                          |
| 30  | No arbitrary paths                      | PASS   | M/T no path fields/hostile font tokens; I accepts only IDs                                                     |
| 31  | No path traversal                       | PASS   | T slug/font validation, I malformed IDs, P linked project rejected                                             |
| 32  | Deterministic styles                    | PASS   | T repeated results and six checked-in byte goldens                                                             |
| 33  | Golden fixtures every preset            | PASS   | T three presets × two targets with same semantic fixture                                                       |
| 34  | Preservation tested                     | PASS   | T/P/U/E exact semantics, markup and bytes                                                                      |
| 35  | Invalid settings tested                 | PASS   | M/T versions, required/extra fields, enums, ranges, active strings and overrides; P invalid disk configuration |
| 36  | Missing font tested                     | PASS   | T generic-only output, E visible generic-font manuscript                                                       |
| 37  | Offline tested                          | PASS   | T throwing network stub, E offline context/no requests                                                         |
| 38  | Desktop selector                        | PASS   | U labelled native select, keyboard/focus/selected value; E design-panel and dialog use                         |
| 39  | Selection survives restart              | PASS   | P reopen and portable restore; E Electron restart retains Literary                                             |
| 40  | Preview isolated                        | PASS   | S exact hash/no unsafe-inline; E Node/process/preload/IPC unavailable and parent access blocked                |
| 41  | #124 remains separate                   | PASS   | U captured saved dialog only; E unchanged semantic snapshot; diff has no full reflowable reader                |
| 42  | #126 remains separate                   | PASS   | T CSS/empty asset descriptors only; W plain-node styles; no EPUB package changes                               |
| 43  | #128/#129 remain separate               | PASS   | M bounded typography only; T no @page rules; no physical layout/pagination/PDF code                            |
| 44  | #133 remains separate                   | PASS   | M built-in IDs only, T arbitrary CSS/font fields rejected, I extra input rejection                             |
| 45  | #136 remains separate                   | PASS   | M ordinary-novel size bounds; T three presets and no large-print profile/export validation                     |
| 46  | Independent Community                   | PASS   | W build/smoke; E offline app; no Pro/private package added                                                     |

## Review corrections

- Electron byte-preservation testing found preview editability toggles emitting
  false editor changes. Using TipTap's `emitUpdate: false` keeps preview and theme
  changes from manufacturing saves; actual dirty edits are still flushed/tested.
- Added presentation to the archive allowlist so selection travels with the book.
- Cleared cached preview on project activation/close, reject stale revision requests,
  and reset theme UI for both project identity and path changes.
- Retain committed-selection success with a warning on lock cleanup failure;
  retain prior settings on atomic rename failure and preserve recovery evidence.
- Preview permits only the generated stylesheet hash, not all inline styles.
  Native tests also inject unauthorized styles and remote CSS to verify the boundary.
- Removed obsolete wrapper code and replaced active Book design mock labels.

## Intentional limits

No fonts are bundled; glyph metrics may differ across systems. No custom themes,
font embedding, EPUB packages, full ebook reader, physical print settings,
pagination/PDF or large-print export-validation profile is included. Malformed
presentation/recovery evidence requires resolving the existing file condition;
it is never silently repaired. These are documented boundaries, not incomplete
#122 features.

## Executed repository checks

Executed on Windows with the repository-pinned toolchain, 2026-09-25:

| Command                                                                    | Final result                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                           | PASS (before work and after workspace dependency lock update)                 |
| `pnpm lint`                                                                | PASS                                                                          |
| `pnpm format:check`                                                        | PASS                                                                          |
| `pnpm typecheck`                                                           | PASS, including strict test TypeScript                                        |
| `pnpm test`                                                                | PASS, 71 files / 896 tests                                                    |
| `pnpm build`                                                               | PASS                                                                          |
| `pnpm check:workspace`                                                     | PASS, plain Node semantic rendering and themes                                |
| `pnpm test:coverage`                                                       | PASS, 896 tests; theme generator and presentation persistence both 100% lines |
| `pnpm test:e2e`                                                            | PASS, all 12 native Electron scenarios                                        |
| `pnpm exec playwright test --grep 'Community themes\|shared book preview'` | PASS, 2 focused scenarios after final contract review                         |
| `git diff --check`                                                         | PASS                                                                          |

Focused integration command also passed (111 tests before the final added
external-presentation-change test, which is covered by the full runs):

```sh
pnpm exec vitest run packages/renderer/test/themes.test.ts packages/core/test/book-presentation.test.ts apps/desktop/test/book-theme-preview.test.ts apps/desktop/test/image-assets-ipc.test.ts apps/desktop/test/project-workflows.test.ts apps/desktop/test/preload.test.ts
```

Intermediate failures were corrected before these results: incomplete preload/IPC
typing during wiring; an E2E import outside a workspace package; Vite's dynamic URL
handling in the initial golden reader; effect/finally lint rules; mock rail labels;
and preview's false edit notifications exposed by exact-byte tests. No tests or
security settings were weakened. Builds retain Vite's existing bundle-size warning.
Native Electron execution was on Windows; macOS/Linux were not available here.

Synthetic screenshots: [Classic](screenshots/book-theme-classic.png),
[Modern](screenshots/book-theme-modern.png), [Literary](screenshots/book-theme-literary.png).
