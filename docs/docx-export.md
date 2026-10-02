# Editable DOCX export

Community's **Export → Export DOCX** creates a standard, author-owned Word
manuscript on the local filesystem. It works offline, without an account,
conversion service, Pro checkout or plugin runtime. DOCX is editable interchange,
not print-perfect output, exact Word layout, PDF or authoritative project storage.
The [import support matrix](docx-import.md) describes the reverse conversion.

## Workflow and consistency

Export freezes the editor, flushes the existing autosave coordinator and checks
the acknowledged state for pending saves or newer dirty edits. A failed flush
prevents the export command and leaves edits available. Publication editing must
finish before export can start. Main settles history and calls the existing
`assembleBook` service: the shared project write lock, validated files and
before/after byte comparisons produce one captured revision, including image
originals. Subsequent generation and dialogs use only this in-memory revision.
Changes made externally after capture cannot mix newer content into that output.
Recovery files, competing writers or changes during capture stop export.

Reading order is the assembled cover (if present), front matter in publication
page order, body in `project.manuscript.order`, then back matter in publication
page order. Filenames and filesystem enumeration never establish reading order.
All saved content is included, even if its ebook/print visibility is off: those
flags concern publishing targets, not the editable interchange copy. Located
warnings explain the distinction. Export neither edits those flags nor migrates
or changes the project. Only the preceding normal save may change manuscript data.

Warnings are reviewed in a native dialog before destination selection. They
contain a category, construct, chapter/matter identity and zero-based semantic
path; the dialog presents one-based item/block positions. A warning means that
content remains, with a formatting, navigation or round-trip limitation. Cancel
leaves the destination untouched. Missing content, corrupt assets, unsupported
nodes or invalid text block generation instead of producing a partial book.

## Support matrix

| Construct                                                                    | Export profile                                                                                                                      | Re-import expectation                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paragraphs, empty paragraphs                                                 | Word paragraphs in reading order                                                                                                    | Preserved; equivalent adjacent text runs may coalesce.                                                                                                                                                                           |
| Unicode                                                                      | UTF-8 without Unicode normalization; accents, punctuation, non-Latin scripts, combining sequences and emoji                         | Preserved. Invalid XML 1.0 scalars block export.                                                                                                                                                                                 |
| Tabs, hard breaks, embedded text newlines                                    | Word tabs and line breaks; CR/LF become line breaks                                                                                 | Text order remains; embedded newlines return as semantic hard breaks.                                                                                                                                                            |
| Chapter and matter titles                                                    | Heading 1 before each item's content                                                                                                | Import proposes chapters from every main-story Heading 1, including original level-1 headings. Titles remain in imported content. Original Drelwick IDs, roles and exact chapter boundaries are not reconstructed automatically. |
| Headings 1–6                                                                 | Standard named heading styles and outline levels                                                                                    | Levels and text preserved; no invented bold mark.                                                                                                                                                                                |
| Bold, italic, combined emphasis                                              | Direct Word run formatting                                                                                                          | Preserved.                                                                                                                                                                                                                       |
| Underline, strike, inline code                                               | Word underline, strike or monospace; warning                                                                                        | Current importer recovers text and may warn/flatten the mark.                                                                                                                                                                    |
| Ordered/bullet lists                                                         | Real numbering, separate list instances, mixed nesting and decimal starts 0–1,000,000, up to nine levels                            | Basic lists and starts preserved. Custom list type warns and maps to decimal; custom bullet appearance is not promised.                                                                                                          |
| Deeper lists or out-of-range starts                                          | Readable explicit labels and retained item content, with warning                                                                    | Ordinary paragraphs. No item text omitted.                                                                                                                                                                                       |
| List-item continuation blocks                                                | Content/order retained, with warning                                                                                                | Multi-block grouping can flatten or split on re-import.                                                                                                                                                                          |
| Block quotes, epigraphs and attribution                                      | Named paragraph styles; attribution retained as its own paragraph; warning                                                          | Ordinary paragraphs retaining all text. There is no additional persisted arbitrary paragraph-style vocabulary.                                                                                                                   |
| Code blocks                                                                  | Monospace style, line breaks, visible language label when present; warning                                                          | Readable paragraphs; code-block/language semantics are not restored.                                                                                                                                                             |
| Scene breaks, horizontal rules                                               | Visible `***` paragraph with warning                                                                                                | Marker text rather than a semantic break.                                                                                                                                                                                        |
| HTTP, HTTPS, mail links                                                      | External hyperlink relationships containing data only                                                                               | Destinations/text retained; never fetched by export. Browser-only link attributes warn and are not retained.                                                                                                                     |
| Fragment links                                                               | Word anchor destination with warning                                                                                                | Fragment string retained. Bookmark definitions are not part of the current project/import model; working navigation is not guaranteed.                                                                                           |
| PNG/JPEG images and cover                                                    | Captured validated originals embedded once per asset, inline position and alternative text; approximate proportional width; warning | Images and alt text retained with newly assigned import asset IDs; relative size becomes medium. Exact wrapping/cropping/page placement is not promised.                                                                         |
| Front/back matter and visibility                                             | All saved items included in authoritative order; warning                                                                            | Editable content retained; publication page types, flags and navigation inclusion are not reconstructed.                                                                                                                         |
| Title, author, language, description                                         | Core document properties                                                                                                            | Import maps these fields; descriptions over 4,000 characters warn because import rejects that metadata field above its limit. Export keeps the full description.                                                                 |
| Publication identifiers                                                      | Core identifier metadata, with warning                                                                                              | Not restored by current importer; remains in the Word package.                                                                                                                                                                   |
| Theme, print settings                                                        | Not a layout export; no theme-dependent conversion                                                                                  | No print/layout fidelity promise.                                                                                                                                                                                                |
| Missing/corrupt images, unknown semantic nodes/marks, invalid XML characters | Blocking error                                                                                                                      | No destination published; repair the project/content first.                                                                                                                                                                      |

An editable export is not a lossless project backup. Use Back Up Project to retain
IDs, matter roles, visibility, history and every project setting. Round-trip tests
compare supported semantics, not ZIP bytes, timestamps, asset IDs or Word layout.
No importer expansion or persistent schema change was needed for this issue.

## Implementation and dependency decision

- `packages/core/src/book-assembly.ts`: existing consistent semantic capture.
- `packages/core/src/docx-export.ts`: structured WordprocessingML/DrawingML,
  metadata, styles, numbering, relationships and embedded media.
- `packages/core/src/docx-output.ts`: privileged destination validation and atomic
  binary publication, using the same exclusive temporary-file/fsync/rename pattern
  as the JSON writer. It does not reuse a JSON serializer for binary output.
- Desktop main owns dialogs, authorization, review and publication. Shared IPC
  accepts only a project UUID; neither paths, XML nor output bytes cross from the
  renderer. The renderer uses the restricted preload and existing autosave path.

Existing `fflate` supplies ZIP writing; existing `sax`/bounded package validation
checks generated XML and ZIP before publication. New runtime dependency
[`xml` 1.0.1](https://github.com/dylang/node-xml) supplies structured serialization
and escaping (MIT, no runtime dependencies). Its installed licence is retained in
[the attribution](attributions/docx-xml-LICENSE.txt); `@types/xml` 1.0.11 is MIT
development-only typing. A general DOCX framework was considered but would add a
second ZIP stack and substantially more dependencies for this bounded profile.
Author text is never interpolated into raw XML. No document data is executed.
This dependency review does not clear the separate public-release/legal gate.

Output is bounded: 32 MiB aggregate input strings, one million input values,
depth 64, 64 MiB total package, 20 MiB per entry, 8 MiB per XML part,
250,000 XML elements, 50,000 paragraphs, 1,000 Heading-1 boundaries (including
item titles), 256 distinct images/48 MiB originals, 4,096 relationships and
1,000 fidelity findings. Exceeding a budget fails, never truncates author text or
warnings. Stored ZIP entries avoid expansion-ratio rejection of repetitive prose.
The importer can also reject unusually complex documents at its worker deadline;
these are bounded interchange profiles, not unlimited Word compatibility.

## Destination safety and cancellation

The native save dialog selects a `.docx` outside Drelwick project folders.
Ancestor links, network paths, traversal, special files, hard-linked existing
files, Windows device names and alternate data streams are rejected. Existing
files require an explicit native confirmation, with a default of keeping them.
An identity check rejects a destination changed since that review.

The complete validated package is written to an exclusively created sibling
temporary file, flushed and closed. New files use an exclusive hard-link
publication, so a concurrently created destination cannot be overwritten.
Confirmed existing files use the platform's atomic rename/replace. Failures
before commit preserve the prior destination and remove owned temporary output.
Filesystems that do not support these operations fail safely rather than falling
back to in-place writing. The final check/rename is subject to ordinary OS path
semantics; there is no cross-process filesystem locking against hostile local
programs. Power-loss guarantees depend on the filesystem, as with existing saves.

Dialog cancellation is supported; no background export cancellation UI is added.
The writer accepts an internal AbortSignal and checks before commit. Once
published, output remains a success; failure to remove the temporary hard link is
reported as a cleanup warning. Author prose and private metadata are never logged.

## Verification

Prerequisites were checked against merged PRs and code/tests, not issue closure
alone: #112/PR #158 (`manuscript-document`, editor and chapter-saving tests),
#113/PR #159 (`image-assets` validation and tests), #123/PR #191 (publication
metadata/matter/cover persistence and assembly), #115/PR #178 (bounded DOCX parser,
fixtures and support matrix). No material prerequisite gap required reinvention.

`packages/core/test/docx-export.test.ts` reuses minimal, unordered-storage,
formatted and synthetic-image fixtures. It independently opens ZIPs with `yauzl`
and parses XML with `sax`, checks parts/relationships/numbering/media/text, then
uses the actual isolated Community importer. It verifies Unicode, ordered matter,
marks, lists, links, images, warning locations, blocking loss, project immutability,
snapshot isolation, overwrite protection, failure cleanup and cancellation.
Existing assembly tests verify lock exclusion, recovery and external mutation.

Desktop tests cover native warning/overwrite cancellation, trusted frame/project
authorization, strict path-free payloads, busy exclusion, preload, real editor save
flush and failure retention. The Electron scenario exports unsaved Unicode while
offline, re-imports it without Word, checks declined overwrite and unchanged saved
chapter bytes, and asserts no network requests or renderer filesystem capability.
These tests do not claim manual Microsoft Word acceptance, packaged installers or
native macOS/Linux runtime validation.
