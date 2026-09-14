# BookEditor

A planned cross-platform, local-first, open-core desktop editor for writing, organising and publishing books, built around a local, open project format.

The repository contains design documents and a minimal pnpm/TypeScript workspace. The first planned release focuses on reliable manuscript editing, autosave and recovery; EPUB and print PDF publishing follow in later releases.

Start with the [documentation index](docs/README.md) for the design, technical specification and build plans.

Development is private. AGPLv3 is a candidate Community licence, not a final licensing decision. External contribution terms are not yet approved. Community will build independently of the eventual private Pro product; basic authoring and publishing belong in Community.

See the [development workflow](docs/development.md), [repository audit](docs/planning/repository-audit.md) and [GitHub tracking register](docs/planning/github-tracking.md). There is no runnable application yet.

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
pnpm test:coverage
```

Alternatively, replace `pnpm` in these commands with
`npm exec --yes --package=pnpm@10.34.5 -- pnpm` to avoid a global installation.
Use `pnpm install --frozen-lockfile` to reproduce the committed dependency graph.

`build` compiles packages in dependency order and emits JavaScript and declarations
to each package's `dist/`. `typecheck` first builds the workspace so package
declarations exist even on a fresh checkout, then runs each package's no-emit
check. `check:workspace` builds and runs the separate smoke consumer, verifying
that workspace imports resolve in both TypeScript and Node. These commands work
without a Pro checkout or proprietary dependencies.

## Workspace layout

- `apps/`: future desktop application workspaces; currently documentation only.
- `packages/shared/`: empty Community package entry point for future shared types.
- `tests/workspace-smoke/`: private consumer of the shared package for bootstrap validation.
- `docs/`: product design, architecture and delivery plans.
- `scripts/`: location for future development helpers.

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
New PR commits cancel obsolete runs. E2E tests and platform packaging will be
added with their implementation issues.

Branch protection requires the GitHub Actions check named `Quality checks`
and an up-to-date branch, including for administrators. Keep that required name aligned with the workflow job
when editing CI. The first `main` run occurs after this workflow is merged.

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
