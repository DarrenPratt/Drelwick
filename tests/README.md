# Testing

From the repository root:

```sh
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm test --project @bookeditor/shared
pnpm typecheck
```

`test` and `test:coverage` build workspace dependencies before running Vitest once
and return a nonzero exit code on failure. They do not enter watch mode, so CI can
use them directly. `test:watch` builds once before watching test/source changes;
rebuild dependencies if you change a package consumed through its `dist` exports.
The root README documents the pinned pnpm wrapper if pnpm is not installed globally.

Vitest and its V8 coverage provider are both pinned to 4.1.11, which passes this
repository's TypeScript 5.9 strict checks without suppressing declaration errors.
Node.js types match the supported Node 24 runtime. Tests explicitly import
`test` and `expect` from `vitest`; no test globals are added to production projects.

## Workspace conventions

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

The two initial tests verify loading the shared TypeScript entry and resolving
the built workspace dependency through its separate consumer. They validate the
test infrastructure; application behaviour tests arrive with their issues.

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
executes a separate TypeScript consumer of `@bookeditor/shared` through Node.
A zero exit code verifies that the local `workspace:*` dependency resolves during
compilation and at runtime. A missing package, declaration or JavaScript entry
point fails the command.

This smoke consumer is bootstrap validation, not application behaviour testing.
Manuscript fixtures and other test suites will arrive with their implementation
issues.
