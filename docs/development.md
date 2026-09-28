# Development workflow

Drelwick is in private development. Do not accept unrestricted external contributions until the Licensing & Commercial Architecture milestone is complete and the contributor/copyright strategy is formally approved. This document does not grant a licence or establish a contributor agreement.

The [contribution guide](../CONTRIBUTING.md) and
[contributor/copyright strategy](contributor-copyright-strategy.md) record the
proposed retained-copyright, CLA and DCO 1.1 process. External acceptance remains
closed until #54 is complete and the broader milestone gate above is satisfied;
legal review and the approved agreement/acceptance mechanism remain pending.

Use `Requirement -> Design -> Issue -> Branch -> Commit -> Pull Request -> Tests -> Review -> Merge`. Prefer one implementation issue per focused PR. Use `feature/<issue-number>-short-description`, `fix/<issue-number>-short-description` or `chore/<issue-number>-short-description`. Complete PRs use `Closes #<issue>`; partial work uses `Related to #<issue>`. Review and merge are separate from creating a PR.

Read the [design](design.md), [technical specification](technical-spec.md), [build plan](planning/v0.1-build-plan.md), [commercial addendum](planning/commercial-architecture-addendum.md) and [audit reconciliations](planning/repository-audit.md) before implementation. Use the [tracking register](planning/github-tracking.md) to distinguish stable plan IDs from actual GitHub numbers.

## Product classification

Every implementation issue has one primary product classification and matching label:

| Classification | Label               | Meaning                                                                                                                                    |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| CORE           | `product:core`      | Fundamental Community functionality, including basic local authoring and publishing. Shared Community infrastructure/governance uses CORE. |
| PRO            | `product:pro`       | Additional commercial professional or convenience capabilities.                                                                            |
| SERVICE        | `product:service`   | Hosted infrastructure or continuing operating costs.                                                                                       |
| ECOSYSTEM      | `product:ecosystem` | Themes, plugins or third-party extensions. The public extension API itself is CORE.                                                        |

Split work that delivers independently scoped products. Basic themes are CORE, premium first-party themes are PRO, third-party theme packages are ECOSYSTEM. Optional hosted AI is SERVICE; an AI provider extension can be ECOSYSTEM. Basic local DOCX import and manuscript export, archive backup/restore, and ordinary EPUB/PDF publishing are CORE. Cloud editing and collaboration are outside the current roadmap. A future client for user-owned backup storage is not automatically SERVICE; classify its implementation after the backup exploration. Classification is not a legal conclusion.

## Architecture guardrails

1. Renderer receives no unrestricted Node/filesystem access.
2. Enable Electron context isolation.
3. Disable renderer Node integration and enable sandboxing.
4. Expose only a restricted preload API.
5. Validate IPC inputs and authorize project/path access in the privileged process.
6. Pro depends on Community; Community never depends on Pro. Build and test Community with no Pro checkout.
7. Keep project files portable and recoverable outside Drelwick.
8. A database may be a rebuildable cache, never the only manuscript source.
9. Never log manuscript body text, including error payloads.
10. EPUB/PDF are generated outputs, never editable master documents.
11. Persistent formats have explicit schema versions.
12. Format changes require migration consideration, documented compatibility and backups where migration applies.
13. Use atomic persistence for manuscript/project saves and preserve the previous valid version on failure.
14. AI must never silently modify manuscript content.
15. Basic local authoring works offline without an account.
16. Community must remain independently useful; monetise added value rather than artificial restrictions.

The desktop security baseline is enforced in
`apps/desktop/src/main/windows/window-options.ts`: renderer Node integration is
disabled, context isolation and sandboxing are enabled, insecure content and
embedded webviews are disabled, and the deprecated remote module is not used.

## Readiness, validation and delivery

An issue is Ready only when dependencies are resolved, acceptance criteria and tests are concrete, required decisions are recorded, and its scope fits a focused PR. Dependencies in the tracking register include the original plan and explicitly documented readiness additions. Begin test-framework setup early; do not postpone tests merely because their plan number is higher.

Done requires satisfied acceptance criteria, relevant passing checks, documentation, review and merge. Documentation-only PRs may mark application tests inapplicable with an explanation. Once the toolchain exists, CI must run install, lint, format check, typecheck, tests and build on PRs and main. Configure protection against the real checks then; do not label absent checks as passing.

Development board: [Drelwick](https://github.com/users/DarrenPratt/projects/1), private and linked to this repository. This owner-created board fulfils the build plan target `Drelwick Development`; retain its name and reuse it. Fields: Status, Priority, Area, Milestone and Estimate. Status values: Backlog, Ready, In Progress, Review, Blocked, Done. Estimate values: XS, S, M, L, XL; leave estimates unset until assessed. Use issue labels for multi-area details and native milestone data. PR closure and Project status automation must be verified before relying on it.

The [tracking register](planning/github-tracking.md#project-board-setup) records current fields and initialization. Maintain Status, Priority and representative Area explicitly during triage; native Labels retains every applicable area. Estimates remain unset until assessed. Do not assume automated readiness, status transitions or label-to-field synchronization.
