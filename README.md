# Drelwick

A cross-platform, local-first, open-core desktop editor in private development for writing, organising and publishing books, built around a local, open project format.

The repository implements local project/chapter management, manuscript editing,
autosave, retained history snapshots and crash recovery. v0.1 testing, hardening
and release validation remain open. Community DOCX, TXT, Markdown and HTML parsers,
staged import API and author-facing review workflow are implemented. A shared semantic
renderer, isolated saved-book preview and three persisted [Community book themes](docs/book-themes.md)
are available; local EPUB export, [PDF-backed print preview](docs/print-preview.md)
and [atomic PDF export with basic preflight](docs/print-export.md) are implemented.
See the PDF review record for validation and platform limitations. See the [DOCX support matrix](docs/docx-import.md),
[TXT/Markdown/HTML support matrix](docs/text-import.md) and
[local publishing delivery plan](docs/planning/local-publishing-plan.md).

Basic DOCX import and [editable DOCX export](docs/docx-export.md) are built-in Community capabilities.
The delivery roadmap is a local desktop workflow with no account or hosted
conversion requirement. Optional backup to user-owned storage such as Google
Drive, Wasabi or Git repositories is research only; cloud editing and collaboration are outside
the current roadmap.

Start with the [documentation index](docs/README.md) for the design, technical specification and build plans.

Development is private. The owner-selected Community licence is GNU Affero General
Public License v3 only (`AGPL-3.0-only`); see [LICENSE](LICENSE) and
[copyright and third-party notices](COPYRIGHT.md). Legal review and final approval
under [#53](https://github.com/DarrenPratt/Drelwick/issues/53) remain pending.
Copyright © 2026 Darren Pratt and Drelwick contributors.
See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[contributor strategy](docs/contributor-copyright-strategy.md). External
contributions remain blocked until #54 and the Licensing & Commercial Architecture
milestone are complete. Community will build independently of the eventual private
Pro product; basic authoring and publishing belong in Community. Pro is not
currently available. Implemented local authoring/import/preview/backup workflows
need no Drelwick account, backend or Pro checkout. Editable DOCX export is available through **Export → Export DOCX**. EPUB export is
available through **Export → Export EPUB**, and PDF through **Export → Print PDF / preflight**.

Local standalone packaging is configured through [Electron Builder](docs/desktop-packaging.md),
but unsigned artifacts are validation outputs, not official releases. The development
setup below still builds from source; Windows runtime tests and the configured Linux CI smoke test
do not establish cross-platform packaged release validation. Follow the
[release evidence register](docs/planning/public-release-checklist.md) for current
blockers. Preparation does not authorise publication.

Read the [Code of Conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md).
Never report vulnerabilities in ordinary issues or PRs. Public security/conduct
contact activation remains pending; the policies describe the current private
handoff and do not advertise untested addresses.

The [public project specification](docs/project-format-specification.md) explains
the implemented local format and independent recovery. The
[Community extension architecture](docs/extension-architecture.md) is a design;
its public SDK and runtime are not yet available. Built-in workflows do not
depend on that future runtime.

The [proposed branding and distribution policy](docs/branding-distribution-policy.md)
separates source-code rights from names, logos and official-release status.
Trademark/artwork legal review and reuse permissions remain pending; this draft
does not authorise public release.

See the [development workflow](docs/development.md), [repository audit](docs/planning/repository-audit.md) and [GitHub tracking register](docs/planning/github-tracking.md).

The desktop shell supports creating a project through **New project**. Enter the
book title, author and language, then choose an empty folder. Successful creation
opens an empty project workspace. **Open project** on the welcome screen or
workspace uses native folder selection to load an existing project. Cancellation
or failure keeps the current workspace unchanged. Select a chapter to edit its
content. Changes autosave after 750 ms of idle typing; **Save chapter** saves
immediately. **File → Save**, **Ctrl+S** (Windows/Linux) and **Cmd+S** (macOS)
also save the active chapter immediately. **Unsaved changes** tracks edits, including those made during a save.
Focus loss and attempts to leave the document flush pending edits. If switching
or closing is blocked for saving, wait for **All changes saved** and retry the
action. Failed saves retain edits and report an error. Startup scans for
recoverable data after an unclean shutdown and offers **Recover**, **Discard**
or **Cancel startup** before editing. See [manuscript recovery](docs/manuscript-recovery.md),
[chapter persistence](docs/chapter-persistence.md),
[project creation UI](docs/project-creation-ui.md) and
[project opening UI](docs/project-open-ui.md).

Use **Canon & research** to manage local canon facts and research/general notes.
Both forms autosave, retain failed drafts and keep private reference content out
of manuscript exports. See [canon and research workflows](docs/canon-research.md).

Use **Book design → Print settings** to save local trim size, mirrored margins,
gutter, chapter starts, headers and page numbers. See [Community print settings](docs/print-settings.md).
Select **Standard print** or **Large print** there to retain independent typography
and layout for the same manuscript. EPUB keeps its own theme. See
[large-print editions and preset limitations](docs/large-print-edition.md).
Use **Book preview → Print preview** for local pagination and facing pages drawn
from the production PDF. **Export PDF** saves that exact revision after basic
preflight and destination review; see [PDF export validation](docs/print-export.md).

Use **Export → Export DOCX** to save an editable Word manuscript locally. Pending
edits must save successfully first. Review fidelity warnings and choose a native
destination; replacing an existing file requires confirmation. This is manuscript
interchange, not exact Word page layout. See the [export support matrix](docs/docx-export.md).

Use **Import manuscript** on the welcome screen/workspace or in the File menu to
inspect DOCX, TXT, Markdown or HTML, adjust chapter boundaries and explicitly approve conversion
warnings before choosing a new empty destination. The source stays unchanged.
The committed project is validated before opening; failed saves and failed imports
preserve the current manuscript. See the [import review workflow](docs/import-review-ui.md).

The **Book preview** panel opens a local reflowable ebook simulation, including
visible front matter, chapters, back matter and managed images in the selected
theme. Contents links navigate the book. Viewport, orientation, font size and
light/dark controls affect only the simulation. **Refresh preview** saves pending
edits and captures a coherent new revision; failed refreshes retain the previous
preview and editor. Changed sources are marked stale. See the
[ebook preview guide and acceptance evidence](docs/ebook-preview.md).

Use chapter **Actions** to duplicate, split at the current cursor or change status.
For the selected chapter, **Actions → Chapter History** lists validated local
snapshots and offers read-only preview and explicitly confirmed restore. Current
edits are saved and preserved in a new snapshot before replacement. See
[Chapter History](docs/chapter-history.md); this is separate from startup recovery.
Select two adjacent chapters with the merge checkboxes to merge them in reading
order. Pending edits are saved first; restructuring retains history and uses
recoverable writes. See [chapter organisation](docs/chapter-organisation.md).

Use **Edit → Find and replace** (**Ctrl+F / Cmd+F**) to search the live chapter or
whole manuscript. Replace One uses editor undo; Replace All requires an explicit
scope/count review, flushes pending edits and keeps pre-operation history with
recoverable multi-chapter writes. See [search semantics and recovery](docs/manuscript-search.md).

The welcome screen and workspace also list **Recent projects**. Select a title
to reopen it or **Remove** to forget the entry without deleting the project.
The list persists in application settings across restarts; project files remain
portable. See [recent project tracking](docs/recent-projects.md).

Use **File → Back Up Project** to create a checksummed ZIP copy, optionally
including version history, or **File → Restore Project Backup** to restore into
a separate new project folder. Pending edits are saved first; backups remain
copies while the project files stay authoritative. See
[portable project backups](docs/project-backups.md).

New projects use format version 2. Opening a version-1 project first creates and
verifies a complete local recovery copy, stages the format upgrade and commits it
through a recoverable journal. Manuscript files remain byte-identical. Newer
unsupported formats are rejected without rewriting them. See
[project formats and migration recovery](docs/project-format.md).
The [public project format specification](docs/project-format-specification.md)
documents the implemented files, a synthetic example and recovery with ordinary
JSON/ZIP tools, without installing Drelwick.

Use **Spelling** above the chapter to select English (US/UK), check the current
text, review suggestions and manage a persistent local personal dictionary.
Only an explicit replacement changes prose, through ordinary undo and autosave.
Resources are bundled; no text goes online and no dictionaries are downloaded.
See [offline spelling and its acceptance evidence](docs/offline-spelling.md).

## Development setup

Use Node.js 24.x and pnpm 10.34.5. The root manifest pins pnpm and TypeScript
5.9.3; commit changes to `pnpm-lock.yaml` when dependencies change. All packages
are private during development.

Install the pinned package manager if it is not already available:

```sh
npm install --global pnpm@10.34.5
```

From the repository root:

```sh
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm check:workspace
pnpm test
pnpm test:e2e
pnpm test:coverage
```

Alternatively, replace `pnpm` in these commands with
`npm exec --yes --package=pnpm@10.34.5 -- pnpm` to avoid a global installation.
Use `pnpm install --frozen-lockfile` to reproduce the committed dependency graph.

After `pnpm build`, run `pnpm --filter @drelwick/desktop start`. For renderer
development use `pnpm --filter @drelwick/desktop dev` after the workspace build.

`build` compiles packages in dependency order and emits JavaScript and declarations
to each package's `dist/`. `typecheck` first builds the workspace so package
declarations exist even on a fresh checkout, then runs each package's no-emit
check. `check:workspace` builds and runs the separate smoke consumer, verifying
that workspace imports resolve in both TypeScript and Node. These commands work
without a Pro checkout or proprietary dependencies.

## Workspace layout

- `apps/desktop/`: Electron adapters, restricted preload and React/TipTap application.
- `packages/core/`: local project operations, import, backup, recovery and book assembly.
- `packages/project-model/`: versioned persistent schemas and semantic validation.
- `packages/renderer/`: semantic XHTML rendering, diagnostics and Community themes.
- `packages/shared/`: renderer-safe contracts, IPC DTOs and shared primitives.
- `tests/workspace-smoke/`: private consumer of Community package exports.
- `docs/`: product design, architecture and delivery plans.
- `scripts/`: build helpers and Community dependency-boundary enforcement.

All current workspaces belong to Community. `pnpm check:architecture` checks the
reviewed package inventory and rejects dependencies on Pro; `check:workspace`
runs it in CI. See the [actual package graph and Community/Pro boundary](docs/technical-spec.md#31-community--pro-dependency-boundary)
for existing interfaces, future publishing packages and independent verification.

Workspace packages extend `tsconfig.base.json` and define their own `src/` and
`dist/` directories. Use ESM imports and `workspace:*` for local dependencies;
package exports point to built JavaScript and declarations. This uses pnpm's
[workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace)
to require local resolution. The smoke consumer demonstrates the convention
without adding application APIs.

Unit tests use Vitest 4.1.11 with its matching V8 coverage provider. `pnpm test`
builds the workspace and runs tests once, suitable for CI; `pnpm test:watch`
starts watch mode after the build. `pnpm test:coverage` writes text, HTML and LCOV
reports. See [test setup and conventions](tests/README.md) for workspace discovery,
filtering and report locations. `pnpm typecheck` also checks test files and Vitest
configuration using the shared strict settings.

The shared TypeScript configuration enables `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride` and `useUnknownInCatchVariables`.
Every workspace project must extend it without disabling these checks. Handle
possibly missing indexed values, omit absent optional properties (or explicitly
allow `undefined` in their types), mark overridden members with `override`, and
narrow caught errors before accessing their properties.

The existing ignore rules cover dependencies, build output, coverage, local
environment files and TypeScript build caches while retaining workspace source.

## Continuous integration

[CI](.github/workflows/ci.yml) runs on every pull request and push to `main`.
The `Quality checks` job uses Ubuntu and Node.js 24, installs the pnpm version
declared in `package.json`, and runs frozen-lockfile install, lint, format check,
typecheck, unit tests, build and the workspace smoke check. Main and PRs use the
same steps, including documentation-only changes.

The pnpm store is cached using `pnpm-lock.yaml`; dependencies are still installed
on every run. Actions are pinned to commit SHAs, checkout credentials are not
persisted, and the workflow token has only read access to repository contents.
New PR commits cancel obsolete runs. The desktop end-to-end suite is available
through `pnpm test:e2e`; adding it to the hosted workflow remains part of the
separate CI implementation issue. The packaging matrix builds Windows
portable/NSIS, macOS DMG and Linux AppImage/deb artifacts, then inspects and
smoke-launches unpacked applications without publishing. See
[desktop packaging](docs/desktop-packaging.md) for local commands, unsigned-build
behaviour and platform validation limits.

Branch protection requires the GitHub Actions check named `Quality checks`
and an up-to-date branch, including for administrators. Keep that required name
aligned with the workflow job when editing CI. The first `main` run occurs after
this workflow is merged.

## Linting and formatting

Run `pnpm lint` and `pnpm format:check` before opening a PR. Use `pnpm format`
to apply Prettier formatting across source, configuration and documentation.
Git and Prettier both use LF line endings so checks are stable across platforms.

The root ESLint flat config covers JavaScript, TypeScript, JSX and TSX throughout
the workspace, including tests and tooling. It uses recommended JavaScript,
TypeScript, React and React Hooks rules with the modern JSX runtime. TypeScript
checks component props in TSX; JavaScript components retain React prop validation.
ESLint 9 is pinned to match the React plugin's supported peer range. React rule
settings target version 19 until the renderer adds its runtime dependency.
Type-aware checks remain in `pnpm typecheck`; lint needs no prior build.
Node globals are scoped to tooling, tests, main and preload; browser globals are
scoped to renderer sources. Shared source receives no host globals by default.

Both tools exclude dependency stores, `dist`, `build`, `out`, `coverage`,
`generated`, `playwright-report` and `test-results` directories at any depth.
Prettier also excludes the pnpm-managed lockfile and respects `.gitignore`.
Keep the two tools' generated-output exclusions aligned when adding build tools.
Prettier owns formatting; `eslint-config-prettier` disables conflicting lint rules.
