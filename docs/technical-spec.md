# Drelwick

## Technical Implementation Specification

**Status:** Draft\
**Version:** 0.1\
**Target Platforms:** Windows, macOS, Linux\
**Primary Runtime:** Electron\
**Primary Language:** TypeScript\
**UI Framework:** React\
**Editor Framework:** TipTap / ProseMirror\
**Print Rendering:** Chromium + Playwright\
**Ebook Output:** EPUB 3

---

## Baseline reconciliation — September 2026

The current [open-core decision](design.md#current-product-decision--september-2026) and [audit](planning/repository-audit.md) apply throughout this specification. Community packages may expose public extension interfaces; they must never import or require Pro. Planned `packages/print` and `packages/validation` will supply basic Community publishing. Advanced professional modules belong in the eventual separate Pro codebase. The [Community extension architecture](extension-architecture.md) defines the #57 contracts and security/versioning policy; `packages/plugin-sdk` is deferred until a concrete host capability can prove its contracts, not a v0.1 runtime requirement.

The snippets below illustrate architecture rather than defining a complete wire format. All persisted objects (including settings, history and session metadata) require explicit schema versions, directly or through a versioned envelope. Schema changes require compatibility and migration consideration. The [public project format specification](project-format-specification.md), delivered by GitHub #58 (commercial plan task 57), defines the implemented on-disk contract and independent recovery; it takes precedence over prospective file/model examples below.

Use immutable UUIDs and manifest ordering; short `chapter-001`/`0f23...` placeholders below are explanatory, not valid identities. Service logic belongs in `packages/core` where independent of Electron; main-process services adapt platform/IPC/lifecycle operations rather than duplicating business logic. Shared renderer-safe types must not pull privileged file helpers into renderer bundles.

The v0.1 build plan defines the minimal editor schema (text/paragraphs, bold/italic, undo/redo, scene breaks and block quotes). Later nodes/marks shown here are not all required initially. Extension API design/security/versioning precede public contributions; runtime distribution may remain later work. v0.2 HTML print preview is approximate until pagination is validated against generated output.

# 1. Purpose

Implemented print edition separation (#136) is specified in
[Large-print publishing edition](large-print-edition.md): two fixed profiles share
one manuscript and the Community rendering/export pipeline, with independent EPUB
presentation. No general multi-edition manager is introduced.

This document defines the implementation architecture for Drelwick described in the Software Design Document.

The intent is to move from conceptual architecture to a practical codebase structure with:

- repository layout;
- package boundaries;
- TypeScript interfaces;
- Electron process responsibilities;
- IPC contracts;
- TipTap document schema;
- persistence rules;
- autosave design;
- crash recovery;
- preview architecture;
- EPUB export;
- PDF export;
- validation;
- testing strategy;
- initial development milestones.

The application should be developed incrementally.

The first usable milestone should be a dependable manuscript editor before publishing functionality is introduced.

---

# 2. Repository Structure

The project should initially use a single repository.

Recommended layout:

```text
@drelwick/
│
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   ├── preload/
│       │   └── renderer/
│       │
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── core/
│   ├── project-model/
│   ├── editor-schema/
│   ├── renderer/
│   ├── epub/
│   ├── print/
│   ├── validation/
│   └── shared/
│
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── design.md
│   └── technical-spec.md
│
├── scripts/
│
├── package.json
├── tsconfig.base.json
└── README.md
```

A workspace-based package manager should be used.

The selected package manager is:

```text
pnpm
```

because it handles multi-package repositories efficiently.

---

# 3. Top-Level Package Responsibilities

## apps/desktop

Contains the Electron desktop application.

Responsibilities:

- create windows;
- native menus;
- file dialogs;
- project selection;
- renderer hosting;
- IPC;
- lifecycle management;
- crash detection;
- updates later.

---

## packages/core

Contains application-level business logic.

Examples:

```text
ProjectService
AutosaveService
HistoryService
ExportService
RecoveryService
SearchService
```

This package should contain no Electron-specific code wherever possible.

---

## packages/project-model

Defines persistent data models and schema versions.

Contains:

- project metadata;
- manuscript files;
- project configuration;
- book settings;
- reference data.

---

## packages/editor-schema

Contains the TipTap/ProseMirror extensions used by the manuscript editor.

This prevents editor-specific semantic nodes from becoming embedded directly in UI components.

---

## packages/renderer

Transforms manuscript content into presentation documents.

Provides:

```text
Manuscript → HTML
Manuscript → XHTML
Manuscript → Print HTML
```

---

## packages/epub

Responsible for EPUB generation and packaging.

---

## packages/print

Responsible for:

- print CSS;
- page layout;
- Playwright orchestration;
- PDF generation.

---

## packages/validation

Contains validation rules.

Examples:

```text
ProjectValidator
EpubValidator
PrintValidator
AssetValidator
MetadataValidator
```

---

## packages/shared

Contains generic shared utilities and types.

Examples:

```text
Result<T>
ApplicationError
Logger interfaces
File helpers
ID helpers
Date utilities
IPC DTOs
```

Avoid allowing this package to become a dumping ground.

---

# 3.1 Community / Pro dependency boundary

**Classification: CORE.** Community defines capabilities and extension boundaries.
Pro may consume or implement those boundaries. Community must never import, link
to, require or otherwise depend upon Pro, including optional, development, peer,
test or build dependencies. A disabled feature flag does not permit a reverse
dependency.

```text
       Drelwick Pro (separate repository, future #61)
                         |
                         | consumes / implements Community contracts
                         v
       Drelwick Community (this repository)
       capabilities + open format + extension boundaries

       Pro -> Community: ALLOWED architectural direction
       Community -> Pro: FORBIDDEN
```

This is an architectural rule, not permission to distribute proprietary code
combined with Community. Issue [#53](https://github.com/DarrenPratt/Drelwick/issues/53)
records the owner's intended **AGPL-3.0-only** Community licence and separately
licensed proprietary/commercial Pro functionality. **Legal review and final
licensing approval remain pending.** Earlier candidate-language in planning
documents is historical; this section does not select a different licence.
Technical separation, dependency inversion and a plugin API do not establish an
AGPL exception or third-party commercial relicensing rights. Distribution, Pro
interaction, plugins and dual licensing require #53 review; contributor rights
require #54. No source file becomes both Community and proprietary by belonging
to the same project. Public release remains gated by #60.

## Actual Community package graph

Audited against main `58da41f` on 28 September 2026. The layout in section 2 is a
target, not the current package inventory. All six current workspaces are CORE;
`private: true` is the current package-publication setting, not a PRO classification.
The root `drelwick` manifest contains Community development tooling only.

| Workspace                   | Responsibility and Community contracts                                                                                                                                                              | Direct workspace dependencies         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `@drelwick/shared`          | Renderer-safe DTOs, IPC names/validation, `DrelwickApi`, errors, IDs, publication/theme/import types                                                                                                | None                                  |
| `@drelwick/project-model`   | Versioned project/book/chapter/asset schemas, semantic validation, format detection/migration models, import and archive validation                                                                 | shared                                |
| `@drelwick/renderer`        | Pure semantic XHTML generation: `BookRevision`, `RenderOptions`, `RenderedBook`, diagnostics, asset/link resolvers and built-in theme CSS                                                           | project-model, shared                 |
| `@drelwick/core`            | Local creation/loading/saving, atomic persistence, autosave, recovery/history, search/replacement, assets, staged imports, book assembly, publication settings, archive backup/restore and spelling | project-model, renderer, shared       |
| `@drelwick/desktop`         | Electron main/preload adapters, restricted IPC, React/TipTap editor, native dialogs, menus, local preview and bundled spelling resources                                                            | core, project-model, renderer, shared |
| `@drelwick/workspace-smoke` | Separate private test consumer that resolves Community package exports in TypeScript and Node                                                                                                       | renderer, shared                      |

There is no Pro package or Pro runtime loader. There is no separate storage or
import/export workspace: those operations currently live in core with privileged
desktop adapters. The shared package is populated, not an empty bootstrap module.
TipTap extensions currently live in desktop's renderer; `packages/editor-schema`
is a proposed extraction, not an installed workspace. `packages/epub`,
`packages/print`, `packages/validation` and `packages/plugin-sdk` are future CORE
packages. Adding them requires a reviewed Community inventory entry; #55 does
not create placeholders or move existing functionality.

## Existing contracts and optional extension direction

These are actual internal Community interfaces, **not a stable public plugin SDK**:

| Capability                            | Existing Community boundary                                                                                                                                    | Safe extension direction / remaining work                                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Publishing and analysis               | `core.assembleBook` captures a coherent `AssembledBook`; renderer consumes `BookRevision` and `RenderOptions`, returning `RenderedBook` and `RenderDiagnostic` | Optional consumers can analyse a bounded snapshot or supply trusted asset/link resolvers. Ordinary render/validation must remain built in. Public contracts/permissions are designed in #57; registration runtime is deferred. |
| Import                                | `core.ManuscriptImporter`, `StagedManuscriptImport`, isolated first-party parser contract, project-model `ImporterResult` and validation; shared import DTOs   | Desktop explicitly registers bundled parsers. #57 can build a restricted external contract from this use case; the current worker/VM runner is not a hostile-plugin sandbox.                                                   |
| Export                                | Shared semantic rendering already supports ebook/print targets; core captures assets and publication order                                                     | #125 owns local DOCX export, #126 EPUB packaging, #128–#130 basic print/PDF. They must work before/without plugin registration. No exporter registry exists yet.                                                               |
| Validation                            | Project-model schemas, core project/import validation and renderer diagnostics                                                                                 | Pro may add checks to Community results. It cannot supply a validator required to open a normal project or publish basic output. Public validator contracts are designed in #57; registration runtime is deferred.             |
| Storage and backup                    | Core local filesystem seams such as `ProjectLoadingFileSystem`, atomic writes, `createProjectArchive` and `restoreProjectArchive`                              | Filesystem injection is a privileged internal/test seam, not authority for plugins. Provider research #139 precedes any scoped archive adapter contract.                                                                       |
| Themes                                | Community theme types/presets, persisted selection and renderer theme generation                                                                               | Three built-in themes work independently. Premium/third-party themes must use a future reviewed contract, with a usable Community fallback; current strict built-in IDs are not an open registry.                              |
| Advanced authoring / project analysis | Validated semantic documents, snapshots, shared DTOs and explicit editor transactions                                                                          | Pro may eventually consume a permission-limited snapshot and return suggestions for user review. No new analysis, AI or advanced-authoring interface is needed for this boundary check.                                        |

When optional registration is introduced, Community owns the contract, validation,
versioning and absence/failure behaviour. A separate Pro composition layer may
consume that contract and register its implementation; Community must not import
the concrete Pro implementation to register it. An empty optional registry must
leave all basic workflows usable. Never add a type-only import from Pro to define
a Community contract. Package exports, rather than private source paths, are the
future consumption boundary; compatibility testing belongs to #61 after #57.

The [#57 extension architecture](extension-architecture.md) defines one public
Community-owned contract family for Pro and eventual third parties: Importer,
Exporter, Validator, Theme, Publishing Profile, Editor Tool, Reference Tool and
AI Provider. Host adapters negotiate independent API/category/data versions and
grant only operation-scoped capabilities. They validate results and retain all
commit, persistence and privileged I/O authority. Themes/profiles are declarative;
editor tools return reviewed semantic proposals; AI receives explicit approved
context through future credential/network brokers. Interface compatibility is
not trust, and the current parser runner is not a hostile-plugin sandbox.

The design defers the SDK package and runtime, keeps built-ins independent and
does not add a backup-provider API while #139 research is unresolved. See the
[example review and implementation gates](planning/57-extension-review.md).
No private repository or blanket proprietary-plugin permission is introduced.
Existing Electron context isolation, sandboxing, validated IPC and restricted
preload access remain mandatory.

## Local operation and publishing status

The 19 September clarification in #109 / merged PR #140 is authoritative: basic
DOCX import/export and portable local backup/restore belong in Community. Basic
importing, writing, previewing, publishing and backup/restore must require no
Drelwick account, network service, proprietary package or sibling checkout.
Dependency downloads during installation are separate from offline application
operation. Development's optional local Vite server is not a production service
requirement; normal desktop startup loads bundled files.

| Community capability                                                                                                          | Current implementation / outstanding work                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project create/open/save, chapter management, semantic editing, local persistence, autosave/recovery, history, search/replace | Implemented in core, project-model and desktop; ordinary opening validates local files, with migration before desktop activation.                                                                |
| Local image assets, metadata/front/back matter, Community themes, ebook preview                                               | Implemented. Core assembles saved content; renderer creates XHTML; desktop hosts an isolated local preview. Preview is not an EPUB file or proof of final PDF pagination.                        |
| Basic DOCX import                                                                                                             | #114 staging and #115 parser are implemented, with #116 review/commit UI; TXT/Markdown/HTML also use the same Community pipeline.                                                                |
| Basic DOCX export                                                                                                             | #125 implements semantic DOCX generation/atomic output in core and restricted native export in desktop. See [DOCX export](docx-export.md); no hosted conversion or Pro requirement.              |
| Portable local backup/restore                                                                                                 | #110 implemented in core, with project-model archive schema and restricted desktop commands. Project files remain authoritative.                                                                 |
| EPUB 3                                                                                                                        | #126 implements local EPUB 3.0 generation, structural validation and atomic desktop export. #127 remains the separate offline publishing workflow validation gate.                               |
| Basic print/PDF and Community publishing validation                                                                           | #128–#130 remain open (platform/output validation #131). Use Community print/validation implementation and privileged local Chromium orchestration. Advanced Pro checks cannot be prerequisites. |
| Open project format and extension API                                                                                         | #58 documents the implemented public project format with a production-validated example and independent recovery. #57 documents the extension design; SDK/runtime remain deferred.               |

Future optional remote backup adapters may upload/download consistent archives
with separately authorized credentials and bounded access. They must never become
the authoritative manuscript store, replace local persistence, gate local restore,
or lock access to a user's projects behind Pro or a service. Removing the adapter
must leave the local project usable. Provider research does not authorize cloud
editing or live synchronization.

## Community owns the project format

The [public format specification](project-format-specification.md) documents the
current schema versions, authoritative ordering, unknown-data behavior and
ordinary-tool recovery. No Pro-specific field or preservation mechanism is added.

The source of truth is local versioned JSON and managed assets; schemas and
migrations belong entirely to project-model/core. Neither project loading nor
recovery asks for a licence entitlement, Pro metadata decoder or account.
Generated EPUB/PDF/DOCX are outputs, never authoritative manuscript storage.
Supported Community projects remain editable and portable, with publishing through
Community capabilities as those implementations arrive.

There is **no general extension-metadata preservation contract yet**. Some envelope
schemas ignore unknown fields and some writers preserve raw fields, but strict
semantic, format and presentation schemas reject unsupported structures. This is
not permission to insert proprietary nodes, required fields, theme IDs or format
versions. Unknown/newer format versions fail safely rather than loading Pro.

Before Pro writes optional metadata, a #58-aligned follow-up to the extension
design must specify a namespaced, versioned
representation that Community can safely preserve or ignore across save, migration,
backup/restore and publishing. Core manuscript text, order, semantics and required
assets must never depend on it. That future change needs round-trip/absence tests
and a Community fallback. Existing valid projects do not contain required Pro data;
no format migration or speculative extension field is needed for #55.

## Enforcement and independent verification

`pnpm check:architecture` executes the regression tests and
`scripts/check-community-boundary.mjs`. `pnpm check:workspace` includes it, so the
existing required CI **Quality checks** job enforces the boundary on every PR.
`scripts/community-packages.json` is the reviewed inventory of this repository's
Community packages and root tooling. New manifests fail until classified. Pro
belongs in a separate checkout and must never be added to this inventory.

The checker examines tracked and nonignored new JavaScript/TypeScript sources,
tests, tooling, manifests and JSON/YAML configuration. It checks static/type-only
imports, re-exports, import types, literal dynamic imports, `require` and
`require.resolve`; computed module loading fails and must use a static reviewed
registry. Reserved Pro namespaces/repository paths, unclassified Drelwick imports,
Pro aliases in manifests/configuration, nonlocal Community dependency versions,
escaping relative imports/local dependencies/TypeScript path mappings, and changes
to the Community-only workspace globs fail with an explanatory error. Optional,
peer, dev and root tooling dependencies are included. It uses the already pinned
TypeScript parser, not a new architecture framework.

This is regression protection, not a security or licence audit. Renamed proprietary
third-party modules, arbitrary shell execution, constructed paths and semantic
account/network requirements still require review. Package additions must include
ownership/classification and dependency review; do not weaken the inventory to
silence an error. The rule applies to this Community checkout, so it does not ban
a future separate Pro repository from consuming approved Community exports.

To reproduce independent verification in a fresh Community-only checkout, with no
Pro repository or linked proprietary packages:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check:workspace
pnpm test:e2e
```

Use the pinned Node/pnpm versions and platform guidance in
[development](development.md) and [tests](../tests/README.md). CI checks out only
this repository. The checker's adversarial fixtures test prohibited dependencies;
the actual workspace scan and build test the real graph. Core project-loading,
chapter-saving, migration, archive and import suites exercise local files; renderer
tests cover semantic output and diagnostics; desktop E2E covers offline import,
editing/reopening, themes, preview and recovery. Unimplemented DOCX/EPUB/PDF output
must not be described as executed or validated.

The audit found no prohibited Pro dependency, mandatory account/service path,
Pro environment variable, entitlement-bearing IPC contract or sibling/private
checkout assumption in current application/build/test paths. XML namespace URLs
and manuscript links are data; the optional Vite URL is development configuration.
The gap addressed here is missing automated boundary enforcement and a stale
target-only package description, not a runtime coupling requiring source changes.

Verification on Windows, Node 24.20.0 and pnpm 10.34.5, in a fresh Community
worktree with its own frozen-lockfile installation and no Pro checkout/package:

- Passed lint, formatting, typecheck, build and workspace smoke checks.
- Passed all 933 unit tests across 79 files, including local project loading,
  saving, migration, import, archive round trips and semantic rendering.
- Passed 20 architecture regression tests and the actual repository boundary scan.
- Desktop E2E: 14 passed; one existing ebook-simulation navigation test failed at
  `tests/e2e/desktop.spec.ts:316` because clicking the contents link left the
  iframe location hash empty. The same failure reproduced in a separate checkout
  whose application/package/test sources are identical to main `58da41f`.
  This does not demonstrate a Pro dependency, but the full E2E suite is **not
  passing**. No preview behaviour or test assertion is changed in #55.

Passing desktop scenarios include offline DOCX/text import, editing/reopening,
local images, themes, basic preview isolation, autosave/recovery and history.
EPUB, DOCX export and PDF output were not executed because they are unimplemented.
This Windows run does not claim installer, macOS or Linux E2E validation.

**Readiness:** #52 is still open and is #55's recorded prerequisite. This work
implements the invariant using the existing product decisions without completing
that feature-boundary review. Use `Related to #55` while that prerequisite remains
unresolved. #53 legal review, #57 extension design, #60 release gates and #61 Pro
integration remain separate; later publishing features are not required to prove
the current package boundary and are not claimed complete.

---

# 4. Electron Architecture

Electron should use the recommended isolation model.

```text
Main Process
     │
     │ IPC
     ▼
Preload Layer
     │
     │ Restricted API
     ▼
Renderer
```

Security configuration:

```typescript
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: preloadPath,
  },
});
```

The renderer should never receive unrestricted filesystem or process access.

---

# 5. Electron Main Process

Suggested directory:

```text
apps/desktop/src/main/
│
├── main.ts
├── windows/
│   └── main-window.ts
│
├── ipc/
│   ├── project-ipc.ts
│   ├── file-ipc.ts
│   ├── export-ipc.ts
│   └── dialog-ipc.ts
│
├── services/
│   ├── project-service.ts
│   ├── autosave-service.ts
│   ├── history-service.ts
│   ├── recovery-service.ts
│   └── export-service.ts
│
└── logging/
    └── logger.ts
```

The main process owns privileged operations.

These include:

- opening project folders;
- reading project files;
- writing project files;
- creating backups;
- generating exports;
- opening native dialogs;
- launching Playwright.

---

# 6. Preload API

The preload script should expose a narrow application API.

Example:

```typescript
export interface DrelwickApi {
  project: {
    create(): Promise<CreateProjectResult>;
    open(): Promise<OpenProjectResult>;
    loadChapter(id: string): Promise<ChapterDocument>;
    saveChapter(id: string, document: ChapterDocument): Promise<SaveResult>;
    reorderChapters(ids: string[]): Promise<void>;
  };

  export: {
    epub(options: EpubExportOptions): Promise<ExportResult>;
    pdf(options: PdfExportOptions): Promise<ExportResult>;
  };

  dialog: {
    selectImage(): Promise<FileSelectionResult>;
    selectExportLocation(): Promise<FileSelectionResult>;
  };
}
```

Expose it using:

```typescript
contextBridge.exposeInMainWorld("drelwick", api);
```

The renderer should use:

```typescript
window.drelwick.project.open();
```

rather than Electron APIs directly.

---

# 7. IPC Design

All IPC channels should be centrally defined.

Example:

```typescript
export const IPC = {
  PROJECT_CREATE: "project:create",
  PROJECT_OPEN: "project:open",
  PROJECT_LOAD_CHAPTER: "project:load-chapter",
  PROJECT_SAVE_CHAPTER: "project:save-chapter",

  EXPORT_EPUB: "export:epub",
  EXPORT_PDF: "export:pdf",

  DIALOG_SELECT_IMAGE: "dialog:select-image",
} as const;
```

Avoid raw string IPC names scattered across the project.

---

# 8. IPC Validation

Inputs from the renderer must be validated before use.

The renderer should be treated as an untrusted boundary.

For example:

```typescript
const SaveChapterSchema = z.object({
  chapterId: z.string().uuid(),
  content: ChapterDocumentSchema,
});
```

Use Zod for runtime validation.

Conceptually:

```text
Renderer
   ↓
IPC DTO
   ↓
Schema Validation
   ↓
Application Service
   ↓
Filesystem
```

---

# 9. Project Model

A project directory contains all authoring information.

Example:

```text
example-novel/
│
├── book.json
├── project.json
│
├── manuscript/
│   ├── chapter-001.json
│   ├── chapter-002.json
│   └── chapter-003.json
│
├── frontmatter/
├── backmatter/
├── assets/
├── reference/
├── styles/
└── .history/
```

---

# 10. Project Configuration

`project.json`

Example:

```json
{
  "schemaVersion": 1,
  "projectId": "0f23...",
  "created": "2026-09-12T12:00:00Z",
  "modified": "2026-09-12T12:30:00Z",
  "bookFile": "book.json",
  "manuscript": {
    "order": ["chapter-001", "chapter-002", "chapter-003"]
  }
}
```

---

# 11. Book Metadata Model

```typescript
export interface BookMetadata {
  schemaVersion: number;

  title: string;
  subtitle?: string;

  author: string;

  language: string;

  publisher?: string;
  isbn?: string;

  description?: string;

  series?: {
    name: string;
    number?: number;
  };

  created: string;
  modified: string;
}
```

---

# 12. Chapter Model

```typescript
export interface ChapterFile {
  schemaVersion: number;

  id: string;

  type: "chapter" | "prologue" | "epilogue" | "frontmatter" | "backmatter";

  title: string;

  status: "draft" | "revising" | "review" | "final";

  content: ProseMirrorDocument;

  created: string;
  modified: string;
}
```

---

# 13. Identifier Strategy

Persistent entities should receive immutable IDs.

Recommended:

```text
UUID v4
```

Examples:

```text
Project ID
Chapter ID
Character ID
Location ID
Timeline Event ID
Asset ID
```

Display order should never be encoded into IDs or filenames.

Avoid:

```text
chapter-01
chapter-02
```

as the actual identity.

Instead:

```text
id = 8c26...
order = [...]
```

The visible filename can remain friendly if desired.

---

# 14. Manuscript Ordering

Chapter order is stored in the project manifest.

Example:

```json
{
  "manuscript": {
    "order": ["ae321...", "6be94...", "3f289..."]
  }
}
```

Drag-and-drop reorder modifies only this sequence.

It should not rewrite every chapter file.

---

# 15. TipTap Schema

The editor must use a constrained semantic schema.

Initial node types:

```text
Document
Paragraph
ChapterTitle
Heading
BulletList
OrderedList
ListItem
SceneBreak
Blockquote
Epigraph
Image
HorizontalRule
HardBreak
```

Initial marks:

```text
Bold
Italic
Underline
Strike
Superscript
Subscript
Link
```

The implemented manuscript contract retains headings at levels 1-6, mixed
nested bullet/numbered lists, and link marks for absolute HTTP(S), email and
non-empty publication-fragment destinations. Epigraphs contain one or more
paragraphs and optional plain-text attribution. These are semantic structures;
theme styling is not persisted with them. See
[manuscript semantic elements](manuscript-semantics.md).

---

# 16. Paragraph Node

Standard paragraphs should support:

```text
text
marks
alignment where semantically allowed
```

Do not store:

```text
font size
font family
arbitrary margins
line height
colour
```

inside individual paragraphs unless a later feature explicitly requires it.

Formatting should primarily come from themes.

---

# 17. Scene Break Extension

A dedicated TipTap extension should be implemented.

Example conceptual node:

```typescript
{
  type: "sceneBreak";
}
```

The node should contain no visual representation data.

The theme determines whether it appears as:

```text
* * *
```

or:

```text
◆
```

or whitespace.

---

# 18. Epigraph Node

Example:

```typescript
{
    type: "epigraph",
    content: [
        {
            type: "paragraph",
            content: [...]
        }
    ]
}
```

Optional attributes:

```typescript
{
    attribution?: string
}
```

---

# 19. Image Node

Implemented by #113: strict block image attributes are `assetId`, `alt` and
semantic `size` (`small`, `medium`, `large`, `full`). The older example below is
design context; captions are not implemented. See [local image assets](local-image-assets.md).

Images should reference project assets rather than external filesystem paths.

Bad:

```text
C:\Users\Name\Desktop\picture.jpg
```

Good:

```text
assets/images/6c12....jpg
```

Node example:

```json
{
  "type": "image",
  "attrs": {
    "assetId": "6c12...",
    "alt": "Station exterior",
    "caption": ""
  }
}
```

---

# 20. Assets

Implemented #113 image records are per-asset versioned manifests at
`assets/images/<uuid>/asset.json`, alongside `original.png` or `original.jpg`.
They contain type, dimensions, original filename, byte size and SHA-256; locations
are derived rather than caller-supplied paths. The following general asset model
remains design guidance for future cover/font work, not the current image schema.

Assets should be registered in a manifest.

Example:

```typescript
export interface AssetRecord {
  id: string;

  type: "image" | "cover" | "font";

  path: string;

  mimeType: string;

  width?: number;
  height?: number;

  checksum: string;
}
```

Checksums can be used later for:

- duplicate detection;
- corruption detection;
- caching.

---

# 21. Renderer UI Structure

Suggested structure:

```text
renderer/
│
├── app/
│   ├── App.tsx
│   └── routes.ts
│
├── components/
│   ├── shell/
│   ├── editor/
│   ├── navigator/
│   ├── inspector/
│   ├── preview/
│   └── export/
│
├── state/
│
├── hooks/
│
├── services/
│
└── styles/
```

---

# 22. Application Shell

Primary layout:

```text
┌─────────────────────────────────────────────┐
│ Menu / Toolbar                              │
├────────────┬───────────────────┬────────────┤
│ Navigator  │ Editor            │ Inspector  │
│            │                   │            │
├────────────┴───────────────────┴────────────┤
│ Status Bar                                  │
└─────────────────────────────────────────────┘
```

Preview can replace or share the central workspace.

---

# 23. State Management

Use local React state where practical.

For shared application state, use a lightweight store.

Use Zustand for shared application state.

Example store slices:

```text
project
activeChapter
editor
layout
preview
export
```

Persistent manuscript state should not rely on the UI store.

The project files remain authoritative.

---

# 24. Editor State Flow

```text
Chapter File
     ↓
Load
     ↓
TipTap Document
     ↓
User edits
     ↓
Editor State
     ↓
Dirty flag
     ↓
Autosave
     ↓
Chapter File
```

The renderer should not write project files directly.

---

# 25. Dirty Tracking

Each open document should track:

```typescript
interface DocumentState {
  id: string;

  savedRevision: number;
  editorRevision: number;

  isDirty: boolean;

  lastSavedAt?: number;
}
```

A modification increments `editorRevision`.

After successful persistence:

```text
savedRevision = revisionCapturedForThisSuccessfulSave
```

---

A save acknowledgement must reference the revision actually written. Edits made during an in-flight save remain dirty. Serialize writes per document and prevent an older completion from overwriting newer content or clearing its dirty state. Test this race explicitly.

# 26. Autosave

Autosave should use debouncing.

Recommended initial delay:

```text
750 ms
```

Example:

```text
edit
edit
edit
   ↓
750 ms idle
   ↓
serialize
   ↓
save
```

Autosave should also be triggered when:

- switching chapter;
- losing application focus;
- closing project;
- closing application.

---

# 27. Atomic Writes

Never overwrite an important project file directly.

Use:

```text
chapter.json
     ↓
write chapter.json.tmp
     ↓
fsync if appropriate
     ↓
rename
     ↓
chapter.json
```

Where operating systems permit, rename should be atomic.

This greatly reduces corruption risk.

---

# 28. Backup Copies

Before replacing a valid document:

```text
chapter.json
     ↓
chapter.json.previous
```

or maintain snapshots within `.history`.

The previous known-good copy should survive a failed save.

---

# 29. History Service

Snapshots should not be generated for every keystroke.

Suggested strategy:

```text
Autosave:
frequent

History snapshot:
maximum once every 5 minutes while editing
```

Interval snapshots are stored as versioned JSON documents under
`.history/snapshots/<chapter-id>/`. Each snapshot records its UUID, chapter ID,
creation timestamp, reason and validated manuscript document. The history
service suppresses identical content and does not create another interval
snapshot within five minutes; snapshot write failures never replace or modify
the authoritative chapter file.

Retention removes only validated snapshot JSON files beneath `.history` using
the initial policy: keep every snapshot for 24 hours, retain at most one
snapshot per chapter and UTC hour through seven days, retain at most one per
UTC day through 30 days, and remove older snapshots. Invalid history files are
left untouched for inspection, and active manuscript files are never scanned or
deleted by retention.

Additionally create snapshots on:

```text
chapter marked final
manual snapshot
before major import
before migration
```

---

# 30. History Metadata

Example:

```typescript
interface HistorySnapshot {
  id: string;
  entityId: string;

  created: string;

  reason:
    "interval" | "manual" | "migration" | "before-import" | "status-change";

  path: string;
}
```

---

# 31. Crash Detection

Create an application-owned session marker at startup in Electron's
`app.getPath("userData")` directory. The current marker is schema version 1
and is written atomically:

```text
<userData>/session.json
```

Example:

```json
{
  "schemaVersion": 1,
  "sessionId": "...",
  "started": "...",
  "cleanShutdown": false
}
```

The desktop lifecycle service treats one marker as the authoritative session
for this application installation. A second startup reports an active previous
marker as unclean before replacing it with its own marker; concurrent launches
are not merged. Corrupt or unsupported markers are preserved and prevent
startup rather than being silently replaced.

On normal shutdown, after the quit request has been intercepted:

```text
cleanShutdown = true
```

Forced termination, process crashes and operating-system termination do not
reach the clean-marker write. At next startup, if a previous session is unclean:

```text
Check:
- temp files
- autosaves
- recent history snapshots
```

Then offer recovery.

Application quit is coordinated through a restricted main/preload handshake.
The main process intercepts the quit request, asks the renderer to flush pending
autosaves, and accepts a success response only from the trusted main frame. A
failed flush cancels the quit and leaves the marker unclean; the clean marker is
written only after the renderer confirms persistence.

---

# 32. Recovery

Recovery initially compares timestamps. After the session marker detects an
unclean shutdown, startup scans recent projects for valid chapter temporary
files (`manuscript/<chapter-id>.json.tmp`) and history snapshots under
`.history/snapshots/<chapter-id>/`. Candidate documents must pass the
versioned project schemas and must be newer than the persisted chapter's
`modified` timestamp. Invalid JSON/schema data, symlinks and paths outside
these bounded locations are ignored.

The scan is read-only and never overwrites an authoritative manuscript automatically.
The startup recovery dialog offers Recover, Discard and Cancel startup before
editing. Recovery saves a mandatory `before-recovery` history snapshot, then
atomically replaces the chapter through validated main/preload operations. Cancel
leaves the session unclean for the next launch. See [manuscript recovery](manuscript-recovery.md)
for failure ordering, compatibility and security details.

Possible workflow:

```text
Original chapter:
12:04:00

Recovery version:
12:07:32

Application crashed:
12:08:01
```

User sees:

```text
Unsaved recovery data found for Chapter 12.

[Recover]
[Compare]
[Discard]
```

A visual comparison can be introduced later.

---

# 33. Logging

Use structured logs.

Example:

```typescript
logger.info("chapter.saved", {
  projectId,
  chapterId,
  durationMs,
});
```

Do not log manuscript text.

Suggested levels:

```text
debug
info
warn
error
```

---

# 34. Error Model

Avoid throwing arbitrary strings.

Define application errors.

```typescript
export class ProjectError extends Error {
  constructor(
    public code: ProjectErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
  }
}
```

Example codes:

```text
PROJECT_NOT_FOUND
PROJECT_INVALID
PROJECT_VERSION_UNSUPPORTED
CHAPTER_NOT_FOUND
WRITE_FAILED
EXPORT_FAILED
VALIDATION_FAILED
```

---

# 35. Result Pattern

For expected failures:

```typescript
type Result<T, E = ApplicationError> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: E;
    };
```

This is useful across service and IPC boundaries.

---

# 36. Schema Versioning

The implemented V1 and V2 formats, compatibility rules, complete local migration
backup and recoverable multi-file commit are specified in
[project-format.md](project-format.md). V2 explicitly references component
versions; book/chapter content remains V1. Historical transformations must remain
stable as later publishing models are introduced.

Every persisted major object should include:

```json
{
  "schemaVersion": 1
}
```

When formats change:

```text
v1
 ↓
migration
 ↓
v2
```

Never silently interpret incompatible schema formats.

---

# 37. Migration Service

Example:

```typescript
interface Migration {
  from: number;
  to: number;

  migrate(projectPath: string): Promise<void>;
}
```

Before migration:

```text
Create complete project backup.
```

---

# 38. Project Service

Responsibilities:

```text
create project
open project
close project
load metadata
load chapter
save chapter
reorder chapters
create chapter
delete chapter
rename chapter
```

Example:

```typescript
interface ProjectService {
  create(options: CreateProjectOptions): Promise<ProjectSession>;

  open(projectPath: string): Promise<ProjectSession>;

  getChapter(id: string): Promise<ChapterFile>;

  saveChapter(chapter: ChapterFile): Promise<void>;
}
```

---

# 39. Project Session

An open project should be represented in memory.

```typescript
interface ProjectSession {
  projectPath: string;

  project: ProjectConfig;

  metadata: BookMetadata;

  chapters: ChapterSummary[];
}
```

Do not load every chapter body by default.

Load content on demand.

---

# 40. Chapter Summary

```typescript
interface ChapterSummary {
  id: string;
  title: string;
  type: ChapterType;
  status: ChapterStatus;

  wordCount: number;

  modified: string;
}
```

This supports the navigator without loading full chapter contents.

---

# 41. Word Counting

Word count should be calculated from editor text content rather than serialized JSON.

Create a common utility so:

```text
Editor count
Navigator count
Book total
Export statistics
```

all use the same algorithm.

---

# 42. Book Renderer

Implemented by #121: `packages/core` assembles a consistent saved `BookRevision`
under the existing project lock. `packages/renderer` serializes all supported
semantics into deterministic XHTML-compatible chapter fragments. Preview, EPUB
and print consume this single traversal through asset/link resolvers and separate
wrappers/styles. See [the rendering contract and support matrix](book-rendering.md).
The older conceptual interfaces below describe future orchestration, not separate
semantic renderers. The implemented version-1 Community theme model, deterministic
ebook/print CSS and project-side selection are described in [book themes](book-themes.md);
the later conceptual theme interfaces are future design, not a custom-CSS API.

```typescript
interface BookRenderer {
  renderChapter(chapter: ChapterFile, context: RenderContext): Promise<string>;

  renderBook(
    project: ProjectSession,
    context: RenderContext,
  ): Promise<RenderedBook>;
}
```

---

# 43. Render Context

```typescript
interface RenderContext {
  target: "ebook" | "print" | "preview";

  theme: BookTheme;

  metadata: BookMetadata;

  assetResolver: AssetResolver;
}
```

---

# 44. Theme Model

Example:

```typescript
interface BookTheme {
  id: string;
  name: string;

  typography: {
    bodyFamily: string;
    headingFamily: string;

    bodySize: string;
    lineHeight: number;
  };

  paragraphs: {
    indent: string;
    spacing: string;
  };

  sceneBreak: {
    type: "stars" | "diamond" | "space" | "custom";

    value?: string;
  };
}
```

Themes should ultimately produce CSS.

---

# 45. Ebook Rendering

Ebook renderer output:

```text
XHTML
CSS
Images
Navigation
Metadata
```

Each chapter becomes a separate XHTML document.

Example:

```text
chapter-001.xhtml
chapter-002.xhtml
chapter-003.xhtml
```

---

# 46. XHTML Generation

TipTap/ProseMirror nodes should map explicitly to XHTML.

Example:

```text
paragraph
→ <p>

blockquote
→ <blockquote>

sceneBreak
→ <div class="scene-break" role="separator">

image
→ <figure>
```

Avoid reusing raw editor DOM output without sanitisation.

---

# 47. EPUB Package Structure

```text
mimetype

META-INF/
    container.xml

EPUB/
    package.opf
    nav.xhtml
    styles/
        book.css
    text/
        chapter-001.xhtml
    images/
        cover.jpg
```

The `mimetype` file must be stored according to EPUB packaging requirements.

---

# 48. EPUB Generator

Suggested interface:

```typescript
interface EpubExporter {
  export(
    project: ProjectSession,
    options: EpubExportOptions,
  ): Promise<ExportResult>;
}
```

Options:

```typescript
interface EpubExportOptions {
  outputPath: string;
  themeId: string;

  includeCover: boolean;
}
```

---

# 49. EPUB Validation

Validation should initially include internal checks.

Examples:

```text
manifest references exist
spine references exist
navigation references exist
duplicate IDs absent
required metadata exists
XHTML well formed
assets exist
```

A standards-compliant external EPUB validator can later be integrated into the export pipeline.

---

# 50. Print Rendering

Print rendering pipeline:

```text
Manuscript
     ↓
Semantic Renderer
     ↓
Print HTML
     ↓
Theme CSS
     ↓
Paged Media CSS
     ↓
Chromium
     ↓
PDF
```

---

# 51. Print Document

Generate one complete print HTML document.

Example:

```html
<html>
  <head>
    <link rel="stylesheet" href="book.css" />
    <link rel="stylesheet" href="print.css" />
  </head>

  <body>
    <section class="frontmatter">...</section>

    <section class="chapter">...</section>

    <section class="chapter">...</section>
  </body>
</html>
```

---

# 52. Print Settings

Implemented by #128 as optional version-1 `print.json`. The persistent envelope
is owned by `packages/project-model`; `packages/shared` exposes the renderer-safe
`PrintSettingsSchema`, DTOs, unit conversions and mirrored geometry helper.
`packages/core` owns path validation, defaulting, stale-revision checks, the
project lock and atomic persistence. Desktop uses restricted validated IPC.

The model stores integer micrometres for trim width/height, mirrored
inside/outside/top/bottom margins and additional gutter. Unit preference is
`in` or `mm`; it does not change physical dimensions. Chapter starts, semantic
verso/recto headers and footer page-number behavior remain independent of
manuscript and ebook configuration. Missing components default without writes;
unknown/newer data blocks print operations without replacement. No existing
project schema bump or destructive migration is required.

See [implemented settings, limits, semantics, fonts and recovery](print-settings.md).
Issue #129 implements the [local PDF pipeline and preview](print-preview.md) using
Electron's bundled Chromium for section fragmentation, PDF assembly for running
matter and PDF.js for the actual PDF preview. This refines the original
single-document/Playwright-adapter proposal without a second layout path.
The paged-CSS/PDF examples in subsequent sections remain broader design guidance,
not evidence of implemented pagination.

---

# 53. Trim Presets

Implemented Community presets: 5 × 8, 5.25 × 8, 5.5 × 8.5 and 6 × 9 inches,
plus A5 (148 × 210 mm), with custom dimensions. `PRINT_TRIM_PRESETS` is the
single typed catalogue; persisted preset dimensions must match it exactly.
No publishing-platform rules are embedded in the general trim model.

---

# 54. Paged CSS

Generated CSS may include:

```css
@page {
  size: 6in 9in;

  margin-top: 0.75in;
  margin-bottom: 0.75in;
}

@page :left {
  margin-left: 0.6in;
  margin-right: 0.85in;
}

@page :right {
  margin-left: 0.85in;
  margin-right: 0.6in;
}
```

---

# 55. Chapter Rules

```css
.chapter {
  break-before: page;
}

.chapter.recto {
  break-before: right;
}

.chapter-title {
  break-after: avoid;
}
```

Exact behaviour must be verified against Chromium.

---

# 56. Widow and Orphan Handling

Default:

```css
p {
  widows: 2;
  orphans: 2;
}
```

This helps but should not be assumed to solve all professional layout cases.

Later versions may add manual page-break hints.

---

# 57. Playwright PDF Service

The print package should abstract browser automation.

```typescript
interface PdfRenderer {
  render(
    htmlPath: string,
    options: PrintSettings,
    outputPath: string,
  ): Promise<PdfRenderResult>;
}
```

Implementation concept:

```typescript
const browser = await chromium.launch({
  headless: true,
});

const page = await browser.newPage();

await page.goto(pathToFileURL(htmlPath).href);

await page.pdf({
  path: outputPath,
  printBackground: true,
  preferCSSPageSize: true,
});

await browser.close();
```

---

# 58. Renderer Lifecycle

Do not launch a new browser process unnecessarily for every preview refresh.

For live preview:

```text
Reuse rendering environment
```

For final export:

```text
Use isolated export context
```

This helps keep preview fast while ensuring exports are deterministic.

---

# 59. Print Preview

Two possible approaches exist.

## Initial approach

Render the same HTML/CSS into an embedded browser view.

Advantages:

```text
fast
interactive
simple
```

## Later approach

Generate low-resolution preview PDFs or rendered page images.

Advantages:

```text
closer to final pagination
```

For v0.2, use HTML preview.

---

# 60. Export Pipeline

General export orchestration:

```text
User requests export
       ↓
Save dirty documents
       ↓
Validate project
       ↓
Render
       ↓
Validate generated output
       ↓
Write destination
       ↓
Return result
```

Never export from stale editor state.

---

# 61. Export Progress

Exports should provide observable stages.

Example:

```text
Preparing manuscript
Rendering chapters
Processing images
Building EPUB
Validating EPUB
Complete
```

For print:

```text
Preparing manuscript
Rendering HTML
Loading Chromium
Generating PDF
Validating PDF
Complete
```

---

# 62. Validation Result

```typescript
interface ValidationResult {
  valid: boolean;

  issues: ValidationIssue[];
}
```

---

# 63. Validation Issue

```typescript
interface ValidationIssue {
  severity: "info" | "warning" | "error";

  code: string;

  message: string;

  entityId?: string;

  location?: {
    chapterId?: string;
    nodeId?: string;
  };
}
```

---

# 64. Blocking Rules

Exports may proceed with warnings.

Exports must stop on errors.

Example:

```text
WARNING
Cover resolution may be low.

ERROR
Image referenced by Chapter 4 does not exist.
```

---

# 65. Reference Data

Reference data belongs outside manuscript exports.

Directory:

```text
reference/
│
├── characters/
├── locations/
├── timeline/
├── canon/
└── notes/
```

---

# 66. Character Model

```typescript
interface CharacterRecord {
  id: string;

  name: string;

  aliases: string[];

  role?: string;

  description?: string;
  appearance?: string;
  personality?: string;
  background?: string;

  notes?: string;

  tags: string[];
}
```

---

# 67. Location Model

```typescript
interface LocationRecord {
  id: string;

  name: string;

  type?: string;

  description?: string;

  notes?: string;

  tags: string[];
}
```

---

# 68. Canon Model

```typescript
interface CanonRecord {
  id: string;

  title: string;

  category:
    | "character"
    | "technology"
    | "location"
    | "history"
    | "relationship"
    | "terminology"
    | "other";

  statement: string;

  notes?: string;

  tags: string[];
}
```

---

# 69. Timeline Model

```typescript
interface TimelineEvent {
  id: string;

  title: string;

  date?: string;

  sequence?: number;

  description?: string;

  chapterIds: string[];

  characterIds: string[];

  locationIds: string[];
}
```

---

# 70. Search Architecture

Initial search may simply index:

```text
chapter text
chapter titles
character names
locations
canon notes
timeline
```

For small novels, in-memory search is sufficient.

Later:

```text
SQLite FTS
```

can be introduced for larger projects.

---

# 71. SQLite

SQLite is optional in the initial milestone.

The source of truth should remain project files.

SQLite may later be used as an index/cache for:

```text
search
statistics
cross references
recent project metadata
```

It should be rebuildable from project files.

---

# 72. Recent Projects

Application-level settings should live separately from book projects.

Example:

```text
userData/
    settings.json
    recent-projects.json
```

Do not put machine-specific recent paths into project metadata.

---

# 73. Application Settings

Potential settings:

```typescript
interface AppSettings {
  theme: "system" | "light" | "dark";

  autosaveDelayMs: number;

  historyEnabled: boolean;

  defaultLanguage: string;

  editor: {
    showWordCount: boolean;
    typewriterMode: boolean;
  };
}
```

---

# 74. Editor Preferences

Editor presentation preferences must not modify the manuscript format.

Examples:

```text
editor font
editor font size
dark mode
line width
focus mode
```

These are writing-environment settings, not publication formatting.

---

# 75. Command Architecture

Actions should be represented as commands rather than tightly coupled UI callbacks.

The initial Electron menu is installed by the main process and exposes New
Project, Open Project, Save, Close Project and Exit with native Edit, View and
Help menus. New/Open/Close requests cross the restricted preload API as
allowlisted commands; Save reuses the existing save request. The renderer keeps
project transitions behind its existing dirty-state guard. Closing a project
clears its privileged main-process access only after the renderer confirms it
can leave the active chapter. Windows/Linux show Exit in File; macOS uses its
standard application menu for Quit and does not duplicate Exit there.

Examples:

```text
project.new
project.open
project.save
chapter.new
chapter.delete
chapter.rename
chapter.move
insert.sceneBreak
export.epub
export.pdf
```

This makes it easier to connect:

```text
menus
keyboard shortcuts
command palette
toolbar
```

to the same actions.

---

# 76. Command Palette

A command palette can be added relatively early.

Shortcut:

```text
Ctrl/Cmd + Shift + P
```

Examples:

```text
New Chapter
Insert Scene Break
Open Print Preview
Export EPUB
Open Character Record
```

---

# 77. Keyboard Shortcuts

Platform-aware shortcuts should be implemented.

Example:

```text
Windows/Linux      macOS

Ctrl+S             Cmd+S
Ctrl+B             Cmd+B
Ctrl+I             Cmd+I
Ctrl+F             Cmd+F
```

Electron menu accelerators can provide many native behaviours.

---

# 78. Undo and Redo

TipTap/ProseMirror provides editor history.

Undo applies to the active chapter editing session.

Persistent history snapshots are separate.

Do not confuse:

```text
Editor undo
```

with:

```text
Project revision history
```

---

# 79. Clipboard Handling

Pasted content should be sanitised.

When content is pasted from Word or websites:

```text
remove unsupported fonts
remove colours
remove arbitrary margins
map bold → Bold mark
map italic → Italic mark
map paragraphs → Paragraph node
```

This is essential to maintaining semantic document integrity.

---

# 80. Import Architecture

Import should produce normal project structures.

Interface:

```typescript
interface ManuscriptImporter {
  canImport(path: string): boolean;

  import(path: string): Promise<ImportedManuscript>;
}
```

Planned v0.2 implementations:

```text
DocxImporter
MarkdownImporter
PlainTextImporter
HtmlImporter
```

Built-in importers belong in Community and do not require a plugin runtime. Parse locally behind restricted IPC into a bounded, validated intermediate model with metadata, chapters, assets and located warnings. Inspect/preview and commit are separate operations. Imports commit to a new empty destination and preserve source files and the active project on cancellation or failure. No external relationship, macro, script or remote resource executes.

---

# 81. Markdown Import

Potential mappings:

```text
# Heading
→ chapter title or heading

paragraph
→ paragraph

* * *
→ scene break

> quote
→ blockquote

*italic*
→ italic
```

Chapter splitting rules should be user-configurable later.

---

# 82. DOCX Import

Basic DOCX import is scheduled for v0.2 after the reliable v0.1 foundation; basic editable manuscript DOCX export follows by v0.3. Both are Community capabilities and run offline. Exact Word page-layout fidelity is not promised. See the [local publishing plan](planning/local-publishing-plan.md) for issue dependencies.

When implemented:

```text
DOCX
 ↓
parse document.xml
 ↓
style interpretation
 ↓
semantic mapping
 ↓
TipTap document
```

The importer must report located warnings for unsupported formatting and structures, including tracked changes, comments, tables and notes. Preserve recoverable text or block conversion pending an explicit choice; never silently omit author content. Bound ZIP expansion and XML parsing, disable external entities, and never fetch relationships. Detect unsupported/encrypted inputs and keep the source unchanged.

Export DOCX from a consistent saved manuscript revision to an atomic local output. Maintain an explicit support matrix and verify supported content by independent OOXML inspection and re-import. DOCX is interchange, never the authoritative project format.

Optional remote backup remains a separate research task. Evaluate Google Drive, Wasabi/S3-compatible storage and user-owned Git repositories. Storage providers transfer immutable validated project archives; Git research compares archive commits with validated staged project snapshots. Restore always targets a new location. Live project-folder synchronization, cloud editing, hosted conversion and collaboration are outside the current roadmap. Provider unavailability must never prevent local authoring or publishing; credentials must remain outside project files and renderer access.

---

# 83. Testing Architecture

Use several categories.

```text
Unit
Integration
Rendering
Golden-file
End-to-end
```

---

# 84. Unit Tests

Test small deterministic behaviours.

Examples:

```text
chapter ordering
word count
asset lookup
metadata validation
scene break rendering
theme CSS generation
path handling
schema migration
```

---

# 85. Golden Rendering Tests

Given a fixed chapter model:

```text
input.json
```

expect:

```text
expected.xhtml
expected.print.html
```

If renderer output changes unexpectedly, tests fail.

This will help protect EPUB and PDF generation from regressions.

---

# 86. Project Fixtures

Create fixture projects.

Examples:

```text
minimal-book
long-novel
images-book
frontmatter-book
unicode-book
invalid-book
```

These should be used across multiple test suites.

---

# 87. End-to-End Tests

Use Playwright to automate the desktop application where practical.

Core scenario:

```text
Launch app
↓
Create project
↓
Add chapter
↓
Enter manuscript
↓
Save
↓
Restart
↓
Reopen
↓
Verify text
↓
Export EPUB
↓
Export PDF
```

---

# 88. Export Regression Tests

A known manuscript should generate stable logical output.

EPUB:

```text
package structure
XHTML content
navigation
metadata
```

PDF:

```text
page dimensions
page count where stable
chapter presence
font embedding where measurable
```

Binary files should not necessarily be compared byte-for-byte.

---

# 89. CI

Continuous integration should run:

```text
lint
typecheck
unit tests
integration tests
build
```

Per-platform packaging can later run on:

```text
Windows
macOS
Linux
```

---

# 90. Build Outputs

Expected installer formats:

```text
Windows
.exe installer

macOS
.dmg

Linux
.AppImage
.deb
```

Final packaging tool can be selected later.

---

# 91. Development Environment

Required:

```text
Node.js
pnpm
Git
```

Recommended editor:

```text
Visual Studio Code
```

Optional:

```text
GitHub Desktop
```

---

# 92. Code Quality

Use:

```text
ESLint
Prettier
TypeScript strict mode
```

Recommended:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Strictness will reduce persistence and migration bugs.

---

# 93. Dependency Boundaries

Important dependency direction:

```text
shared
   ↑
project-model
   ↑
core
   ↑
desktop
```

Rendering/export packages may depend on:

```text
project-model
editor-schema
shared
```

The core model must not depend on Electron.

---

# 94. UI Dependency Rule

React components should not directly access project files.

Bad:

```text
Component
 → filesystem
```

Good:

```text
Component
 → UI service
 → preload API
 → IPC
 → ProjectService
 → filesystem
```

---

# 95. Renderer Dependency Rule

The EPUB and print renderers should not know about React.

They operate on project models.

```text
Project Model
      ↓
Renderer
      ↓
HTML/XHTML
```

This allows renderer testing without launching the desktop application.

---

# 96. Performance Targets

The initial application should remain responsive for books containing at least:

```text
150,000 words
100+ chapters
hundreds of notes
hundreds of reference records
```

Only the active chapter should normally be loaded into TipTap.

---

# 97. Large Chapter Handling

Individual very large chapters should remain usable.

Avoid continuously serializing the whole book.

Autosave should serialize only:

```text
active chapter
```

unless project metadata changed.

---

# 98. Export Isolation

Export should work from persisted project state.

Recommended sequence:

```text
flush editor
↓
persist chapter
↓
load project from disk
↓
export
```

This verifies that the on-disk project is itself complete.

---

# 99. Temporary Export Workspace

Exports should use a temporary build directory.

Example:

```text
tmp/
  export-34f9/
      html/
      css/
      images/
```

After successful export:

```text
copy final artifact
↓
remove temporary directory
```

Keep failed export folders optionally available in debug mode.

---

# 100. File Naming

Do not generate filenames directly from unsanitised user input.

Example:

```text
"The Question: Part 1"
```

should not become an unsafe filesystem path.

Use a safe slug helper.

Example:

```text
the-question-part-1.xhtml
```

Identity remains UUID-based internally.

---

# 101. Unicode

The entire application should assume Unicode.

Use UTF-8 for textual project files.

Test:

```text
smart quotes
em dashes
accented characters
non-Latin text
emoji
```

even if initial publication focus is English.

---

# 102. Accessibility

Application UI should support:

```text
keyboard navigation
visible focus
screen-reader labels
sufficient contrast
semantic controls
```

Editor accessibility should be verified rather than assumed.

---

# 103. Initial Development Milestones

## Milestone 1 — Application Skeleton

Deliver:

```text
Electron
React
TypeScript
workspace structure
main window
preload API
basic menus
logging
```

Success criterion:

> Application launches on Windows and renderer has no direct Node access.

---

## Milestone 2 — Project Creation

Deliver:

```text
Create Project
Open Project
project.json
book.json
project validation
recent projects
```

Success criterion:

> User can create, close and reopen an empty project.

---

## Milestone 3 — Chapters

Deliver:

```text
create chapter
rename chapter
delete chapter
reorder chapter
chapter summaries
```

Success criterion:

> Project structure survives restart correctly.

---

## Milestone 4 — TipTap Editor

Deliver:

```text
paragraphs
bold
italic
headings
scene breaks
blockquotes
undo
redo
```

Success criterion:

> A chapter can be written, persisted and reopened without formatting loss.

---

## Milestone 5 — Autosave and Recovery

Deliver:

```text
dirty tracking
autosave
atomic writes
history snapshots
crash marker
recovery workflow
```

Success criterion:

> Force-closing the application does not lose more than a small amount of recent editing.

---

## Milestone 6 — Book Preview

Deliver:

```text
semantic HTML renderer
book themes
ebook-style preview
chapter navigation
```

Success criterion:

> Manuscript can be previewed independently from editor styling.

---

## Milestone 7 — EPUB Export

Deliver:

```text
XHTML renderer
CSS
metadata
navigation
cover
EPUB archive
validation
```

Success criterion:

> A normal fiction project exports as a valid EPUB that opens correctly in major readers.

---

## Milestone 8 — Print Preview

Deliver:

```text
print renderer
trim presets
mirrored margins
chapter starts
headers
footers
page numbering
```

Success criterion:

> Print preview closely represents expected paperback layout.

---

## Milestone 9 — PDF Export

Deliver:

```text
Playwright service
Chromium printing
PDF configuration
export validation
```

Success criterion:

> A 6 × 9 inch paperback interior is generated with correct page size and mirrored margins.

---

## Milestone 10 — Story Bible

Deliver:

```text
characters
locations
timeline
canon
notes
search
```

Success criterion:

> Reference content can be managed without affecting manuscript exports.

---

# 104. First Implementation Slice

The first coding slice should be intentionally small.

Implement only:

```text
Electron window
React shell
New Project
Open Project
Create Chapter
TipTap editor
Save Chapter
Autosave
```

Do not begin with:

```text
EPUB
PDF
AI
timeline
character database
cloud
plugins
```

The editor must become dependable first.

---

# 105. First Repository Target

After the first slice, the repository should approximately resemble:

```text
@drelwick/
│
├── apps/
│   └── desktop/
│       └── src/
│           ├── main/
│           │   ├── main.ts
│           │   ├── project-service.ts
│           │   └── ipc.ts
│           │
│           ├── preload/
│           │   └── preload.ts
│           │
│           └── renderer/
│               ├── App.tsx
│               ├── ProjectNavigator.tsx
│               └── ManuscriptEditor.tsx
│
├── packages/
│   ├── project-model/
│   ├── editor-schema/
│   └── shared/
│
└── tests/
```

---

# 106. Initial Project Workflow

The first working experience should be:

```text
Launch
   ↓
New Project
   ↓
Title
Author
Location
   ↓
Create
   ↓
New Chapter
   ↓
Write
   ↓
Autosave
   ↓
Close
   ↓
Reopen
   ↓
Continue writing
```

If this is reliable, the architectural foundation is sound.

---

# 107. Example Project Creation

User enters:

```text
Title:
The Tannhauser Project

Author:
Astrid Drake

Location:
D:\Books\Tannhauser
```

Application creates:

```text
Tannhauser/
│
├── project.json
├── book.json
├── manuscript/
├── frontmatter/
├── backmatter/
├── assets/
├── reference/
├── styles/
└── .history/
```

Then creates the first chapter.

---

# 108. Example Chapter File

```json
{
  "schemaVersion": 1,
  "id": "1da457d4-8c72-45a2-a1a6-9cc03aa381d3",
  "type": "chapter",
  "title": "Arrival",
  "status": "draft",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Aeon looked through the observation window."
          }
        ]
      }
    ]
  },
  "created": "2026-09-12T12:00:00Z",
  "modified": "2026-09-12T12:05:00Z"
}
```

---

# 109. Example Scene Break

```json
{
  "type": "sceneBreak"
}
```

No stars or decorative glyphs are stored in the manuscript.

---

# 110. Example Render

The print theme may transform:

```json
{
  "type": "sceneBreak"
}
```

into:

```html
<div class="scene-break" aria-hidden="true">◆</div>
```

while an ebook theme may transform it into:

```html
<div class="scene-break" role="separator">* * *</div>
```

---

# 111. Development Priorities

Priority order should be:

```text
1. Reliability
2. Data integrity
3. Writing experience
4. Portability
5. Rendering correctness
6. Publishing features
7. Advanced authoring features
8. AI
```

This order should remain visible throughout development.

---

# 112. Data Integrity Rule

The project files belong to the author.

The application must never require its database in order to recover the manuscript.

At minimum, someone should be able to inspect:

```text
project files
chapter JSON
assets
metadata
```

without launching the editor.

A future export-to-plain-text recovery utility can provide additional protection.

---

# 113. AI Boundary

AI integrations should eventually consume explicit copies of relevant manuscript or reference data.

AI components should not receive unrestricted project filesystem access.

Potential architecture:

```text
User command
   ↓
Context Builder
   ↓
Selected manuscript/reference data
   ↓
AI provider
   ↓
Suggestion
   ↓
User review
   ↓
Optional application
```

No silent manuscript modifications.

---

# 114. Future Plugin System

The [Community extension architecture](extension-architecture.md) is the detailed
design for #57. Public contracts are owned by Community and shared by future Pro
and third-party consumers, subject to host trust and capability policy.

Designed categories:

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

The future `packages/plugin-sdk` will contain only reviewed public DTOs/contracts,
without desktop/core implementation dependencies. It is not created yet: current
internal exports are not a stable plugin API. Declarative themes/profiles do not
need executable access; import/export use scoped inputs and staged output;
validators cannot override Community integrity checks; editor tools propose
controlled transactions; reference tools and AI require explicit context and
separate permission for any network use. No public filesystem, process, Node,
Electron or secret-read API is provided.

Runtime enforcement, installation/distribution, schema evolution for external
theme IDs and credential/network brokers are separately gated future work. The
[acceptance review](planning/57-extension-review.md) distinguishes those gaps from
the current DOCX staging, semantic renderer and local persistence evidence. Basic
Community operation never requires a plugin runtime. This design does not create
Pro, decide plugin licensing or authorize public contributions.

---

# 115. Definition of v0.1

Version 0.1 is complete when a user can:

```text
install application
create project
create chapters
write formatted prose
insert scene breaks
reorder chapters
close application
reopen project
recover from an abnormal shutdown
```

without losing manuscript content.

No EPUB or PDF support is required for v0.1.

---

# 116. Definition of v0.3

Version 0.3 is complete when a user can:

```text
write novel
configure metadata
add cover
preview ebook
export EPUB 3
validate export
```

without using Kindle Create.

This is the first milestone where the application can function as a practical Kindle Create replacement for standard fiction manuscripts.

---

# 117. Definition of v0.4

Version 0.4 is complete when a user can additionally:

```text
select paperback trim size
configure margins
preview facing pages
generate print PDF
validate page dimensions
```

This creates the complete ebook + paperback publishing workflow.

---

# 118. Recommended Implementation Decision Summary

Use:

```text
Electron
TypeScript
React
TipTap / ProseMirror
Zod
Zustand
pnpm workspaces
HTML / CSS rendering
Playwright
Chromium
EPUB 3
```

Persist author work using:

```text
JSON
HTML/XHTML during rendering
CSS
standard image formats
```

Avoid:

```text
binary manuscript formats
renderer filesystem access
arbitrary formatting
database-only storage
early cloud dependency
early AI dependency
```

---

# 119. Final Architecture

```text
                    ┌─────────────────┐
                    │    Electron     │
                    └────────┬────────┘
                             │
                   ┌─────────▼─────────┐
                   │      React        │
                   │                  │
                   │ Navigator Editor │
                   │ Preview   Notes  │
                   └─────────┬─────────┘
                             │
                         Preload API
                             │
                             ▼
                   ┌───────────────────┐
                   │ Application Core  │
                   └─────────┬─────────┘
                             │
             ┌───────────────┼───────────────┐
             │               │               │
             ▼               ▼               ▼
        Project Model   Reference Model    Assets
             │
             ▼
       Semantic Renderer
             │
       ┌─────┴─────────────┐
       │                   │
       ▼                   ▼
   EPUB Renderer        Print Renderer
       │                   │
       ▼                   ▼
     XHTML               HTML/CSS
       │                   │
       ▼                   ▼
     EPUB              Chromium
                           │
                           ▼
                       Playwright
                           │
                           ▼
                          PDF
```

---

# 120. Next Development Artifact

The [v0.1 build plan](planning/v0.1-build-plan.md) now exists; use its [GitHub tracking register](planning/github-tracking.md) for implementation issues and real dependencies.

That document should break Milestones 1–5 into individual coding tasks, including:

```text
repository bootstrap
Electron configuration
React setup
IPC layer
project schemas
project service
TipTap extensions
chapter navigator
autosave
atomic persistence
history
recovery
unit tests
end-to-end tests
```

Each task should include:

```text
objective
files to create
interfaces
acceptance criteria
tests
dependencies
```

That would make the project suitable for direct implementation by a developer or coding agent.
