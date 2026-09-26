# Local reflowable ebook preview

Issue #124 is CORE and works offline without accounts, services or Pro. Open
**Book preview** to view the assembled ebook. The preview is labelled a simulation:
Chromium reflow is not a promise of Kindle, Kobo, Apple Books or other reader
behaviour. EPUB packaging/export (#126), print/PDF, custom themes and reader-engine
emulation are outside this feature.

## Dependencies verified against code

- #121 / merged PR #189: `assembleBook` captures all documents and validated image
  bytes under the existing project lock, rechecks sources and returns a semantic
  revision. `renderBook` is the sole semantic serializer. The existing preview
  wrapper, restricted IPC, autosave flush and sandbox are reused.
- #122 / merged PR #190: `presentation.json`, atomic theme selection,
  `resolveBookTheme`, `getBookTheme` and `generateThemeStyles(theme, "ebook")` are
  implemented, with three validated presets, CSS goldens and offline font fallbacks.
- #123 / merged PR #191: `publication.json`, metadata/matter editing, inclusion
  flags, ordered front/body/back assembly and managed covers are implemented.
  The renderer filters ebook visibility independently of navigation membership.

The branch is based on `4d76bfc`, which includes these implementations. Existing
core/renderer dependency tests and the new complete-book adapter/native fixtures
exercise their actual behaviour, including authoring-file preservation.

## Architecture and revision policy

```text
existing autosave flush and dirty/in-flight check
  -> consistent project revision (shared project-operation lock)
  -> shared book assembly (cover, front matter, canonical body, back matter)
  -> shared semantic renderer (ebook inclusion, inert author links, captured assets)
  -> selected theme + ebook overrides + bounded reader simulation CSS
  -> passive, isolated iframe
```

The UI never traverses manuscript nodes, reconstructs filename order or inspects
the iframe DOM. The main adapter derives Contents from the rendered publication
sections and their navigation flags. Navigation-disabled sections remain in
reading order; ebook-hidden sections appear in neither content nor Contents.
Trusted Contents links use `about:srcdoc#<renderer-anchor>` so their base cannot
resolve to the application file. Author-supplied links remain inert text.

Opening and **Refresh preview** use the same existing `previewBook` workflow:
freeze editing, flush the autosave coordinator, refuse dirty/in-flight failures,
then assemble and render a complete new snapshot. The prepared cache is replaced
only after presentation succeeds. No changed chapter is patched into an older
snapshot. Failed saves, invalid themes, assembly failures and rendering failures
retain the previous displayed preview and editor; fixed error messages are shown
inside the dialog. Missing/invalid images produce explicit diagnostics and an
incomplete preview rather than a successful blank output.

While open, a read-only currency check runs every five seconds and on window focus.
It uses coherent assembly to compare the semantic revision and saved theme ID;
it does not replace or render the displayed book. Dirty editor state reuses the
existing dirty flag. Changed sources show **Stale preview**; a failed check shows
that currency could not be verified. These are periodic checks, not filesystem
transactions against external tools. Refresh remains explicit. A foreground refresh,
simulation or theme action waits for an in-flight currency check before using the
existing operation gate. Closing the dialog cancels UI subscriptions and ignores
late replies; a check already running is allowed to release its lock normally.

The main process retains one prepared preview. The new `book:preview-simulate`
operation validates project UUID, captured revision and bounded font/colour values,
then restyles the same captured markup and bytes. `book:preview-status` accepts
only project UUID and revision. Both authorize the active main frame/project;
neither accepts paths, HTML, CSS, URLs or arbitrary IPC channels. A replaced or
invalidated cache rejects the old revision. Async UI responses from an obsolete
request are ignored. No new project schema, migration or dirty-state mechanism is
introduced.

## Controls

| Control      | Behaviour                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Viewport     | Phone 390 × 844, Reader 600 × 800, Tablet 768 × 1024 CSS pixels; custom dimensions bounded to 240–1600 |
| Orientation  | Swaps simulated width and height; does not rotate or rewrite content                                   |
| Font size    | 12, 16, 20, 24 or 32 px root size, retaining the theme's relative typography                           |
| Presentation | Light or dark foreground/background override; readers can choose their own colour mode on export       |
| Contents     | Local chapter/matter anchors derived from visible assembled navigation entries                         |
| Refresh      | Flush pending edits and capture a coherent new revision; retain simulation settings                    |

The stage scrolls when the simulated device exceeds the available workspace; the
iframe keeps the specified CSS-pixel dimensions. Reader controls live only in
dialog state and reset on closing. They do not write manuscript, metadata or theme
files. The existing, separately labelled **Book theme** selector still explicitly
saves the author's selected theme; it is outside the reader simulation fieldset.

## Isolation and failure boundaries

The iframe retains `sandbox=""` and `referrerPolicy="no-referrer"`. Scripts,
same-origin access, forms, popups and privileged preload access remain unavailable.
The main window retains `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true` and disabled webviews. No Electron security configuration changed.

CSP permits only the exact generated stylesheet by SHA-256 hash and embedded
PNG/JPEG images from the existing captured/validated asset mechanism. Scripts,
inline event handlers/style attributes, network connections, fonts, remote styles,
frames, objects and base elements are blocked. No arbitrary local paths or
`file://` resources are exposed. Manuscript, matter and metadata are escaped by
the shared serializer/wrapper; diagnostics never log author content or payloads.

## Acceptance evidence

| #124 acceptance criterion                                   | Implementation and test evidence                                                                                                                                                                                                                                                                                                               | Result |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Chapters and matter, selected theme, local assets           | `ebook-preview.test.ts`: exact cover/front/body/back section order, independent visibility/navigation, Literary ebook CSS, captured raster, missing/corrupt asset diagnostics and byte-identical source files; existing renderer/core suites cover semantics and all themes                                                                    | PASS   |
| Viewport, font size, orientation, light/dark and navigation | Native `reflowable ebook simulation` test: actual iframe widths, heights and computed styles; all presets/custom dimensions; Contents hash/scroll navigation; unchanged editor/project bytes                                                                                                                                                   | PASS   |
| Simulation disclaimer                                       | Dialog and native assertion explicitly name reader-engine limitations and separate reader settings from book settings                                                                                                                                                                                                                          | PASS   |
| Isolation and no external resources                         | Native `shared book preview` test checks absent Node/process/filesystem/shell/child-process/preload/IPC globals, inaccessible parent, inert manuscript links and decoded local images; injected script/event/style/file/network resources remain blocked. IPC tests reject untrusted frames, foreign projects, paths, CSS and invalid controls | PASS   |
| Explicit consistent refresh and isolated errors             | Native stale/refresh/failure test; workflow save-before-refresh and dirty-preservation tests; IPC captured-revision/cache-failure tests and background-check race regression; existing assembly lock/change/recovery tests                                                                                                                     | PASS   |

`tests/helpers/ebook-project.ts` supplies a synthetic, redistributable book with
all five matter types, independent inclusion settings, multiple body chapters,
hostile-looking metadata, Literary theme and a managed cover. Native tests run
offline, generate visual artifacts for phone/reader/tablet and a custom landscape
dark large-font presentation, and compare persisted bytes. Representative captures
are under `docs/screenshots/ebook-*.png`. Screenshots are review fixtures, not
cross-platform pixel goldens: installed system font metrics vary. Existing exact
semantic/CSS goldens remain in `packages/renderer/test/golden`.

Validation on 26 September 2026 used Node 24.18.0 and pinned pnpm 10.34.5:

| Command                          | Result                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | PASS                                                                                 |
| `pnpm lint`                      | PASS                                                                                 |
| `pnpm format:check`              | PASS                                                                                 |
| `pnpm typecheck`                 | PASS                                                                                 |
| `pnpm test`                      | PASS — 913 tests in 73 files                                                         |
| `pnpm test:coverage`             | PASS — 913 tests; 68.71% statements, 60.49% branches, 70.74% functions, 70.91% lines |
| `pnpm build`                     | PASS                                                                                 |
| `pnpm check:workspace`           | PASS                                                                                 |
| `pnpm test:e2e`                  | PASS — all 14 native Electron scenarios on the final run                             |
| `git diff origin/main --check`   | PASS                                                                                 |

The initial typecheck identified a new test-mock return annotation, corrected before
the passing rerun. The first complete native run passed 13/14: the pre-existing
image-import undo scenario encountered unexpected alt text. Its isolated rerun and
the complete 14-test rerun passed unchanged; no assertion or timeout was weakened.
Native execution was on Windows; macOS/Linux execution is not claimed. No known
#124 acceptance work remains; review and merge are separate.
