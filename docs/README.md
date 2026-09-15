# Documentation

Read these documents in the order below to move from product design to implementation planning.

| Document                                                                         | Purpose                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Software design](design.md)                                                     | Product goals, workflows, features and overall release roadmap.                                                             |
| [Technical specification](technical-spec.md)                                     | Repository layout, package boundaries, data models, persistence, rendering and testing architecture.                        |
| [v0.1 build plan](planning/v0.1-build-plan.md)                                   | Planned issues 1–50, dependencies, acceptance criteria and delivery workflow for the reliable manuscript editor.            |
| [Commercial architecture addendum](planning/commercial-architecture-addendum.md) | Planned issues 51–60, Community/Pro boundaries, licensing decisions, extension architecture and public-release preparation. |

These are design and planning documents, rather than a description of implemented functionality. Plan issue numbers identify stable tasks; the [GitHub tracking register](planning/github-tracking.md) maps them to actual created issues and dependencies.

The commercial architecture addendum is labelled build plan version 0.2. It supplements the v0.1 plan with updated milestones, product classification and additional completion criteria; it is not a replacement build plan or the v0.2 feature backlog. Its licensing and contribution decisions remain planned work, including final selection of the Community licence.

Keep product design and technical specifications directly under `docs/`, and delivery plans and planning addenda under `docs/planning/`. Use descriptive lowercase filenames with hyphens.

Operational documents:

- [Repository audit and reconciliations](planning/repository-audit.md)
- [Development workflow and product classification](development.md)
- [Existing project loading and summary cache](project-loading.md)
- [New project dialog and IPC](project-creation-ui.md)
- [GitHub tracking register](planning/github-tracking.md)
- [Public Community release checklist](planning/public-release-checklist.md)
