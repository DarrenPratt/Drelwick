# Basic Community DOCX import

Issue #115 implements the `docx` adapter for the [staged import API](manuscript-import.md).
This is local CORE functionality. No Word installation, account, service, network
or Pro package is used. The [review/mapping interface and import menu](import-review-ui.md) from #116
let authors approve this parser's proposed manuscript before creating a project.

## Dependency decision

Pinned runtime libraries:

- [fflate 0.8.3](https://github.com/101arrowz/fflate), MIT: pure JavaScript streaming
  DEFLATE. Drelwick checks ZIP central/local records before using its inflater and
  checks actual expanded lengths and CRCs afterwards. A full archive extraction
  API is deliberately not used. Its synchronous stream runs inside the existing
  terminable parser worker.
- [sax 1.6.1](https://github.com/isaacs/sax-js), BlueOak-1.0.0: event-driven XML,
  namespace-aware strict mode, predefined entities only, no resolver. Drelwick adds
  declaration, Unicode, duplicate-attribute, depth, aggregate-node and package
  structure checks; this is not an OOXML XSD validator.
- Build only: esbuild 0.28.2 (MIT) bundles the adapter and these libraries into
  `packages/core/dist/docx-parser.bundle.js`. This packaged code, never document
  data, supplies the existing isolated importer program. Runtime module loading
  remains unavailable.

The installed licences were checked. These permissive dependencies impose no
account, paid API or Pro restriction and do not decide Drelwick's eventual licence.
The build includes dependency notices in the bundle; retain them when packaging.
Repository public-release/licensing gates remain unchanged. Upgrades require the
adversarial fixture suite; parser libraries alone do not provide the resource or
content-preservation policy.

Alternatives evaluated: existing yauzl is Node/asynchronous and cannot run inside
the current synchronous capability-free VM without expanding its privileges.
[Mammoth](https://github.com/mwilliamson/mammoth.js) is semantic-oriented but its
HTML conversion adds another mapping layer and still requires isolation and
resource controls. Its security guidance explicitly discusses unsafe links and
pathological documents. `saxes` offers stricter XML conformance, but its upstream
repository is archived. `sax` remains maintained; our additional validation and
focused malformed-XML tests cover the boundaries used here. No layout renderer
or hosted converter was selected.

## Trust boundary and lifecycle

```text
native source picker -> #114 bounded read -> isolated bundled DOCX parser
-> untrusted serialized ImporterResult -> #114 model and full image validation
-> private stage + path-free inspection -> separate native destination picker
-> #114 commit into a new empty folder -> new authoritative project
```

Call `imports.inspect({ operationId, importer: "docx" })`, then separately
`imports.commit(operationId, review)` or `imports.cancel(operationId)`.
Desktop commit requires individual approval of every warning and valid chapter
boundaries. After commit, `imports.open(operationId)` invokes normal validation/open. No new filesystem,
ZIP, XML, parser-program or process API is exposed. The existing trusted-frame,
operation-owner, startup-recovery and busy-operation checks remain in force.
All parser output is untrusted, including diagnostics. `DocxImportError` permits
only fixed error codes and fixed part categories with bounded numeric locations;
raw XML, archive paths, exceptions and manuscript text are not diagnostic payloads.
Located warnings are manuscript inspection data, never logs.

Images use generated internal UUIDs, not imported filenames. The parser detects
PNG/JPEG signatures; #114 then invokes the existing strict image decoder before
staging and again before commit. Original image bytes and decoded dimensions are
stored using #113. Authoritative project v2, chapter v1 and asset v1 are unchanged;
no migration or rewriting of existing projects is needed.

## Support matrix

| Feature                 | Behaviour                                                                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paragraphs              | Supported in XML reading order, including empty paragraphs, tabs and hard breaks. Adjacent equivalent text runs join without invented spaces.                                                                                                                                                                   |
| Headings                | Heading 1–6 style IDs/names and supported outline levels; basic based-on style chains. Other visual styles remain ordinary paragraphs.                                                                                                                                                                          |
| Chapter proposals       | Main-story Heading 1 paragraphs propose chapters and remain in their chapter content. Other levels, table/note/header/text-box headings do not split the book. Leading content becomes “Opening”. Proposals carry located warnings for later review.                                                            |
| Bold                    | Direct and basic paragraph/character-style bold, including explicit off. Advanced Word style toggle interactions/layout are not reproduced.                                                                                                                                                                     |
| Italic                  | Same handling as bold.                                                                                                                                                                                                                                                                                          |
| Combined emphasis       | Bold and italic together on the same text.                                                                                                                                                                                                                                                                      |
| Ordered lists           | Decimal lists with starts and continuous counters, up to nine Word levels; nested items use existing list semantics. Unsupported numbering/overrides or discontinuous levels become readable paragraphs with a warning.                                                                                         |
| Unordered lists         | Basic bullets and mixed ordered/bullet nesting. Custom bullet glyph appearance is not reproduced.                                                                                                                                                                                                               |
| Hyperlinks              | Web, email and fragment destinations remain semantic data and are independently revalidated by project-model. Unsafe schemes retain visible text with a warning; malformed links may block validation. No navigation/fetch occurs. Bookmark definitions are non-text markers, not persisted navigation targets. |
| Embedded images         | Static PNG/JPEG originals through existing assets, alt/description text, decoded dimensions and reading position. Inline images split a paragraph into ordered blocks. Word crop/wrap/physical sizing is explicitly warned about; relative size defaults to medium. Unsupported/corrupt images block import.    |
| External images         | Never fetched. A located warning and readable placeholder preserve available alt text.                                                                                                                                                                                                                          |
| Metadata                | Title, creator, language and description. Missing required metadata uses explicit placeholders with a warning. Subject, keywords and unmatched metadata receive a warning rather than being forced into unrelated fields.                                                                                       |
| Unicode                 | UTF-8 and BOM-marked UTF-16 XML; accented/non-Latin text, punctuation, emoji and combining sequences preserved without Unicode normalization. Invalid encoding/scalars block import.                                                                                                                            |
| Tables                  | Recovered in row/cell XML order with warning; cell paragraphs and nested tables retained. Merged-cell/layout semantics are not preserved. Unknown content-bearing table wrappers block.                                                                                                                         |
| Footnotes               | Text recovered at first reference with a labelled block and warning. Unreferenced ordinary notes append in part order. Separator markers carry no manuscript text.                                                                                                                                              |
| Endnotes                | Same recovery as footnotes.                                                                                                                                                                                                                                                                                     |
| Comments                | Text recovered at first reference with label and warning; unreferenced comments append. Range/authoring semantics are not retained.                                                                                                                                                                             |
| Tracked changes         | **Import blocked**, including insertion/deletion, moves and property revisions. Accept/reject revisions in a copy first. Neither accepted nor deleted text is silently chosen or concatenated.                                                                                                                  |
| Fields                  | Instructions never executed. Cached visible results retained with warning; unbalanced complex fields block.                                                                                                                                                                                                     |
| Text boxes              | Word text-box paragraphs recovered at their XML anchor with warning. Visual positioning is not reproduced. Ambiguous mixed text/image drawings block.                                                                                                                                                           |
| Drawings/shapes         | Supported pictures as above. Non-text shapes omitted with explicit warning. Unhandled drawing text blocks import, rather than disappearing.                                                                                                                                                                     |
| Content controls        | Stored body recovered with warning; bindings are never executed. Missing/ambiguous content blocks.                                                                                                                                                                                                              |
| Headers/footers         | Text appended once per relationship in relationship order, with warning. Page repetition and layout are not implemented.                                                                                                                                                                                        |
| Other structures        | Unknown content nodes, alternate-content branches, equations, subdocuments, OLE/embedded objects and unaccounted manuscript text block import. Unknown package parts block unless explicitly identified as unmatched metadata or unused images, which warn.                                                     |
| Macros                  | Macro-enabled content types, VBA parts and embedded executable objects rejected; never executed.                                                                                                                                                                                                                |
| Encrypted documents     | Encrypted ZIP and OLE encrypted/legacy Word containers rejected. No password handling.                                                                                                                                                                                                                          |
| External relationships  | Never resolved or fetched. Hyperlinks remain data; linked images get placeholders; other external references warn.                                                                                                                                                                                              |
| Layout-only information | Fonts, themes, geometry, pagination, proofing and non-text bookmark markers do not become semantic manuscript content. Any hidden/unaccounted `w:t` or drawing text still blocks import.                                                                                                                        |

This is deliberately a bounded subset of transitional WordprocessingML, not full
OOXML compatibility. Strict-namespace OOXML, ZIP64, split archives, unsupported
compression/encryption and ambiguous alternate content are rejected. Save a copy
as ordinary DOCX and simplify unsupported content before retrying. A failure never
authorizes modifying the original. Long chapter proposal titles are shortened at
a Unicode boundary; the complete heading remains in the chapter.

Unsupported run semantics such as underline, strike, superscript/subscript,
hidden text and capitalization effects preserve the underlying text with a
located `DOCX_RUN_FORMAT` warning. Hidden text becomes visible for review; the
importer never silently discards it. Unknown foreign text in ignored properties
and orphaned deleted text block import.

## Resource and security policy

`DOCX_LIMITS` adds to the unchanged `IMPORT_LIMITS` and `IMAGE_LIMITS`:

| Resource                                   | Maximum                                                       |
| ------------------------------------------ | ------------------------------------------------------------- |
| Source                                     | 64 MiB (#114)                                                 |
| ZIP entries                                | 2,048                                                         |
| Entry compressed / expanded bytes          | 20 MiB each                                                   |
| Aggregate expanded bytes                   | 96 MiB                                                        |
| Expanded/compressed ratio                  | 200:1 per entry                                               |
| Individual XML part                        | 8 MiB                                                         |
| XML depth / aggregate elements             | 64 / 250,000                                                  |
| Relationships                              | 4,096 across the package                                      |
| Paragraphs visited                         | 50,000                                                        |
| Imported image count / aggregate originals | 256 / 48 MiB                                                  |
| Generated warnings                         | 1,000; exceeding this blocks instead of hiding further losses |
| Proposed chapters                          | 1,000 (#114)                                                  |
| Output / intermediate / final stage        | Existing 128 MiB limits (#114)                                |

ZIP entries are never extracted to disk. Preflight rejects unsafe/duplicate archive
paths, absolute escapes, links, overlapping entries, inconsistent local/central
headers and data descriptors. DEFLATE is fed in 1 KiB compressed chunks; actual
expanded bytes must fit the declared bounded output buffer and pass CRC. Internal
relationship parent segments may only resolve within the in-memory package;
escaping root, URI schemes, encoded/ambiguous paths and missing targets fail.

XML parsing rejects DTD/ENTITY declarations and unknown entities, does not install
an entity resolver, and checks namespaced duplicate attributes and scalar validity.
Supplementary raw-token checks reject duplicate/misplaced XML declarations, literal
less-than signs in attribute values and forbidden `]]>` in ordinary character data,
while preserving legal entity escapes and CDATA.
The VM exposes no fetch, XHR, WebSocket, filesystem, process or shell capabilities.
Macros, instructions, relationship targets and source text are never evaluated.
The inherited VM/worker deadlines and cancellation terminate parsing. V8 limits
are not a total process-memory guarantee; the explicit expansion limits are also
required. No diagnostic logging was introduced.

## Failure, cancellation and recovery

All source reads and destination authorization use #114. Parsing and inspection
never alter the active project. Cancellation during parsing terminates the worker;
during staging or before publication it removes owned temporary state. A staging
or commit failure cannot leave a successfully imported root manifest. The source
bytes remain unchanged on success, rejection, cancellation and write failure.

Cleanup failure returns the existing recovery instruction; retain the interrupted
folder and retry in another new empty destination. Root-manifest publication is
still the commit point: cancellation or cleanup failure after it cannot turn a
completed project into a reported failed import. See [import recovery](manuscript-import.md#cancellation-and-recovery).

## Verification and fixtures

`packages/core/test/fixtures/docx.ts` generates deterministic ZIP/OOXML packages
with fixed timestamps and explicit XML. It uses no Word installation, binary
author manuscript or network service. `packages/core/test/docx-import.test.ts`
asserts exact text/semantic order, metadata, marks, chapters, warning codes and
asset bytes. It includes malformed ZIP/XML, traversal, header-size deception,
DEFLATE overrun, XXE, duplicate attributes, limits, revisions, hidden content,
source preservation, write failures and cancellation. A test executes the actual
bundled parser after asserting that all host/network APIs are absent.

`apps/desktop/test/manuscript-import-ipc.test.ts` exercises the production `docx`
registration and safe diagnostics through the restricted existing API. The #114
suite remains responsible for general destination authorization, cleanup failure,
active-project preservation, nonempty folders and publication rollback.
