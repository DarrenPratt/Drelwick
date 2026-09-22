# SAREL — GitHub Build Plan

## Commercial Architecture Addendum

**Build Plan Version:** 0.2\
**Product Model:** Open Core\
**Current Repository State:** Private\
**Public Community Target:** Candidate at v0.3

---

## Tracking and current interpretation

`Issue 51`–`Issue 60` are stable plan IDs. Use the [tracking register](github-tracking.md) for real GitHub numbers; dependency references here refer to plan IDs. These are open work items, not completed legal decisions. Public release follows the dedicated [release gate](public-release-checklist.md).

Task 60 is future work, after the Community/Pro package boundary is established and the extension design is ready. It does not instruct creation of Pro during this planning run. Task 56 designs the public API; a full plugin runtime is outside v0.1. CORE classification for shared governance reflects the Community foundation, not a decision that commercial functionality is free.

## Local delivery update — 19 September 2026

Basic DOCX import is CORE in v0.2; basic manuscript DOCX export is CORE by v0.3. Cloud editing, hosted conversion and collaboration are outside the current roadmap. Optional Google Drive/Wasabi/Git repository backup is exploration of user-owned storage, not a SAREL hosted service. Client-side integration does not automatically imply SERVICE classification; provider fees and any future SAREL-operated infrastructure are separate decisions. See the [local publishing plan](local-publishing-plan.md). The rest of the feature-boundary review remains open in actual GitHub issue #52.

# Commercial Architecture Milestone

Create an additional GitHub milestone:

```text
Licensing & Commercial Architecture
```

This milestone must be completed before the repository accepts external contributions.

It does not block development of v0.1.

---

# Issue 51 — Define Community / Pro Feature Boundary

## Title

```text
Define SAREL Community and Pro feature boundary
```

## Objective

Document which capabilities form the open-source Community product and which belong to SAREL Pro.

## Initial Community Scope

```text
Manuscript editor
Project management
Chapter management
Semantic formatting
Autosave/recovery
History
Basic themes
Basic local DOCX import and manuscript DOCX export
Portable local backup and restore
EPUB 3
Basic print PDF
Basic validation
Open project format
Plugin SDK
```

## Initial Pro Scope

```text
Advanced print
KDP profiles
KDP preflight
Advanced validation
Advanced Word layout fidelity (only if separately designed)
Premium themes
Series management
Advanced continuity
Advanced authoring tools
```

## Acceptance Criteria

- [ ] Community is independently useful
- [ ] Community can create a complete normal novel
- [ ] EPUB is available in Community
- [ ] Basic PDF is available in Community
- [ ] Pro features provide additional value rather than removing fundamental functionality
- [ ] Boundary documented
- [ ] Every planned major feature can be classified CORE/PRO/SERVICE/ECOSYSTEM

## Labels

```text
type:documentation
area:architecture
priority:high
commercial
```

---

# Issue 52 — Finalise Community Licence

## Title

```text
Review and select SAREL Community licence
```

## Objective

Select the licence under which the Community source will eventually be published.

## Candidate

```text
AGPLv3
```

## Requirements

Before completion obtain appropriate legal review covering:

```text
desktop distribution
commercial use
forks
plugins
dual licensing
contributions
copyright ownership
Pro interaction
```

## Acceptance Criteria

- [ ] Licence selected
- [ ] Legal implications documented
- [ ] Compatibility with Pro architecture confirmed
- [ ] LICENSE file prepared
- [ ] README licensing section prepared

## Important

Do not treat the current candidate licence as final until this issue is completed.

## Labels

```text
type:documentation
area:licensing
priority:high
commercial
legal-review
```

---

# Issue 53 — Define Contributor Licensing Strategy

## Title

```text
Define contributor agreement and copyright strategy
```

## Objective

Ensure accepting outside contributions does not unintentionally prevent future commercial licensing.

## Consider

```text
CLA
copyright assignment
Developer Certificate of Origin
dual licensing requirements
corporate contributors
```

## Acceptance Criteria

- [ ] Contribution ownership model selected
- [ ] External contribution process documented
- [ ] Commercial relicensing implications understood
- [ ] CONTRIBUTING.md created
- [ ] Required contributor agreement process established

## Blocking Rule

```text
DO NOT ACCEPT EXTERNAL CONTRIBUTIONS
until this issue is complete.
```

## Labels

```text
type:documentation
area:licensing
priority:critical
commercial
legal-review
```

---

# Issue 54 — Define Community / Pro Package Boundary

## Title

```text
Establish architectural boundary between Community and Pro
```

## Objective

Ensure Community never depends upon proprietary packages.

## Required Dependency Direction

```text
PRO
 │
 ▼
COMMUNITY
```

Forbidden:

```text
COMMUNITY
 │
 ▼
PRO
```

## Acceptance Criteria

- [ ] Community package interfaces identified
- [ ] Pro extension points identified
- [ ] Community builds independently
- [ ] Community tests run without Pro repository
- [ ] No proprietary dependency required to open Community projects
- [ ] No proprietary dependency required for EPUB/basic PDF

## Labels

```text
type:infrastructure
area:architecture
priority:critical
commercial
```

---

# Issue 55 — Introduce Feature Classification

## Title

```text
Add CORE PRO SERVICE ECOSYSTEM feature classification
```

## Objective

Make product-boundary decisions visible in GitHub planning.

## Values

```text
CORE
PRO
SERVICE
ECOSYSTEM
```

## GitHub Labels

Recommended:

```text
product:core
product:pro
product:service
product:ecosystem
```

Every feature issue should receive one classification.

## Acceptance Criteria

- [ ] Labels created
- [ ] Issue template contains product classification
- [ ] Existing feature backlog classified
- [ ] Classification documented in CONTRIBUTING.md or development documentation

## Labels

```text
type:infrastructure
area:github
priority:normal
commercial
```

---

# Issue 56 — Create Extension API Architecture

## Title

```text
Design Community extension API for Pro and plugins
```

## Objective

Define the mechanism through which optional capabilities extend Community.

## Initial Extension Types

```text
Importer
Exporter
Validator
Theme
Publishing Profile
Editor Tool
Reference Tool
AI Provider
```

## Principle

Where practical:

```text
SAREL Pro
      │
      ▼
Public Extension API
      │
      ▼
SAREL Community
```

rather than Pro directly modifying Community internals.

## Acceptance Criteria

- [ ] Extension interfaces documented
- [ ] Security boundary considered
- [ ] Versioning strategy documented
- [ ] Pro can consume extension interfaces
- [ ] Third-party extensions can eventually use the same public interfaces

## Dependencies

Issue 54.

## Labels

```text
type:feature
area:architecture
product:core
priority:normal
```

---

# Issue 57 — Document Open Project Format

## Title

```text
Create public SAREL project format specification
```

## Objective

Ensure manuscripts remain portable and recoverable independently of SAREL.

## Document

```text
project.json
book.json
chapter files
assets
reference data
schema versions
ordering
character encoding
migration policy
```

## Acceptance Criteria

- [ ] Format documented independently from implementation
- [ ] UTF-8 requirement documented
- [ ] Schema versioning documented
- [ ] Chapter representation documented
- [ ] Recovery guidance documented
- [ ] Example project included

## Target

Complete before public Community release.

## Labels

```text
type:documentation
area:project
product:core
priority:high
```

---

# Issue 58 — Define Trademark and Official Build Policy

## Title

```text
Define SAREL branding and official distribution policy
```

## Objective

Separate source-code rights from rights associated with official SAREL branding and builds.

## Consider

```text
SAREL name
SAREL Community
SAREL Pro
logos
fork naming
official binaries
signed builds
app stores
```

## Acceptance Criteria

- [ ] Trademark strategy documented
- [ ] Fork branding expectations documented
- [ ] Official build definition documented
- [ ] Legal review completed where appropriate

## Labels

```text
type:documentation
area:licensing
commercial
legal-review
priority:normal
```

---

# Issue 59 — Prepare Public Community Repository

## Title

```text
Prepare SAREL Community for public release
```

## Objective

Prepare the repository for conversion from private development to public open-source development.

## Required Before Public Release

- [ ] Licence finalised
- [ ] CONTRIBUTING.md
- [ ] CODE_OF_CONDUCT.md
- [ ] SECURITY.md
- [ ] README updated
- [ ] Contributor licensing established
- [ ] Trademark policy documented
- [ ] Project format documented
- [ ] Community/Pro boundary documented
- [ ] Secrets scan completed
- [ ] Git history reviewed for credentials/private information
- [ ] CI green
- [ ] Issue templates ready
- [ ] PR template ready

## Dependencies

Issues 51–58.

## Target Milestone

```text
v0.3 – EPUB Publishing & Community Candidate
```

## Labels

```text
type:infrastructure
area:github
product:core
priority:high
```

---

# Issue 60 — Create SAREL Pro Repository

## Title

```text
Create private SAREL Pro repository and integration skeleton
```

## Objective

Establish the commercial codebase without coupling Community to it.

## Proposed Repository

```text
SAREL-Pro
```

## Initial Structure

```text
SAREL-Pro/
│
├── packages/
│   ├── advanced-print/
│   ├── kdp-preflight/
│   ├── premium-themes/
│   └── licensing/
│
└── tests/
```

The repository may remain mostly skeletal until Community APIs stabilise.

## Acceptance Criteria

- [ ] Pro repository private
- [ ] Pro can consume Community packages
- [ ] Community has no Pro dependency
- [ ] CI can build Pro using Community
- [ ] Version compatibility strategy documented

## Dependencies

Issue 54.

## Labels

```text
type:infrastructure
area:architecture
product:pro
commercial
priority:normal
```

---

# Updated GitHub Milestones

The recommended roadmap is now:

```text
v0.1 – Reliable Manuscript Editor

v0.2 – Book Presentation & Preview

Licensing & Commercial Architecture
        │
        ├── licence
        ├── contributor policy
        ├── Community/Pro boundary
        ├── extension API
        ├── project format
        └── trademark/distribution

v0.3 – EPUB Publishing & Community Candidate

v0.4 – Print Publishing

v0.5 – Story Bible & Continuity

v0.6 – Editing & Revision Tools

v1.0 – Production Release
```

The Licensing & Commercial Architecture milestone can run in parallel with v0.1 and v0.2 but must be complete before accepting external contributions.

---

# Updated GitHub Issue Template

Every feature issue should contain:

```text
## Product Classification

[ ] CORE
[ ] PRO
[ ] SERVICE
[ ] ECOSYSTEM
```

Definitions:

**CORE**

Fundamental SAREL functionality available in Community.

**PRO**

Commercial professional/convenience functionality.

**SERVICE**

Feature dependent upon hosted infrastructure or continuing operating costs.

**ECOSYSTEM**

Theme, plugin or third-party extension capability.

---

# Updated Definition of Done

In addition to existing requirements:

- [ ] Product classification assigned
- [ ] Community/Pro dependency rules respected
- [ ] No proprietary dependency introduced into CORE
- [ ] Project-format changes documented
- [ ] Migration added for persistent schema changes

---

# Architecture Guardrail

CI should eventually include an architecture test that prevents Community packages importing Pro packages.

Conceptually:

```text
packages/core             ─┐
packages/project-model     │
packages/editor-schema     │
packages/epub              ├── COMMUNITY
packages/print             │
packages/plugin-sdk        │
packages/shared           ─┘

           ▲
           │ allowed
           │
SAREL-Pro
```

A Community build must always succeed when the Pro repository does not exist.

---

# Final Commercial Development Principle

Do not implement artificial limitations whose only purpose is to make Community frustrating.

Prefer:

```text
Community:
"Here are the tools required to publish your book."

Pro:
"Here are the tools that make professional publishing substantially easier."
```

This distinction should guide backlog classification.
