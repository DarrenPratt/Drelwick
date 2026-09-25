# Publication metadata and matter pages

Issue #123 is Community functionality. Book details opens the publication dialog:
edit metadata, add a starter page, edit its semantic content, move it within front
or back matter, and save. A type change changes only its classification. Placement,
navigation, ebook and print checkboxes never regenerate or delete a document.
Existing body order remains controlled by the manuscript navigator.

## Schema and compatibility

`publication.json` is an optional, independently versioned component (version 1).
It contains the project UUID, publication metadata, ordered matter pages, body
inclusion overrides and an optional managed cover asset UUID. Metadata includes
title, author, language, description and optional ISBN/UUID/other identifiers.
Identifiers are publication data, not claims of external registration or validity.
Strict schemas reject unknown fields, invalid identities, malformed language tags,
invalid XML characters and invalid semantic documents.

No manifest, book or chapter schema bump is necessary. Existing `book.json` remains
the authoring metadata and supplies the initial publication values. After
initialization, publication metadata is authoritative for publishing; changing it
does not rename the working project or rewrite `book.json`. Old projects without
the component render with deterministic defaults without being modified.

Opening the publication workflow first invokes #111's existing journaled v1-to-v2
migration when needed. Under the shared project operation lock, its verified
snapshot/copy helpers then preserve a complete pre-addition copy in
`.drelwick-publication-migration/backup-<uuid>`. The source and backup are verified
before an exclusive atomic commit of the single new component. This additive
migration needs no multi-file commit journal: absent means retry initialization;
present means validate and use it. Snapshot, temporary and retained lock evidence
is never silently removed. Abrupt crashes with retained temporary files or locks
require recovery before further publication writes. Caught interruption boundaries
are tested before and after commit. Existing chapter IDs, order and bytes stay
unchanged, including prose, marks and asset references. Portable backups include
the publication component and existing managed assets.

## Persistence and editing

Matter documents use `ManuscriptDocumentSchema` and the existing semantic editor.
The five starter types are title, copyright, dedication, acknowledgements and
author. Starter paragraphs become ordinary editable content, not live templates.
Page identity is independent of type and placement. Metadata, matter documents and
settings commit together in one recoverable atomic JSON write. SHA-256 revisions
reject stale saves; a failed write preserves the previous committed component.
This workflow does not delete pages. Core rejects a settings save that omits an
existing page identity.

The desktop flushes pending chapter autosave before opening the modal. Publication
changes have an explicit Save action and dirty indicator; failed saves retain the
draft. Closing a dirty dialog requires an explicit discard choice. Project
transitions and app shutdown remain blocked while the dialog is open; close the
dialog after saving to resume authoring. Matter is not independently autosaved or
added to Chapter History. Inline images already in semantic matter are preserved;
the matter editor does not currently offer chapter-only image import.

## Shared rendering

`assembleBook` captures the component under the same operation lock and byte
verification boundary as chapters/assets. It orders front pages, canonical body
chapters, then back pages. Each assembled chapter carries publication section,
optional matter kind and independent inclusion flags. An ebook cover becomes an
ordinary semantic image document at the beginning of the assembled book.

The existing `renderBook` serializer renders every document. Its optional `target`
filters only ebook/print visibility; omission renders all documents. Navigation
membership is forwarded for future navigation builders and never controls prose
visibility. `data-matter-type` is the only additional styling hook. Metadata is
carried alongside the book revision; the preview wrapper escapes its title,
author and description. No second semantic renderer, EPUB package or print layout
engine is introduced.

## Covers and security

The renderer sends only project identity and expected publication revision to a
restricted typed IPC operation. Main validates the trusted frame and active
project, opens the existing native image picker, then uses the existing immutable
PNG/JPEG importer. Signature, decoding, dimensions, size, path and checksum checks
are reused; filename extensions alone are not trusted. Source files are read only.
The asset commits before the publication reference. A failed reference update
leaves the old cover selected and retains the unreferenced new asset for recovery.
Old covers are never deleted by replacement.

UI cover thumbnails use the authorized image-read API; preview uses captured
validated bytes and its existing data-URL resolver. No paths cross the publication
IPC boundary. The sandboxed preview, CSP, link policy, escaping and no-network
rules from #121 remain unchanged. Diagnostics use fixed messages/codes and never
log metadata or manuscript content.

## Acceptance evidence

| #123 criterion                                     | Implementation                                                                | Tests                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Metadata editing and persistence                   | Shared/model publication schemas; dialog; core atomic save                    | `core/test/publication.test.ts`, desktop publication IPC test, Electron publication restart test                     |
| Five editable/orderable matter types with defaults | `createMatterPage`, dialog type/placement/order/editor controls               | Core all-five-types/order/edit preservation test; Electron semantic editing/type-change test                         |
| Explicit types/order and compatible migration      | Versioned component, verified snapshots, canonical assembly                   | v1 migration exact chapter bytes/order/IDs; interruption boundaries; assembled front/body/back order                 |
| Independent navigation/ebook/print settings        | Inclusion contract, target filtering, no-delete save guard                    | Core inclusion and no-delete tests; Electron independent checkbox persistence                                        |
| Restricted IPC and preservation on type change     | Active-project/frame validation; revision checks; identity-preserving patches | Desktop IPC invalid/untrusted requests; core stale/write-failure tests; Electron restart identity/content comparison |
| Managed cover import/replacement                   | Native picker, existing validated asset importer, atomic reference            | Core valid/invalid/replacement failure/source preservation; IPC picker authorization; Electron import/restart        |

Downstream consumers can use publication metadata, ordered semantic documents,
navigation flags and cover asset identity. EPUB/DOCX export, print configuration,
templates, parts/volumes/editions and custom publishing remain separate issues.
