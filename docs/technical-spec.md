# Cross-Platform Book Editor

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

The current [open-core decision](design.md#current-product-decision--september-2026) and [audit](planning/repository-audit.md) apply throughout this specification. Community packages may expose public extension interfaces; they must never import or require Pro. `packages/print` and `packages/validation` supply basic Community publishing. Advanced professional modules belong in the eventual separate Pro codebase. `packages/plugin-sdk` is a future Community interface package, not a v0.1 runtime requirement.

The snippets below illustrate architecture rather than defining a complete wire format. All persisted objects (including settings, history and session metadata) require explicit schema versions, directly or through a versioned envelope. Schema changes require compatibility and migration consideration. The public format specification is commercial task 57.

Use immutable UUIDs and manifest ordering; short `chapter-001`/`0f23...` placeholders below are explanatory, not valid identities. Service logic belongs in `packages/core` where independent of Electron; main-process services adapt platform/IPC/lifecycle operations rather than duplicating business logic. Shared renderer-safe types must not pull privileged file helpers into renderer bundles.

The v0.1 build plan defines the minimal editor schema (text/paragraphs, bold/italic, undo/redo, scene breaks and block quotes). Later nodes/marks shown here are not all required initially. Extension API design/security/versioning precede public contributions; runtime distribution may remain later work. v0.2 HTML print preview is approximate until pagination is validated against generated output.

# 1. Purpose

This document defines the implementation architecture for the Cross-Platform Book Editor described in the Software Design Document.

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
book-editor/
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
export interface BookEditorApi {
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
contextBridge.exposeInMainWorld("bookEditor", api);
```

The renderer should use:

```typescript
window.bookEditor.project.open();
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
```

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

---

# 32. Recovery

Recovery should initially compare timestamps.

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

Create a generic rendering pipeline.

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

```typescript
interface PrintSettings {
  trim: {
    width: string;
    height: string;
  };

  margins: {
    top: string;
    bottom: string;
    inside: string;
    outside: string;
  };

  chapters: {
    startOnRecto: boolean;
    hidePageNumberOnOpening: boolean;
  };

  headers: {
    enabled: boolean;
  };

  pageNumbers: {
    enabled: boolean;
  };
}
```

---

# 53. Trim Presets

```typescript
const trimPresets = {
  "5x8": {
    width: "5in",
    height: "8in",
  },

  "5.25x8": {
    width: "5.25in",
    height: "8in",
  },

  "5.5x8.5": {
    width: "5.5in",
    height: "8.5in",
  },

  "6x9": {
    width: "6in",
    height: "9in",
  },
};
```

Do not hard-code publishing-platform rules into the general trim model.

Those should live in separate validation presets.

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

Initial implementations:

```text
MarkdownImporter
PlainTextImporter
HtmlImporter
```

Later:

```text
DocxImporter
```

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

DOCX support should not be included in the earliest milestone.

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

The importer should warn when formatting cannot be reliably interpreted.

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
book-editor/
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

If plugins are introduced later, they should operate through a restricted application API.

Potential plugin categories:

```text
Importer
Exporter
Validator
Theme
Editor Tool
Reference Tool
AI Provider
```

Plugin runtime/distribution is deferred; public extension API architecture is planned before external contributions through commercial tasks 54 and 56. This does not require a Pro repository or plugin implementation in v0.1.

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
