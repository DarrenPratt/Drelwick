# New project dialog

Issue #16 exposes the existing core creation service in the desktop shell. Select
**New project**, enter a book title, author and language (default `en-GB`), and
choose an empty project folder using the native directory picker. The selected
folder itself becomes the project root; no title-derived subfolder is created.
Cancel leaves the current screen unchanged. Cancelling a replacement folder
selection retains the previous selection.

Required fields reject empty or whitespace-only values. Title and author are
limited to 500 characters and language to 100 at both the UI and IPC boundary.
Creation errors appear in the dialog without clearing inputs. Pending operations
disable submission/cancellation and main serializes folder selection and creation.
Success displays the new project's title, author, language, location and empty
manuscript workspace. Chapter editing and opening existing projects are separate
issues.

## Process boundary

The restricted preload exposes `project.selectLocation()` and
`project.create({ title, author, language, locationToken })`. Shared Zod schemas
validate creation requests, and operations return typed success/error results.
The native selection returns a display path and opaque UUID token. Main retains
the actual path, binds its token to the requesting top-level frame, replaces the
grant on a new selection and consumes it after successful creation. Renderer
requests cannot supply arbitrary paths. Closing or replacing the window makes
old frame grants unusable.

Handlers authorize the owning window, top-level frame and exact configured
renderer URL before accepting requests. External navigation and new windows are
blocked. Main calls `createProject` in core and returns a renderer-safe workspace
DTO. Main errors use fixed, actionable messages; raw filesystem errors and author
content are not forwarded or logged. No authoritative format or migration changes
are introduced. Community has no Pro dependency.

## Required preload build correction

The earlier TypeScript-only preload output used ESM imports. Electron's sandboxed
preloads cannot execute ESM or resolve workspace packages through their limited
`require`. To make this UI usable while retaining `sandbox: true`,
`contextIsolation: true` and `nodeIntegration: false`, Vite now bundles the preload
as `dist/preload/preload.cjs`, leaving only `electron` external. Source files
remain ESM TypeScript. See [Electron ESM support](https://www.electronjs.org/docs/latest/tutorial/esm)
and [sandbox preload restrictions](https://www.electronjs.org/docs/latest/tutorial/sandbox).
Renderer asset URLs are relative so the built UI works from `file://`.

The development command builds first and watches preload bundling alongside the
renderer and main compilation. Restart Electron after changing main/preload code.

## Validation

Vitest tests exercise form validation, picker cancellation, retry after failure,
duplicate submission prevention and successful workspace transition in jsdom.
The native dialog methods are stubbed; jsdom does not implement modal focus or
layout. Main tests validate native picker options, frame authorization, grant
handling, safe errors and actual core file creation. A built-preload test runs
the bundle with only the sandbox's restricted Electron import available.

For an interactive check, build the workspace, start the desktop app, create a
project in an empty temporary folder, and verify the workspace and `project.json`
and `book.json`. Repeat with missing fields, cancelled selection and a non-empty
folder. Keep synthetic metadata in test projects.
