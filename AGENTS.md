# Drelwick

Drelwick is a cross-platform, local-first book authoring and publishing application.

## Required reading

Before implementing an issue:

1. Read this AGENTS.md.
2. Read the GitHub issue completely.
3. Read the relevant documents under `/docs`.
4. Inspect the existing implementation.
5. Check issue dependencies before starting; verify required dependency issues and PRs are complete.

The repository and GitHub issues are the source of truth for current implementation state.
Planning documents describe intended work, not proof of completed functionality.

Start with [README.md](README.md) and the [documentation index](docs/README.md).
Read the [product design](docs/design.md), [technical specification](docs/technical-spec.md),
[development workflow](docs/development.md), [v0.1 build plan](docs/planning/v0.1-build-plan.md),
[commercial addendum](docs/planning/commercial-architecture-addendum.md) and
[audit reconciliations](docs/planning/repository-audit.md). Use the
[tracking register](docs/planning/github-tracking.md) to map stable plan task IDs
to actual GitHub issue numbers and dependencies.

## Technology

Primary stack:

- Electron
- TypeScript
- React
- TipTap / ProseMirror
- Zod
- Zustand
- pnpm workspaces
- HTML/CSS rendering
- Chromium
- Playwright where appropriate
- EPUB 3

Targets: Windows, macOS and Linux.

Use the tool versions pinned by the repository; see README.md for setup.
Preserve strict TypeScript settings, ESM imports and `workspace:*` dependencies.
Keep platform-independent business logic in `packages/core`, persistent schemas
in `packages/project-model`, and Electron adapters in `apps/desktop`.

## Architecture rules

- Project/manuscript files are the authoritative source.
- EPUB and PDF are generated outputs, never authoritative sources.
- The renderer must not have unrestricted Node.js or filesystem access.
- Electron context isolation must remain enabled; `nodeIntegration` must remain disabled.
- Renderer filesystem operations must go through the restricted preload/IPC API.
- Validate IPC inputs and authorize project/path access in the privileged process.
- Project formats must be schema-versioned; persistence changes must consider migration compatibility.
- Manuscript data must remain recoverable outside the application.
- A database may be a rebuildable cache, never the sole source of manuscript content.
- Do not log manuscript body text or other unnecessary author content, including error payloads.
- Reliability and prevention of data loss take priority over convenience features.

## Product architecture

Drelwick uses an open-core model. Feature classifications are CORE, PRO,
SERVICE and ECOSYSTEM; assign the matching product label to implementation work.

Community/Core contains the functionality required to write and publish a book.
Pro contains functionality that makes professional publishing substantially easier.

Community code must never depend on Pro code. Allowed dependency direction:
`Pro -> Community`. Never: `Community -> Pro`.

The Community application must build and operate without any Pro repository or
package being present. Basic local authoring must work offline without an account.
Do not introduce artificial limitations into Community functionality merely to create a Pro feature.

## Licensing

The repository is currently private. AGPLv3 is a candidate Community licence,
not a final licensing decision.

Do not:

- Change repository visibility.
- Make licensing decisions on behalf of the project.
- Accept/configure unrestricted external contributions.
- Create the Pro repository unless an approved issue explicitly requires it.

Contributor licensing, copyright ownership and dual-licensing strategy must be
resolved before public contributions are accepted. Follow the
[public release checklist](docs/planning/public-release-checklist.md); creating
an issue does not complete a legal decision or release gate.

## Development workflow

```text
Requirement -> Design -> GitHub Issue -> Branch -> Commit
-> Pull Request -> Tests -> Review -> Merge
```

Prefer one implementation issue per pull request. Branch naming:

```text
feature/<issue-number>-short-description
fix/<issue-number>-short-description
chore/<issue-number>-short-description
```

Pull requests that complete an issue must contain `Closes #<issue-number>`.
Use `Related to #<issue-number>` for partial work. Follow the repository PR
template. Review and merge are separate from opening a PR.
Do not begin another issue after opening the requested pull request.

## Scope discipline

When implementing an issue:

- Implement its acceptance criteria and keep changes focused.
- Avoid unrelated refactoring.
- Do not implement future issues early unless technically required.
- Do not recreate existing functionality.
- Preserve established architecture unless the issue explicitly changes it.
- Document any architectural conflict before making a major deviation.

## Required quality checks

Before completing implementation, run the applicable repository checks. At minimum
inspect and use the scripts defined by the repository. Current expected checks:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check:workspace
```

Use a frozen-lockfile install to reproduce dependencies. See
[test conventions](tests/README.md) for relevant tests and `pnpm test:coverage`.
CI runs the repository quality checks on documentation-only PRs too.
Report any unavailable or inapplicable checks with an explanation.
Do not claim a check passed unless it was actually executed successfully.

## Electron security

Maintain:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Restricted preload API
- Validated IPC boundaries
- No unrestricted renderer filesystem access

Do not weaken these controls merely to simplify implementation.

## Persistence and reliability

Drelwick is an authoring application. Data loss is considered a critical defect.
Persistence work should favour:

- Atomic writes
- Autosave
- Recoverability
- Crash recovery
- Explicit dirty-state handling
- Safe schema migrations

Preserve the previous valid version on save failure and consider compatibility
and backups when migrating formats. Never silently discard manuscript changes.

## AI

AI functionality must never silently modify manuscript content. AI features must
use explicit context and suggestion/review/apply workflows. AI components must
not receive unrestricted filesystem access.

## Documentation

Detailed architecture and product decisions belong under `/docs`. AGENTS.md should
remain concise and contain permanent repository-wide instructions rather than
duplicating the complete design documents. Do not replace the detailed documents.
If implementation changes an established architectural decision, update the
appropriate documentation as part of the same work where appropriate.
