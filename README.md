# BookEditor

A planned cross-platform, local-first, open-core desktop editor for writing, organising and publishing books, built around a local, open project format.

The repository contains design documents and a minimal pnpm/TypeScript workspace. The first planned release focuses on reliable manuscript editing, autosave and recovery; EPUB and print PDF publishing follow in later releases.

Start with the [documentation index](docs/README.md) for the design, technical specification and build plans.

Development is private. AGPLv3 is a candidate Community licence, not a final licensing decision. External contribution terms are not yet approved. Community will build independently of the eventual private Pro product; basic authoring and publishing belong in Community.

See the [development workflow](docs/development.md), [repository audit](docs/planning/repository-audit.md) and [GitHub tracking register](docs/planning/github-tracking.md). There is no runnable application or application CI yet.

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
pnpm typecheck
pnpm build
pnpm check:workspace
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

The existing ignore rules cover dependencies, build output, coverage, local
environment files and TypeScript build caches while retaining workspace source.
Lint/format tooling (#4), the unit-test framework (#41), additional strictness
settings (#3) and application CI (#46) remain separate work. Their checks are not
available in this bootstrap.
