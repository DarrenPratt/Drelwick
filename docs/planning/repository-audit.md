# Repository audit — 14 September 2026

## State before changes

The private `DarrenPratt/Drelwick` repository has one commit, `3dcfd791b60779e1fb5b1e95a8f2bc9f92a51851`, on default branch `main`. That commit contains only `.gitignore` and a one-line README. The local checkout also contains a modified README and five untracked documentation files supplied before this audit. Those files are preserved and incorporated into the planning PR.

```text
.gitignore
README.md
docs/
  README.md
  design.md
  technical-spec.md
  planning/
    v0.1-build-plan.md
    commercial-architecture-addendum.md
```

All six Markdown documents and the ignore configuration were read. No application source, package manifests, lockfile, workspace configuration, compiler configuration, test runner, build scripts, licence file, GitHub templates or workflows exist. None of the 50 application build-plan tasks is implemented. The supplied documentation partially establishes the planning foundation; it is not evidence of working application functionality.

GitHub inspection found no issues (open or closed), milestones (open or closed), pull requests (open or closed), workflows, Actions runs or rulesets. The only branch is `main`, which is unprotected. Issues and Projects are enabled. Ten default labels exist: accessibility, bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question and wontfix.

Actions is enabled with all actions allowed and SHA pinning not enforced. Default workflow token permissions are read-only, and Actions cannot approve PR reviews. These settings were inspected but not changed. When implementing CI, review action pinning and minimum permissions alongside the actual workflow and merge checks.

GitHub Projects could not be inspected: GraphQL returned `INSUFFICIENT_SCOPES` for `read:project`. The available credential has repository access but no Projects scope. Existing boards therefore remain **unknown**, not assumed absent. Reconciliation must search existing user/repository projects before creating `Drelwick Development`; writing the board requires appropriate Projects write access. See the tracking register for the follow-up issue.

## Discrepancies and reconciliation

| Finding                                                                                                                                       | Resolution or remaining decision                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial design treats publishing features as one product; addendum introduces open core.                                                      | Add explicit Community/Pro direction and provisional classification to design/spec; retain detailed product requirements. Fine-grained feature boundary remains commercial task 51.                        |
| Design examples omit `project.json`, put order in chapters and use numbered identities; technical spec uses immutable IDs and manifest order. | Update design examples to the technical model. `project.json` owns ordering; UUIDs identify chapters; textual files use UTF-8 and explicit schema versions.                                                |
| Technical spec lists pnpm/npm/yarn and Zustand/Redux alternatives.                                                                            | Confirm the user-selected pnpm workspaces, Zustand and Zod baseline.                                                                                                                                       |
| Design puts scene breaks in v0.2 and technical spec lists a larger initial editor schema than the v0.1 task list.                             | v0.1 tasks 23–25 define the initial subset, including scene breaks. Later releases extend the schema with migration consideration.                                                                         |
| Plugin implementation is deferred beyond v1, but addendum requires extension API architecture before public contributions.                    | Design/version/security work occurs in commercial tasks 54/56; runtime/plugin distribution remains later work. No plugin runtime or Pro repository is needed for v0.1.                                     |
| Build-plan critical-path sketch implies atomic writer depends on project schemas, while task 12 explicitly depends on shared types.           | Individual task dependencies take precedence over the sketch. The tracking register records the full graph and real GitHub numbers.                                                                        |
| Some tasks omit objective, scope, expected components, tests or explicit dependencies.                                                        | Preserve original task requirements; supplement GitHub issues with those fields and clearly identify readiness decisions.                                                                                  |
| Model tasks require tests before task 40 appears in numerical order.                                                                          | Deliver task 40 early after bootstrap, before completing tasks requiring executable tests. Numerical order is not delivery order.                                                                          |
| Dirty-state pseudocode acknowledges the current revision, potentially clearing newer edits.                                                   | Acknowledge the revision actually persisted; serialize saves and test edits during an in-flight save.                                                                                                      |
| Chapter summaries promise word counts without loading bodies, but no summary index is specified.                                              | Task 14 must define a rebuildable metadata/cache strategy, or document bounded reads outside the editor. Never introduce a database as the only manuscript source.                                         |
| Atomic replacement of one file does not make chapter creation/deletion plus manifest updates transactional.                                   | Tasks 12/18/20 must specify failure ordering, preserved originals and reconciliation. Cross-platform replacement/durability, concurrent project access and recovery tie-breaking require tested decisions. |
| Some persisted-object examples omit schema versions; session marker location is unclear.                                                      | Examples are conceptual; all persisted formats need an explicit version/envelope. Task 37 must define marker ownership/location and safe lifecycle handling.                                               |
| HTML print preview is described as closely matching final output before pagination is proven.                                                 | v0.2 HTML preview is approximate; Chromium pagination/print validation remains later verification work.                                                                                                    |
| Visual Studio ignore rules hide `packages/*` and nested manuscript history fixtures.                                                          | Retain useful ignore content; allow workspace source and fixture history, and add Node build-output ignores.                                                                                               |
| No CI or branch protection exists.                                                                                                            | Track executable application CI in task 45 after toolchain tasks; no placeholder workflow claiming application validation. Merge protection must name real passing checks once available.                  |

## Security and licensing status

Repository visibility remains private. AGPLv3 is a candidate only; there is no final Community licence or approved contributor/dual-licensing strategy. No Pro repository is created. No external contribution invitation, CLA bot, public release or automatic merge is configured.

The audit is not a completed secret scan or legal review. Credentials, tokens, private URLs, internal documents, dependency licences and full Git history need dedicated pre-publication review. Removing a secret from the current tree does not remove it from history. See [public release checklist](public-release-checklist.md).

## Outcome and first implementation

See [GitHub tracking register](github-tracking.md) for actual issue numbers, milestones, labels, dependencies and the board blocker. The first application implementation is the pnpm monorepo bootstrap. Complete unit-test configuration early, then strict TypeScript, Electron isolation, project schemas and atomic persistence. This planning PR does not deliver application features or claim v0.1 validation.

## Foundation validation

- Queried GitHub after reconciliation: 62 unique issues, including 60 plan tasks, one foundation task and one Project board access follow-up; eight milestones and 36 total labels.
- Checked each plan task's title, stable marker, required sections, labels, milestone and actual prerequisite numbers against the prepared task register; no duplicate plan markers.
- Checked the combined original/readiness dependency graph for cycles; none found.
- Parsed both GitHub YAML files and checked the implementation form's CORE/PRO/SERVICE/ECOSYSTEM options.
- Resolved local Markdown file links and decoded all documents as UTF-8.
- Checked ignore behaviour: workspace source and synthetic `.history` fixtures are trackable; dependencies, local environment files and build outputs are ignored.
- Ran `git diff --cached --check`; no whitespace errors after preserving Markdown hard breaks with explicit backslashes.
- Confirmed repository remains private. No application build, lint, typecheck, tests or CI can run until the planned toolchain exists. No complete secret scan or legal review is claimed.

## Follow-up: Projects access resolved

After the owner authorized GitHub CLI with Projects access and linked the Project, inspection found the existing private [Drelwick board](https://github.com/users/DarrenPratt/projects/1). It was reused with its name/link intact. The historical scope error above describes the initial audit, not a current blocker. See the [board setup record](github-tracking.md#project-board-setup) for fields, all 62 issue memberships and validation. PR #63 is merged; the follow-up documentation PR for #62 contains no application implementation.
