# Issue #121 acceptance evidence

Starting state: clean `main`, `73fd419` (PR #188). Implementation branch:
`feature/121-semantic-book-rendering`. CORE Community; one PR; no merge.

## Evidence references

- **R**: `packages/renderer/src/index.ts` and `types.ts`;
  `packages/renderer/test/render.test.ts`, `fixture.ts`, `golden/book.xhtml`.
- **A**: `packages/core/src/book-assembly.ts`;
  `packages/core/test/book-assembly.test.ts`.
- **P**: `apps/desktop/src/main/book-preview.ts`, restricted handler in
  `main/ipc/project-handlers.ts`, shared `BookPreview`/request schema, preload;
  `apps/desktop/test/image-assets-ipc.test.ts` and `preload.test.ts`.
- **W**: `apps/desktop/src/renderer/App.tsx`, `BookPreviewDialog.tsx` and
  `components/WorkspaceLayout.tsx`; `apps/desktop/test/project-workflows.test.ts`.
- **E**: `tests/e2e/desktop.spec.ts`, “shared book preview saves pending prose and
  isolates active content, assets and privileges”, executed in native Electron.
- **S**: `tests/workspace-smoke/src/index.ts` executes the built renderer under
  plain Node, alongside strict workspace build/typechecking.

## Acceptance audit

Each PASS cites implementation and executable evidence, including negative-path
tests. Scope-exclusion rows also rely on inspection of the complete source diff.

| #   | Requirement                      | Status | Implementation and test evidence                                                                                                             |
| --- | -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Explicit typed input             | PASS   | R `BookRevision`; A produces it; R fixtures/S compile and execute against it                                                                 |
| 2   | Consistent revision              | PASS   | A shared writer lock and captured bytes; tests reject concurrent saves and assembly during a partially committed real transaction            |
| 3   | Canonical chapter order          | PASS   | A iterates manifest order; three-chapter fixture differs from filename order                                                                 |
| 4   | Every supported node             | PASS   | R exhaustive dispatch; golden inventory checks all 14 nodes and all six heading levels                                                       |
| 5   | Every supported mark             | PASS   | R six-mark dispatch/order; individual mark and golden tests                                                                                  |
| 6   | Nested/overlapping marks         | PASS   | R balanced per-run serialization; canonical-order, partial-mark, exact-text and strict XML tests                                             |
| 7   | Controlled local assets          | PASS   | A existing checksum/container/full-decoder validation and captured bytes; R typed resolver; E images decode locally                          |
| 8   | Missing-asset diagnostics        | PASS   | A unavailable states, R located placeholders/errors; A removed-record and R repeated-reference tests                                         |
| 9   | Unsupported-content diagnostics  | PASS   | R preflight scanner/schema validation; unknown node/mark and unsupported asset tests; A rejects unsupported disk documents                   |
| 10  | No silent supported content loss | PASS   | R golden and independent exact reading-text comparison, including attribution, breaks and alternatives                                       |
| 11  | Theme separation                 | PASS   | R emits no CSS; no-style assertion and E browser-default semantic preview                                                                    |
| 12  | Output-style separation          | PASS   | R fragments and resolvers, P wrapper; R relative/embedded and package-link tests                                                             |
| 13  | Escaped manuscript text          | PASS   | R XML serializer; metacharacter/script-like/Unicode golden and XML attribute-whitespace tests                                                |
| 14  | No active raw manuscript HTML    | PASS   | R schema dispatch/escaping; golden forbidden-element assertions and E script-like text/injected-active-content probes                        |
| 15  | URL validation                   | PASS   | R shared model link policy; HTTP(S), mailto, fragments and malformed URL cases                                                               |
| 16  | Unsafe schemes inert             | PASS   | R rejects unsafe source/asset links; JavaScript/file/data/custom/protocol-relative tests                                                     |
| 17  | No remote rendering fetch        | PASS   | R pure code, P embedded rasters/CSP; E remote-request interception remains empty                                                             |
| 18  | Privilege-isolated preview       | PASS   | W empty iframe sandbox, existing secure BrowserWindow; E unavailable Node/process/preload/IPC and denied parent document; P rejects subframe |
| 19  | Preview blocks active content    | PASS   | P CSP plus W sandbox; E injected script, event, object and frame probes                                                                      |
| 20  | Safe preview assets              | PASS   | A validated captured bytes, P data-only raster resolver; E decoded images/no project path; P rejects arbitrary-path requests                 |
| 21  | Renderer extension seams         | PASS   | R typed asset/internal-target resolvers and chapter results; target mapping and forward cross-chapter tests                                  |
| 22  | No plugin runtime required       | PASS   | Static R package imports/callbacks; S plain Node execution and full diff inspection                                                          |
| 23  | No Pro requirement               | PASS   | Community-only manifests; S and complete Community build/test execution                                                                      |
| 24  | Community rendering package      | PASS   | `@drelwick/renderer` workspace package; S declaration/runtime resolution                                                                     |
| 25  | Deterministic output             | PASS   | R positional IDs/canonical marks, A content hash; repeated output/revision and reordered-mark tests                                          |
| 26  | Comprehensive golden             | PASS   | R fixture and committed exact XHTML cover every node/mark, heading level and image size                                                      |
| 27  | Escaping tests                   | PASS   | R hostile metacharacters/Unicode/CR/LF/tab and unrepresentable XML tests; E passive script-like text                                         |
| 28  | Missing assets tested            | PASS   | R missing/invalid state and A actual missing record tests; placeholder/error per occurrence                                                  |
| 29  | Deterministic ordering tested    | PASS   | A non-filename manifest order/repeat tests; R nested list and forward-link tests                                                             |
| 30  | Exact text coverage tested       | PASS   | R independent source/DOM traversal without whitespace folding; titles compared separately                                                    |
| 31  | No manuscript logging            | PASS   | R/A/P/W contain no manuscript logging; R unknown/unsafe diagnostics omit private values and resolver exceptions; E has no content execution  |
| 32  | No #122 theme implementation     | PASS   | Diff contains semantic hooks and dialog shell only; R no-style test, E plain preview; mock Book design remains separate                      |
| 33  | No #126 EPUB packaging           | PASS   | R exposes tested package-relative mappings only; S builds without an EPUB package; diff contains no ZIP/OPF/nav implementation               |
| 34  | No #129 print pagination         | PASS   | R fragments only, E plain iframe; diff contains no paginator/PDF generation                                                                  |
| 35  | Independent Community build      | PASS   | S executes pure renderer; repository build/typecheck/test scripts require no Pro checkout                                                    |

## Review corrections

- XML attribute normalization initially threatened exact alternative text.
  Encode CR/LF/tab as character references and test exact round-trip values.
- Reject duplicate chapter identities case-insensitively before emitting anchors.
- Keep descriptor publication after asset record verification; avoid a valid entry
  surviving alongside an invalid entry after a failed capture.
- Native testing found the initial command was inside the collapsed library menu.
  The active Book preview panel now exposes the saved-manuscript command.
- Golden XHTML is excluded from formatting because its exact bytes are the contract.
- The dependency premise was corrected: #113 is assets; migration is #111.

No separate preview/EPUB/print semantic traversal, renderer filesystem access,
theme/target CSS, active manuscript markup, raw filesystem URLs, dynamic loading,
Pro dependency or persistent schema change was found in final source review.

## Boundaries retained

External tools ignoring project locks are outside transactional guarantees; source
rechecks detect ordinary changes. Preview is a captured revision, not a live reader.
Unknown fragment targets warn and retain labels as plain text; blocking diagnostics
must prevent successful export. Memory use scales with the captured manuscript and
images. Native UI/security tests were executed on Windows; macOS/Linux native
execution is not claimed. Themes, publication matter, EPUB packaging and print
pagination remain their own issues.

## Executed checks

Validation completed on Windows with repository-pinned Node/pnpm tooling.

| Exact command                                        | Final result                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                     | PASS, including the updated workspace lockfile                                    |
| `pnpm lint`                                          | PASS                                                                              |
| `pnpm format:check`                                  | PASS                                                                              |
| `pnpm typecheck`                                     | PASS                                                                              |
| `pnpm exec tsc -p tsconfig.test.json`                | PASS, including the final added tests                                             |
| `pnpm test`                                          | PASS: 875 tests, 68 files                                                         |
| `pnpm build`                                         | PASS: all Community packages and desktop                                          |
| `pnpm check:workspace`                               | PASS: built renderer executes in plain Node                                       |
| `pnpm test:coverage`                                 | PASS: 875 tests; semantic renderer 100% lines, 98.54% statements, 93.45% branches |
| `pnpm test:e2e`                                      | PASS: all 11 native Electron scenarios                                            |
| `pnpm exec playwright test -g 'shared book preview'` | PASS: final preview/security scenario and screenshot                              |
| `git diff 73fd419 --check`                           | PASS                                                                              |

Focused runs also passed:

```sh
pnpm exec vitest run packages/renderer/test/render.test.ts packages/core/test/book-assembly.test.ts apps/desktop/test/project-workflows.test.ts apps/desktop/test/image-assets-ipc.test.ts apps/desktop/test/preload.test.ts --update
pnpm exec vitest run packages/renderer/test/render.test.ts --update
pnpm exec vitest run packages/core/test/book-assembly.test.ts packages/renderer/test/render.test.ts apps/desktop/test/project-workflows.test.ts
pnpm exec vitest run packages/renderer/test/render.test.ts apps/desktop/test/project-workflows.test.ts
```

The `--update` runs created/revised the reviewed golden; later full runs compared it
without updating. Initial typecheck failures identified a missing preload mock and
non-iterable DOM typing; lint identified a control-character validation regex;
format checks caught newly edited files; the initial native preview run found the
hidden command. All were corrected and the corresponding commands passed again.
No check was weakened. Existing nonblocking Vite chunk-size and ignored esbuild
install-script warnings remain. Hosted CI status belongs to the PR, not these
local results.
