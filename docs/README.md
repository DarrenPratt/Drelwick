# Documentation

Read these documents in the order below to move from product design to implementation planning.

| Document                                                                         | Purpose                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Software design](design.md)                                                     | Product goals, workflows, features and overall release roadmap.                                                             |
| [Technical specification](technical-spec.md)                                     | Repository layout, package boundaries, data models, persistence, rendering and testing architecture.                        |
| [v0.1 build plan](planning/v0.1-build-plan.md)                                   | Planned issues 1–50, dependencies, acceptance criteria and delivery workflow for the reliable manuscript editor.            |
| [Commercial architecture addendum](planning/commercial-architecture-addendum.md) | Planned issues 51–60, Community/Pro boundaries, licensing decisions, extension architecture and public-release preparation. |

These are design and planning documents, rather than a description of implemented functionality. Plan issue numbers identify stable tasks; the [GitHub tracking register](planning/github-tracking.md) maps them to actual created issues and dependencies.

The commercial architecture addendum is labelled build plan version 0.2. It supplements the v0.1 plan with updated milestones, product classification and additional completion criteria; it is not a replacement build plan or the v0.2 feature backlog. Final licensing approval and the contributor agreement process remain pending. The [contributor strategy](contributor-copyright-strategy.md) records the owner's intended `AGPL-3.0-only`, CLA and DCO direction without claiming legal approval.

Keep product design and technical specifications directly under `docs/`, and delivery plans and planning addenda under `docs/planning/`. Use descriptive lowercase filenames with hyphens.

The [local publishing delivery plan](planning/local-publishing-plan.md) updates delivery order for DOCX, basic editing, presentation, EPUB and print. It also records optional user-owned backup research and the exclusion of cloud editing/collaboration. These remain planned capabilities.

Operational documents:

- [Local comments, anchors, revision review and snapshot design (#169)](editing-revisions.md)
- [Proposed editorial versions, file schemas and compatibility](editorial-format.md)
- [Editorial implementation contracts, fixture matrix and follow-up reconciliation](planning/169-editorial-delivery.md)

- [Independent Standard and Large-print publishing editions](large-print-edition.md)

- [Local print pagination and PDF-backed preview](print-preview.md)
- [Community print settings, dimensions and font requirements](print-settings.md)
- [Local print PDF export, preflight and review evidence](print-export.md)

- [Editable Community DOCX export and support matrix](docx-export.md)

- [Pro integration readiness and public API blockers](planning/61-pro-readiness.md)
- [Public-release evidence and outstanding gates](planning/public-release-checklist.md)
- [Release audit, privacy scan scope and redistribution blockers](planning/60-release-audit.md)
- [Central copyright and licensing notices](../COPYRIGHT.md)
- [Code of Conduct and pending public contact](../CODE_OF_CONDUCT.md)
- [Security reporting and support policy](../SECURITY.md)
- [Branding and official distribution policy (proposed; legal review pending)](branding-distribution-policy.md)
- [Branding inventory, repository evidence and outstanding release gates](planning/59-branding-review.md)
- [Public project format: implemented files, semantic content and independent recovery](project-format-specification.md)
- [Public format implementation cross-check and recovery evidence](planning/58-format-review.md)
- [Community extension architecture: contracts, capabilities, trust and compatibility](extension-architecture.md)
- [Extension design acceptance review and deferred implementation gates](planning/57-extension-review.md)
- [Contribution guide and closed external-contribution gate](../CONTRIBUTING.md)
- [Contributor agreement and copyright strategy (proposed; legal review pending)](contributor-copyright-strategy.md)
- [CLA requirements (draft for legal review; not an agreement)](contributor-cla-requirements.md)
- [Offline spell checking and local personal dictionary](offline-spelling.md)
- [Shared semantic book rendering and preview](book-rendering.md)
- [Local reflowable ebook simulation and acceptance evidence](ebook-preview.md)
- [Publication metadata, matter pages and managed covers](publication-matter.md)
- [Community book themes, persistence and target styles](book-themes.md)
- [Story bible persistence, linking and product boundaries (design; #160)](story-bible.md)
- [Story bible storage and restricted IPC implementation (#161)](story-bible-storage.md)
- [Local story bible location management (#163)](location-management.md)
- [Chapter references, backlinks and lifecycle rules (#166)](chapter-reference-links.md)
- [Local timeline events and stable associations (#165)](timeline-management.md)
- [Local canon records and research notes (#164)](canon-research.md)
- [Project format, version detection and recoverable migrations](project-format.md)
- [Repository audit and reconciliations](planning/repository-audit.md)
- [Development workflow and product classification](development.md)
- [Existing project loading and summary cache](project-loading.md)
- [New project dialog and IPC](project-creation-ui.md)
- [Existing project open workflow](project-open-ui.md)
- [Portable project backups and restore](project-backups.md)
- [Recent project tracking](recent-projects.md)
- [Chapter creation and failure recovery](chapter-creation.md)
- [Chapter duplicate, split, merge and status](chapter-organisation.md)
- [Chapter document persistence](chapter-persistence.md)
- [Local Chapter History preview and restore](chapter-history.md)
- [Manuscript semantic elements](manuscript-semantics.md)
- [Manuscript Find and Replace](manuscript-search.md)
- [Global local search, saved-source refresh and index limits](global-search.md)
- [Local image assets and recovery](local-image-assets.md)
- [Staged local manuscript import](manuscript-import.md)
- [Manuscript import preview and approval workflow](import-review-ui.md)
- [Community DOCX import and support matrix](docx-import.md)
- [Community TXT, Markdown and HTML import and support matrix](text-import.md)
- [Manuscript recovery](manuscript-recovery.md)
- [Application logging](application-logging.md)
- [Global error handling](error-handling.md)
- [v0.1 release validation](v0.1-release-validation.md)
- [Authoring workspace](workspace-demo.md)
- [GitHub tracking register](planning/github-tracking.md)
- [Public Community release checklist](planning/public-release-checklist.md)
- [Local EPUB export](epub-export.md)
- [Offline DOCX-to-EPUB release validation](publishing-release-validation.md)
- [Desktop packaging](desktop-packaging.md)
- [BookEditor recovery review](planning/bookeditor-recovery.md)
