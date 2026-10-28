# Drelwick

## Software Design Document

**Status:** Initial Design\
**Version:** 0.1\
**Target Platforms:** Windows, macOS, Linux\
**Primary Stack:** Electron, TypeScript, React, TipTap/ProseMirror, HTML/CSS, Playwright\
**Primary Outputs:** EPUB 3, Print-Ready PDF

---

## Current product decision — September 2026

Drelwick is a cross-platform, local-first, open-core authoring and publishing application in private development. Community is intended for public release; Pro is planned as a separate private commercial product. The owner selected `AGPL-3.0-only` for Community, with legal review and final licensing approval pending under #53. Contributor/copyright strategy, dual licensing and trademarks require appropriate review before public release. Do not accept external contributions until #54 and the Licensing & Commercial Architecture milestone are complete. See the [central notices](../COPYRIGHT.md) and [release gate](planning/public-release-checklist.md).

The dependency direction is always `Drelwick Pro -> Drelwick Community`. Community must build and test with no Pro repository present. No Pro repository is required during the v0.1 foundation. Manuscript/project files belong to the author and remain authoritative, recoverable outside the application and usable without cloud connectivity. EPUB/PDF are generated outputs, never editable master documents.

| Classification | Product scope                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CORE           | Manuscript editing; project/chapter management; semantic formatting; autosave; recovery; history; basic local DOCX import and manuscript export; portable local backup/restore; basic themes; ebook/print preview; EPUB 3; basic publishable print PDF; open project format; public extension APIs; basic local story bible CRUD/search/chapter links. |
| PRO            | Potential advanced typography, KDP profiles/preflight, paperback/hardcover validation, automatic gutters, bleed/DPI analysis, advanced headers/page numbering/chapter openings, premium themes, advanced Word layout fidelity if separately designed, professional publishing reports.                                                                 |
| SERVICE        | Optional hosted functionality with continuing operating costs. Basic local authoring never requires it.                                                                                                                                                                                                                                                |
| ECOSYSTEM      | Third-party themes/plugins/extensions. The Community API they use remains CORE.                                                                                                                                                                                                                                                                        |

Community must be capable of producing a normal publishable novel. Pro monetises additional professional convenience, not artificial restrictions on authors' manuscripts. Per the 2 October owner decision, final allocation follows private working-app evaluation #203 and then #52 (commercial task 51); existing CORE scope proceeds now. Advanced continuity, series management and editorial tools are unallocated review candidates; ordinary publishable PDF output and basic validation cannot require Pro. A feature appearing later in this document describes product capability, not an automatic assignment to Community or to v0.1.

The [commercial addendum](planning/commercial-architecture-addendum.md), [audit](planning/repository-audit.md) and [development guardrails](development.md) reconcile the original baseline. The v0.1 plan governs initial delivery scope; broader schema, publishing and plugin-runtime examples are future work.

# 1. Overview

## 1.1 Purpose

Drelwick is a cross-platform desktop authoring, formatting, preview and publishing application designed primarily for fiction and long-form prose.

The application provides an alternative to tools such as Kindle Create while avoiding dependence on proprietary manuscript formats.

The core workflow is:

```text
Write
  ↓
Organise
  ↓
Format Semantically
  ↓
Preview
  ↓
Validate
  ↓
Export
  ├── EPUB 3
  └── Print PDF
```

The same underlying manuscript will be used for both ebook and print production.

The application should favour reliability, portability and predictable book formatting over unrestricted word-processing functionality.

---

# 2. Design Principles

## 2.1 Semantic Editing

The editor should describe what content **is**, rather than how individual pieces of text happen to look.

For example:

```text
Chapter Title
Paragraph
Scene Break
Block Quote
Epigraph
Image
```

rather than:

```text
18pt Times New Roman
Bold
Centre aligned
24px margin
```

Book themes determine the visual representation of semantic elements.

This separation allows the same manuscript to be rendered appropriately for EPUB, screen preview and print.

---

## 2.2 Open Project Format

Projects must not depend on an undocumented proprietary binary format.

A manuscript should remain recoverable even if the application itself is unavailable.

Project contents should use common formats such as:

- JSON
- HTML
- Markdown where appropriate
- CSS
- JPEG/PNG/WebP
- SVG where supported

Projects should also be suitable for version control systems such as Git.

---

## 2.3 Local First

The initial application will operate entirely locally.

No account or cloud service will be required.

The application must support:

- local projects;
- offline editing;
- local autosave;
- local backups;
- local exports.

Cloud editing, hosted conversion and collaboration are outside the current delivery roadmap. Optional off-device backup may later use user-owned storage such as Google Drive, Wasabi or Git repositories. This is exploration, not a selected provider or implementation commitment. Storage-provider backups use consistent archives. Git research also compares commits of validated staged project snapshots with archive commits; neither approach synchronizes the live manuscript working directory. Local project files remain authoritative, and writing, import, preview and export must work without a connection or Drelwick account. See the [local publishing plan](planning/local-publishing-plan.md).

---

# 3. Target Platforms

The application will initially target:

- Windows 10/11
- macOS
- Linux

Electron provides the desktop application runtime and Chromium rendering environment across all three platforms.

Platform-specific functionality should be kept behind abstractions wherever possible.

---

# 4. Technology Stack

## Desktop Runtime

**Electron**

Responsibilities:

- desktop application lifecycle;
- filesystem access;
- native menus;
- file dialogs;
- window management;
- application updates;
- communication between renderer and privileged application processes.

---

## Language

**TypeScript**

TypeScript will be used across both the Electron main process and frontend application.

This provides a common type system for:

- manuscript structures;
- editor documents;
- metadata;
- export configuration;
- validation results;
- IPC messages.

---

## User Interface

**React**

React will provide the main desktop interface.

Major UI areas will include:

```text
Application Shell
├── Project Navigator
├── Manuscript Editor
├── Inspector
├── Book Preview
├── Print Preview
├── Notes / Reference
└── Export Centre
```

---

## Rich Text Editing

**TipTap / ProseMirror**

TipTap will provide the primary structured manuscript editor.

Custom ProseMirror nodes will represent book-specific elements.

The broader target document schema should include (v0.1 uses the narrower build-plan subset):

```text
Document
├── Paragraph
├── Heading
├── ChapterTitle
├── SceneBreak
├── BlockQuote
├── Epigraph
├── Image
├── HardBreak
└── HorizontalRule
```

The broader target marks include:

```text
Bold
Italic
Underline
Strike
Superscript
Subscript
```

The application should deliberately avoid arbitrary font and layout formatting within the manuscript.

---

# 5. Application Architecture

High-level architecture:

```text
┌──────────────────────────────────────────────┐
│                 Electron App                 │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │              React UI                  │  │
│  │                                        │  │
│  │ Navigator │ Editor │ Preview │ Notes   │  │
│  └───────────────────┬────────────────────┘  │
│                      │                       │
│               Application API                │
│                      │                       │
│  ┌───────────────────▼────────────────────┐  │
│  │          Document / Project Core       │  │
│  │                                        │  │
│  │ Manuscript │ Metadata │ Assets │ Notes │  │
│  └───────────────┬────────────────────────┘  │
│                  │                           │
│       ┌──────────┴───────────┐               │
│       ▼                      ▼               │
│ EPUB Renderer          Print Renderer        │
│                              │               │
│                        HTML + CSS             │
│                              │               │
│                           Chromium            │
│                              │               │
│                         Playwright            │
│                              │               │
│                              ▼               │
│                             PDF              │
└──────────────────────────────────────────────┘
```

---

# 6. Project Structure

A project should be represented by a directory rather than a single opaque database file.

Example:

```text
my-novel/
│
├── project.json
├── book.json
├── cover.jpg
│
├── manuscript/
│   ├── <prologue-uuid>.json
│   ├── <chapter-uuid-a>.json
│   ├── <chapter-uuid-b>.json
│   └── <chapter-uuid-c>.json
│
├── frontmatter/
│   ├── title.json
│   ├── copyright.json
│   └── dedication.json
│
├── backmatter/
│   ├── acknowledgements.json
│   └── author.json
│
├── assets/
│   └── images/
│
├── reference/
│   ├── characters/
│   ├── locations/
│   ├── canon/
│   ├── timeline/
│   └── notes/
│
├── styles/
│   └── project.css
│
└── .history/
```

A future option may allow the directory to be packaged into a single compressed project archive for sharing.

---

# 7. Book Metadata

`book.json` contains publication metadata. `project.json` contains project identity, schema version and the ordered chapter UUID list; filenames do not determine order. Textual project files use UTF-8. See technical specification sections 9–14 for the canonical model.

Example:

```json
{
  "schemaVersion": 1,
  "title": "Example Novel",
  "subtitle": "",
  "author": "Author Name",
  "language": "en-GB",
  "publisher": "",
  "isbn": "",
  "description": "",
  "series": {
    "name": "",
    "number": 1
  },
  "created": "",
  "modified": ""
}
```

Additional publishing metadata can be introduced without changing manuscript content.

---

# 8. Manuscript Model

Each manuscript component will be an independent structured document.

Example:

```json
{
  "schemaVersion": 1,
  "id": "1da457d4-8c72-45a2-a1a6-9cc03aa381d3",
  "type": "chapter",
  "title": "Arrival",
  "status": "draft",
  "created": "2026-09-12T12:00:00Z",
  "modified": "2026-09-12T12:00:00Z",
  "content": {
    "type": "doc",
    "content": []
  }
}
```

The `content` object contains the ProseMirror document tree.

Separating chapters provides several advantages:

- faster loading;
- simpler autosave;
- reduced corruption risk;
- easier version history;
- easier Git diffs;
- easier chapter reordering.

---

# 9. Main User Interface

The default workspace should use a three-panel layout.

```text
┌──────────────────────────────────────────────────────────┐
│ File  Edit  Insert  View  Book  Export                  │
├─────────────┬────────────────────────────┬───────────────┤
│             │                            │               │
│ BOOK        │         MANUSCRIPT         │   INSPECTOR   │
│             │                            │               │
│ Front       │ Chapter Seven              │ Chapter       │
│             │                            │               │
│ Chapter 1   │ Aeon looked across...      │ Type          │
│ Chapter 2   │                            │ Start         │
│ Chapter 3   │ Astrid remained beside...  │ Style         │
│ Chapter 4   │                            │               │
│             │                            │               │
│ Back        │                            │               │
│             │                            │               │
├─────────────┴────────────────────────────┴───────────────┤
│  Writing   │ Book Preview │ Print Preview │ Reference   │
└──────────────────────────────────────────────────────────┘
```

Panels should be resizable and optionally collapsible.

---

# 10. Chapter Navigator

The navigator manages manuscript structure.

Supported operations:

- create chapter;
- rename chapter;
- delete chapter;
- duplicate chapter;
- drag-and-drop reorder;
- create front matter;
- create back matter;
- mark chapter status;
- display chapter word count.

Possible status values:

```text
Draft
Revising
Review
Final
```

---

# 11. Manuscript Editor

The editor should provide a deliberately restrained toolbar.

Example:

```text
Undo | Redo

Paragraph ▼

B  I

Quote
Scene Break
Image
```

Formatting should remain semantic wherever possible.

Keyboard shortcuts should support common writing operations.

Examples:

```text
Ctrl/Cmd + B    Bold
Ctrl/Cmd + I    Italic
Ctrl/Cmd + S    Save
Ctrl/Cmd + Z    Undo
Ctrl/Cmd + F    Find
```

---

# 12. Scene Breaks

Scene breaks must be represented as semantic document nodes.

They should not be stored as manually entered sequences such as:

```text
* * *
```

Instead:

```text
SceneBreak
```

The active book theme determines how that node is rendered.

Examples:

```text
* * *
```

or:

```text
◆
```

or simply additional whitespace.

This allows ebook and print editions to render the same scene break differently.

---

# 13. Book Themes

Themes control visual presentation independently from manuscript content.

A theme should define:

- body font;
- heading font;
- paragraph indentation;
- paragraph spacing;
- chapter heading layout;
- scene break appearance;
- block quote style;
- epigraph style;
- header/footer style;
- page number position.

Initial themes might include:

```text
Classic
Modern
Literary
Science Fiction
Minimal
```

Users may eventually create custom themes.

---

# 14. Preview Engine

Two principal previews will exist.

## Ebook Preview

Simulates a reflowable ebook reader.

Controls should include:

- viewport/device size;
- font size;
- light/dark display;
- portrait/landscape;
- chapter navigation.

The preview should demonstrate reflow rather than implying fixed Kindle pagination.

---

## Print Preview

The print preview uses the same HTML/CSS rendering pipeline used for final PDF generation.

This provides a close representation of the finished paperback.

Example:

```text
┌───────────────┐     ┌───────────────┐
│ 126           │     │           127 │
│               │     │               │
│               │     │ CHAPTER NINE  │
│ body text...  │     │               │
│               │     │ THE QUESTION  │
│ body text...  │     │               │
│               │     │ body text...  │
│               │     │               │
└───────────────┘     └───────────────┘
```

Facing-page mode should be supported.

---

# 15. Print Layout Engine

Print books will be rendered to HTML and CSS before PDF generation.

The system will use CSS Paged Media where supported.

Example:

```css
@page {
  size: 6in 9in;
  margin-top: 0.75in;
  margin-bottom: 0.75in;
}

@page :left {
  margin-left: 0.65in;
  margin-right: 0.85in;
}

@page :right {
  margin-left: 0.85in;
  margin-right: 0.65in;
}
```

The print engine must support:

- trim size;
- mirrored margins;
- gutter;
- page numbering;
- headers;
- chapter opening pages;
- blank pages;
- recto chapter starts;
- widows/orphans;
- images;
- print-safe typography.

---

# 16. Paperback Configuration

Initial trim presets should include common publishing sizes such as:

```text
5 × 8 in
5.25 × 8 in
5.5 × 8.5 in
6 × 9 in
```

Custom sizes may be supported later.

Configuration example:

```text
Trim Size          6 × 9"

Top                0.75"
Bottom             0.75"
Outside            0.60"
Inside/Gutter      0.85"

[x] Mirror margins
[x] Start chapters on right page
[x] Hide page number on chapter opening
[x] Prevent widows and orphans
```

---

# 17. PDF Generation

Playwright will control the Chromium print engine.

Conceptually:

```typescript
await page.pdf({
  path: outputFile,
  printBackground: true,
  preferCSSPageSize: true,
});
```

The renderer will first generate a complete print HTML document.

```text
Manuscript
     ↓
Book Renderer
     ↓
Print HTML
     ↓
Print CSS
     ↓
Chromium
     ↓
Playwright
     ↓
PDF
```

The resulting PDF must subsequently pass application validation before being presented as publication-ready.

---

# 18. EPUB Generation

EPUB generation will use the same semantic manuscript model.

Pipeline:

```text
Manuscript
     ↓
EPUB Renderer
     ↓
XHTML
     ↓
EPUB CSS
     ↓
Metadata
     ↓
Navigation
     ↓
Assets
     ↓
EPUB Package
```

Generated EPUBs should conform to EPUB 3.

Typical archive structure:

```text
book.epub

META-INF/
    container.xml

EPUB/
    package.opf
    nav.xhtml
    styles.css

    text/
        chapter001.xhtml
        chapter002.xhtml

    images/
        cover.jpg
```

The EPUB renderer must not depend on print-specific formatting.

---

# 19. Export Centre

The application should provide a dedicated export screen.

```text
EXPORT BOOK

EBOOK
────────────────────
EPUB 3

PRINT
────────────────────
Paperback PDF

VALIDATION
────────────────────
✓ Metadata
✓ Chapters
✓ Cover
✓ Images
✓ Internal links
✓ Print margins
✓ Fonts
```

Warnings should be distinguished from blocking errors.

---

# 20. Validation

Validation should occur before publication export.

## General

Check:

- title exists;
- author exists;
- manuscript contains content;
- referenced assets exist;
- unsupported elements;
- broken internal references.

## EPUB

Check:

- valid package structure;
- valid XHTML;
- navigation document;
- metadata;
- image references;
- cover;
- manifest;
- spine.

## Print

Check:

- valid trim dimensions;
- adequate margins;
- image resolution;
- missing fonts;
- overflow;
- blank pages;
- page count;
- unexpected content clipping.

---

# 21. Autosave

Editing should be autosaved frequently.

Autosave should be incremental where practical.

Example behaviour:

```text
User edits Chapter 7
       ↓
500–1500 ms inactivity
       ↓
Chapter file saved
       ↓
History snapshot scheduled
```

Saving one chapter should not require rewriting the entire project.

---

# 22. Version History

The application should maintain local manuscript history.

Potential structure:

```text
.history/
   2026-09-12/
      chapter-07-130500.json
      chapter-07-132100.json
```

Retention policies should prevent unlimited disk growth.

A later version could expose a visual revision comparison.

---

# 23. Backup

Users should be able to create a portable project backup.

Example:

```text
ExampleNovel.bookproject
```

This can internally be a ZIP archive containing the open project structure.

The archive format should remain documented and extractable with ordinary ZIP tools.

---

# 24. Reference / Story Bible

Initial offline CORE scope is local CRUD for characters, locations, canon facts,
timeline events and research/general notes, basic search and explicit chapter
links. The [story bible contract](story-bible.md) defines persistence, recovery,
validation, deletion and implementation dependencies; runtime work is #161–#168.
Organisations and technology use notes/canon, without speculative record types.
Reference data is independent of manuscripts and excluded from EPUB, DOCX and
print PDF, including private link metadata. No account or Pro code is required.

# 25. Character Records

Characters have name, aliases, optional role, description, appearance, personality,
background and notes, with tags and explicit links. See the strict
[versioned schema](story-bible.md#version-1-record-schema). Chapter links are in
initial scope; scene/range links await stable manuscript anchors. Relationships
use explicit record links; first appearance is not a separately persisted field.

# 26. Locations

Locations have name, optional type, description and notes, with tags and links.
Important features use description/notes; associated characters and events use
links. Image attachments require a separate design. Dirty edits survive failed
saves and block navigation until saved or explicitly discarded.

# 27. Timeline

Events have title, optional free-text fictional/calendar date, integer sequence,
description and notes, with tags and chapter/record associations. Sort by sequence,
then unsequenced entries, with UUID tie breaking; dates never imply chronology.
Deleted/missing targets remain visible as unresolved links. Chapter linking is
supported by the design; scenes and cross-book chronology are deferred.

# 28. Canon Notes

Canon records contain title, category, statement, optional notes, tags and links.
Categories are character, technology, location, history, relationship, terminology
and other. Research/general notes contain title, body and optional source citation.
There is no automatic continuity checking or manuscript modification. Advanced
continuity, series management and editorial tooling are candidates for review
**after #203**, without pre-allocation to Pro or a dependency on commercial review.

# 29. Search

Basic CORE local search covers manuscript text/titles and all five record kinds,
including aliases and tags. It uses a rebuildable bounded in-memory index and
navigable type-filtered results. See [matching and refresh rules](story-bible.md#search-and-export-isolation).
It does not infer mentions, perform automatic replacements or require SQLite.
Advanced queries need a separate design and later owner review.

---

# 30. Word Count and Statistics

The application should display:

```text
Book word count
Current chapter word count
Selected text word count
Character count
Estimated reading time
```

Optional later statistics could include:

```text
Average chapter length
Dialogue percentage
Chapter length distribution
Writing history
Daily word counts
```

---

# 31. Import

Planned v0.2 Community import formats:

```text
DOCX
Markdown
Plain Text
HTML
```

Basic DOCX import is part of the first local publishing workflow, after the reliable v0.1 foundation. Conversion maps Word content into semantic book elements and previews chapter boundaries and located fidelity warnings before creating a new project. It must preserve source files and never silently discard unsupported author content. Exact Word page layout is outside basic interchange scope.

---

# 32. Export

Initial exports:

```text
EPUB 3
PDF
HTML
Markdown
```

Basic editable manuscript DOCX export is planned by v0.3 in Community. It preserves supported content and semantic formatting; print appearance is supplied by PDF, not guaranteed by DOCX. Portable project archive backup/restore is planned for v0.2. HTML/Markdown export remain design intent without a scheduled implementation issue in this delivery slice.

---

# 33. Security

Electron security best practices must be followed.

Renderer processes should not have unrestricted Node.js access.

Use:

```text
contextIsolation = true
nodeIntegration = false
sandbox = true
```

Privileged operations should be exposed through a narrow preload/IPC API.

For example:

```text
Renderer
    ↓
Preload API
    ↓
Validated IPC
    ↓
Electron Main
    ↓
Filesystem
```

Project HTML must be treated as untrusted content when passed through rendering pipelines.

---

# 34. Crash Recovery

Because reliability is one of the reasons for developing the application, crash recovery is a core requirement rather than an optional feature.

The application should:

- autosave frequently;
- use atomic file replacement;
- preserve the previous valid version;
- maintain recovery snapshots;
- detect an unclean shutdown;
- offer recovery on restart.

A crash should ideally result in the loss of seconds of work, not an entire writing session.

---

# 35. Logging

Application logs should record:

```text
Startup
Project open
Project save failures
Autosave failures
Export operations
EPUB validation
PDF generation
Unhandled exceptions
Crash recovery
```

Logs must never contain manuscript body text, including serialized error payloads.

---

# 36. Testing

Testing should include several layers.

## Unit Tests

Test:

- manuscript model;
- metadata;
- ordering;
- path handling;
- exporters;
- validators.

## Rendering Tests

Known manuscripts should produce deterministic HTML.

Visual regression testing may later compare rendered pages against approved reference images.

## EPUB Tests

Generated EPUBs should be automatically validated.

## PDF Tests

Tests should confirm:

- trim dimensions;
- page count;
- fonts;
- margins;
- chapter starts;
- headers;
- page numbers.

## End-to-End Tests

Playwright can also test the application workflow:

```text
Create project
→ Create chapter
→ Enter text
→ Save
→ Restart
→ Reopen
→ Export EPUB
→ Export PDF
```

---

# 37. Initial Development Roadmap

## Version 0.1 — Manuscript

Goal: create a dependable writing environment.

Implement:

- Electron shell;
- React UI;
- TipTap editor;
- project creation;
- project opening;
- chapter management;
- chapter reordering;
- save;
- autosave;
- word count;
- crash recovery.

---

## Version 0.2 — Local Interchange, Book Presentation and Preview

The existing GitHub milestone retains its Book Presentation & Preview name. The [local publishing plan](planning/local-publishing-plan.md) adds early interchange and editing work without reopening v0.1.

Implement:

- basic local DOCX, plain text, Markdown and HTML import with reviewable conversion;
- portable local archive backup/restore and safe migrations;
- manuscript find/replace, chapter duplicate/split/merge/status, history restore and offline spelling;
- semantic book styles;
- themes;
- ebook preview;
- front matter;
- back matter;
- images;
- themed scene-break presentation (semantic editing is already in v0.1).

Verified print preview is delivered with the v0.4 pagination pipeline. Earlier
HTML rendering experiments must be labelled approximate and do not satisfy that
release requirement.

---

## Version 0.3 — EPUB

Implement:

- EPUB renderer;
- EPUB 3 packaging;
- metadata;
- navigation;
- cover;
- validation;
- EPUB export;
- basic editable manuscript DOCX export;
- validated offline DOCX-to-EPUB workflow.

At this stage the application should be capable of replacing Kindle Create for straightforward fiction ebook production.

---

## Version 0.4 — Print

Implement:

- trim presets;
- gutters;
- mirrored margins;
- chapter recto starts;
- page numbering;
- running headers;
- print preview;
- Playwright PDF generation;
- PDF validation;
- a basic large-print theme/profile and output validation;
- packaged offline print workflow validation.

At this stage the application should produce paperback interiors.

---

## Version 0.5 — Author Workspace

Implement:

- character records;
- locations;
- timeline;
- canon;
- research notes;
- global search;
- manuscript/reference linking.

---

## Version 0.6 — Editing Tools

Scoped local CORE work, specified by [#169's editing/revision design](editing-revisions.md)
and [implementation contracts](planning/169-editorial-delivery.md), not yet implemented:

- comments;
- annotations;
- revision mode;
- manuscript snapshots;
- compare revisions.

Basic manuscript find/replace, history browsing/restoration, spell checking and a local custom dictionary move to v0.2. Global reference search remains v0.5; richer revision comparison and editorial review remain later local workflows.

The design requires stable/orphan-aware anchors, explicit revision decisions,
consistent named snapshots and an explicit accepted/proposed text choice for
publishing pending revisions. Comments and editorial metadata remain private.
Under the 2 October owner decision, this CORE work proceeds without #52/#203 as
dependencies; final commercial allocation follows private-app evaluation #203.

---

## Version 1.0

Version 1.0 should provide a stable end-to-end workflow:

```text
CREATE
  ↓
WRITE
  ↓
ORGANISE
  ↓
EDIT
  ↓
PREVIEW
  ↓
VALIDATE
  ↓
EXPORT
     ├── EPUB
     └── PRINT PDF
```

The application should be capable of producing a complete novel without requiring Kindle Create or a traditional word processor.

---

# 38. Future Features

Later possibilities include the following; v1.0 design issues for reusable local matter templates, parts/volumes, richer semantics and advanced themes establish scope rather than promise full implementation by v1.0:

- series management;
- multiple books in one workspace;
- advanced custom book themes (v1.0 design decision before implementation);
- hardcover layouts;
- footnotes/endnotes;
- advanced image handling;
- poetry layouts;
- tables;
- optional local writing goals (tracked toward v1.0);
- revision statistics;
- Git integration;
- optional user-owned off-device archive backup, subject to separate exploration;
- plugin system.

---

# 39. AI-Assisted Features

AI should remain optional and separate from the fundamental editor.

Potential future capabilities include:

```text
Continuity checking
Character consistency checking
Timeline conflict detection
Repeated phrase detection
Proofreading
Style analysis
Chapter summaries
Scene summaries
Story bible extraction
```

For example, the continuity system could identify that a manuscript states:

```text
Astrid's power reserve lasts 72 hours.
```

while an established canon record specifies:

```text
Normal operational endurance:
48–72 hours depending on activity.
```

The system could flag the passage for author review rather than automatically changing manuscript content.

AI features should never silently rewrite the manuscript.

---

# 40. Non-Goals

The application is not intended initially to become:

- a Microsoft Word replacement;
- a desktop publishing application like InDesign;
- an image editor;
- a collaborative cloud office suite;
- a general-purpose HTML editor.

Its focus is:

> **Writing, organising, formatting and publishing books reliably.**

Keeping this scope constrained is important to making the application maintainable.

---

# 41. Core Architectural Principle

The manuscript is the authoritative source.

Everything else is a representation of that manuscript.

```text
                  MANUSCRIPT
                      │
           ┌──────────┼──────────┐
           │          │          │
           ▼          ▼          ▼
        EDITOR      EPUB       PRINT
                     │           │
                     ▼           ▼
                   XHTML       HTML
                                 │
                                 ▼
                              Chromium
                                 │
                                 ▼
                                PDF
```

Neither EPUB nor PDF should become an editable master document.

This ensures ebook and paperback editions remain synchronised.

---

# 42. Summary

The proposed application uses a cross-platform Electron architecture with a structured manuscript model and semantic editing.

The key technology choices are:

```text
Desktop        Electron
Language       TypeScript
UI             React
Editor         TipTap / ProseMirror
Preview        Chromium
Print Layout   HTML + CSS Paged Media
PDF            Playwright / Chromium
Ebook          EPUB 3
Storage        Open local project structure
```

The architecture deliberately uses web technologies for book rendering because both EPUB and modern print rendering map naturally to HTML and CSS.

The initial objective is not to build a general word processor.

It is to build a reliable authoring environment that can take a manuscript from first draft through to validated EPUB and print-ready PDF while keeping the underlying work portable, recoverable and independent of any single publishing platform.
