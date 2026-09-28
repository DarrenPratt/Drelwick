# Drelwick Community project format

This is the public specification of the **implemented** persistent format as
reviewed for #58. New projects use project version **2**; the supported historical
project version is **1**. Book, chapter and the other components described below
have their own version numbers. This document describes files, not an application
API: a reader needs only a filesystem, UTF-8 JSON tools and ordinary image tools.

The project directory is the authoritative manuscript. DOCX is an import/export
interchange format; EPUB and PDF are generated publishing outputs. None replaces
the project. The format belongs to Community and requires no Pro package, account,
service, network connection, proprietary decoder or decryption software.
The dependency direction remains **Pro → Community**, never Community → Pro.
This specification does not change repository visibility or licensing decisions.

“Required” and the field tables describe the current on-disk contract.
**Implementation notes** identify current reader/writer behavior, limits and
recovery mechanisms rather than additional manuscript fields. Future/reserved
structures are explicitly identified and have no schema defined here.

## Directory and authority

Paths are relative to the project root. A project has no required directory-name
extension. Fixed filenames are case-sensitive for portability. Use regular files
and directories, not symlinks or junctions. No absolute machine path is needed to
resolve a manuscript chapter or managed image.

```text
example-project/
├── project.json                         required: identity and chapter order
├── book.json                            required: authoring metadata
├── format.json                          required in project v2 only
├── manuscript/
│   └── <chapter-id>.json                 required for each manifest reference
├── publication.json                     optional: publishing metadata and matter
├── presentation.json                    optional: selected book theme
├── assets/
│   └── images/<asset-id>/
│       ├── asset.json                    required for this managed image
│       └── original.png                 or original.jpg
├── frontmatter/                         reserved directory; no page-file schema
├── backmatter/                          reserved directory; no page-file schema
├── reference/                           reserved directory; no reference schema
├── styles/                              reserved directory; no custom-style schema
├── .history/                            optional recovery data
│   ├── snapshots/<chapter-id>/<snapshot-id>.json
│   └── deleted/<chapter-id>-<unique-id>.json
├── .chapter-summaries.json               optional, disposable derived cache
├── .drelwick-migration/                  optional migration recovery workspace
└── .drelwick-publication-migration/      optional publication initialization copies
```

All listed JSON is UTF-8; image originals are binary PNG/JPEG. `project.json`,
`book.json`, the v2 descriptor, referenced chapter files, and present publication,
presentation and image components are authoritative for their respective data.
The cache, history and migration workspaces are not the current manuscript.
History and recovery copies can nevertheless contain the only remaining copy of
earlier or interrupted work: retain them when recovering a damaged project.

New-project creation makes the standard directories, but empty directories are
not a prerequisite for reading a project. An empty `manuscript.order` is valid.
Unreferenced chapter/image files do not implicitly join the manuscript; preserve
them during recovery. Application settings, recent-project paths, credentials,
personal spelling dictionaries and unclean-session markers are outside this
project format. No database is required to interpret these files.

Temporary `<filename>.tmp` files, `.chapter-create.lock` and
`.manuscript-replace.json` can also appear during interrupted operations. See
[recovery](#missing-corrupt-and-interrupted-data); they are not extra chapters.

## Text, JSON, identities and dates

Textual project data must be **UTF-8 without a byte-order mark (BOM)**. JSON uses
ordinary objects, arrays, strings, numbers, booleans and null where specified.
Literal Unicode and equivalent JSON escapes have the same meaning. Do not infer
meaning from indentation, key order or trailing whitespace.

**Implementation notes:** writers normally use two-space indentation, LF newlines
and a final LF. Readers also accept CRLF and no final newline. They decode UTF-8
and parse JSON without removing a BOM; a BOM causes JSON parsing to fail. The
current reader is not a fatal UTF-8 byte validator: damaged byte sequences can
decode as replacement characters. Independent recovery should retain the bytes
and use strict decoding when checking damage. Unicode normalization is not
performed; composed `é` and decomposed `e` + U+0301 can remain distinct. General
chapter/book strings are not restricted to ASCII or universally checked for XML
compatibility. Publication metadata has the additional restrictions below.

Project, chapter, history and descriptor identities use UUID v4 strings in
`xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx` hexadecimal form. Those schemas accept
uppercase hex, but generated IDs are lowercase; retain the exact spelling in
references, filenames and embedded IDs. Duplicate chapter references are rejected
case-insensitively. Managed image IDs require lowercase UUID v4. Publication
identity fields accept UUID strings without the same v4 restriction; cross-file
references must still match the referenced component's requirements.

All `created`/`modified` fields in the schemas below require a real UTC date in
exact `YYYY-MM-DDTHH:mm:ss.sssZ` form, for example
`2026-01-02T12:00:00.000Z`. They are metadata, not order or conflict-resolution
keys. A manifest timestamp is not a project-wide revision or checksum.

Use unique JSON object keys. **Implementation note:** most readers use the usual
JSON parser's last-value behavior for duplicates; the v1→v2 migration specifically
rejects duplicate top-level manifest keys. This is not universal duplicate-key
validation, and duplicates are unsuitable for portable interchange.

## `project.json`

| Field           | Type / presence                        | Meaning                                                                     |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `schemaVersion` | Required integer `1` or `2`            | Manifest version, not application version. New projects use `2`.            |
| `projectId`     | Required UUID v4                       | Stable project identity, also used by components belonging to this project. |
| `created`       | Required timestamp                     | Project creation time.                                                      |
| `modified`      | Required timestamp                     | Manifest modification time.                                                 |
| `bookFile`      | Required literal `"book.json"`         | Fixed metadata filename; not an arbitrary path.                             |
| `manuscript`    | Required object                        | Contains required `order`, an array of unique chapter UUID v4 strings.      |
| `formatFile`    | Required literal `"format.json"` in v2 | Fixed component-version descriptor; not part of the v1 schema.              |

Each `manuscript.order` entry resolves to `manuscript/<id>.json`, whose embedded
`id` must match. **This array is the authoritative chapter reading order.** Never
derive order from filenames, directory enumeration, status, chapter type or file
timestamps. No separate manifest file is used.

The [synthetic project's manifest](../tests/fixtures/public-example/project.json)
deliberately orders the lexically later filename first:

```json
{
  "schemaVersion": 2,
  "projectId": "00000000-0000-4000-8000-000000000900",
  "created": "2026-01-02T12:00:00.000Z",
  "modified": "2026-01-02T12:00:00.000Z",
  "bookFile": "book.json",
  "formatFile": "format.json",
  "manuscript": {
    "order": [
      "00000000-0000-4000-8000-000000000902",
      "00000000-0000-4000-8000-000000000901"
    ]
  }
}
```

## `format.json` and component versions

The v2 descriptor is a strict object with exactly these required fields:

```json
{
  "schemaVersion": 1,
  "projectId": "00000000-0000-4000-8000-000000000900",
  "bookSchemaVersion": 1,
  "chapterSchemaVersion": 1
}
```

`projectId` must equal the manifest identity. `schemaVersion` versions the
descriptor itself; the other two numbers identify the supported book and chapter
envelopes. Thus manifest v2 plus descriptor/book/chapter v1 is a complete current
project, not a partly upgraded one. Historical manifest v1 has implicit v1 book
and chapter components and does not require this file.

Publication, presentation, image metadata, history snapshots and archive manifests
each currently have `schemaVersion: 1`. They are independently versioned, not
enumerated in `format.json`. Their addition did not increment the manifest or
chapter version. Unsupported newer component versions must not be rewritten as
older versions. No application release number is stored as a compatibility rule.

## `book.json`

This is the required authoring metadata object, not the manuscript body.

| Field                 | Type / presence          | Meaning                                                              |
| --------------------- | ------------------------ | -------------------------------------------------------------------- |
| `schemaVersion`       | Required integer `1`     | Book metadata schema.                                                |
| `title`               | Required nonempty string | Working title.                                                       |
| `author`              | Required nonempty string | Author credit as a single string.                                    |
| `language`            | Required nonempty string | Language label; this schema does not enforce a language-tag grammar. |
| `created`, `modified` | Required timestamps      | Metadata creation/modification times.                                |
| `subtitle`            | Optional string          | Subtitle.                                                            |
| `publisher`           | Optional string          | Publisher credit.                                                    |
| `isbn`                | Optional string          | Identifier label; no ISBN checksum/registration validation.          |
| `description`         | Optional string          | Description.                                                         |
| `series`              | Optional object          | Required nonempty `name`; optional positive integer `number`.        |

Required nonempty strings and series name are trimmed by the current schema;
other optional strings can be empty. Null is not a substitute for an absent
optional field. There is no book UUID or chapter-order array here.

The [example book](../tests/fixtures/public-example/book.json) has the working
title `The Lantern Example — working title` and fictional author `Example Author`.
If `publication.json` exists, its separate metadata controls publishing. Changing
one metadata file does not automatically synchronize the other.

## Chapter files and semantic documents

Each `manuscript/<id>.json` has these required fields:

| Field                 | Type                                                             | Meaning                                              |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `schemaVersion`       | Integer `1`                                                      | Chapter envelope version.                            |
| `id`                  | UUID v4                                                          | Must match filename and manifest reference exactly.  |
| `type`                | `chapter`, `prologue`, `epilogue`, `frontmatter` or `backmatter` | Classification; does not change manifest order.      |
| `title`               | Nonempty string, trimmed                                         | Chapter title, separate from body headings.          |
| `status`              | `draft`, `revising`, `review` or `final`                         | Authoring state; does not imply inclusion/exclusion. |
| `created`, `modified` | Timestamps                                                       | Chapter creation/modification times.                 |
| `content`             | Semantic document object                                         | Authoritative body described below.                  |

Content is JSON in a constrained ProseMirror-style tree, **not HTML/XHTML**. No
ProseMirror library is needed to walk it. Each node has a `type`; children, when
present, are in the `content` array in reading order. Literal prose is in `text`
nodes' `text` strings. `attrs` and `marks` mean only the fields specified below;
arbitrary executable code, DOM attributes or editor state are not part of this
contract.

The root is `{ "type": "doc", "content": [...] }`. `content` may be absent or
empty. It contains zero or more block nodes. The current editing vocabulary is:

| Node             | Children and attributes                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph`      | Optional array of inline nodes.                                                                                                                                                                                       |
| `heading`        | Required `attrs: {"level": 1}` with integer level 1–6; optional inline children.                                                                                                                                      |
| `text`           | Inline: required nonempty `text`; optional `marks` array. No children.                                                                                                                                                |
| `hardBreak`      | Inline: optional `marks`; no text/children. A line break within a block.                                                                                                                                              |
| `blockquote`     | Required nonempty array of block nodes.                                                                                                                                                                               |
| `epigraph`       | Required nonempty array of paragraphs; optional `attrs` containing optional `attribution`, a string or null. Attribution is text worth recovering.                                                                    |
| `bulletList`     | Required nonempty array of `listItem` nodes.                                                                                                                                                                          |
| `orderedList`    | Required nonempty array of `listItem` nodes. Optional `attrs`; if present it requires integer `start`, with optional string-or-null `type`. The schema does not require a positive start or restrict the type string. |
| `listItem`       | Required array beginning with a paragraph, followed by zero or more block nodes, including nested lists. Valid only inside lists.                                                                                     |
| `codeBlock`      | Optional array of unmarked `text` nodes. Optional `attrs`; if present, `language` is required and is a string or null. Embedded line breaks remain literal text.                                                      |
| `image`          | Required `attrs` with lowercase UUID v4 `assetId`, string `alt` (0–4000 units) and `size`: `small`, `medium`, `large` or `full`. No children; original bytes live in assets.                                          |
| `sceneBreak`     | Only `type`; a semantic scene boundary, not stored decorative text.                                                                                                                                                   |
| `horizontalRule` | Only `type`; a separator.                                                                                                                                                                                             |

“Inline” means `text` or `hardBreak`. All other listed nodes except `doc` and
`listItem` are blocks. Attributes/children not listed for a node are not accepted.
String length limits in this document follow the implementation's JavaScript
UTF-16 code-unit counting, not grapheme or UTF-8 byte counts.

Marks are strict objects. `bold`, `italic`, `strike`, `underline` and `code` have
only `type`. A `link` mark requires `attrs.href` and allows optional string-or-null
`target`, `rel`, `class` and `title`. A mark type cannot appear twice on one inline
node. `code` cannot combine with another mark; other combinations are allowed.

Links accept absolute HTTP/HTTPS URLs with a hostname, `mailto:` with a nonempty
address/path, or `#` followed by a nonempty fragment. Leading/trailing whitespace,
ASCII controls, spaces and DEL are rejected. Filesystem paths, `file:`, executable
schemes and protocol-relative links are unsupported. A stored link is text and
metadata, not permission to fetch or execute its target. It is not a local asset.

For example, this is a complete supported document fragment from the example's
vocabulary (the chapter envelope is still required on disk):

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "A synthetic beginning" }]
    },
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "“Café” — Καλημέρα · こんにちは · مرحبًا · 😀 · é."
        },
        { "type": "hardBreak" },
        {
          "type": "text",
          "text": "Synthetic prose",
          "marks": [{ "type": "bold" }]
        }
      ]
    }
  ]
}
```

See the complete [first chapter](../tests/fixtures/public-example/manuscript/00000000-0000-4000-8000-000000000902.json)
and [second chapter](../tests/fixtures/public-example/manuscript/00000000-0000-4000-8000-000000000901.json)
for every supported node and mark, including nested lists, links, an epigraph and
an image. Reading text nodes in tree order recovers prose; keep the original JSON
to retain formatting, link attributes and structural distinctions.

**Implementation note:** the historical chapter envelope checks the root `doc`
but permits arbitrary nested node records. Current editor load/save applies the
stricter vocabulary above. Consequently a project can pass envelope-level opening
or migration yet contain a chapter the current editor refuses to edit. Unsupported
nodes must not be silently dropped to make such a chapter open.

## `publication.json`: metadata, matter and publishing order

This optional strict v1 component stores publishing-specific author data. It is
not a generated output. All fields below except `coverAssetId` are required.

| Field           | Type / meaning                                                       |
| --------------- | -------------------------------------------------------------------- |
| `schemaVersion` | Integer `1`.                                                         |
| `projectId`     | UUID matching the project.                                           |
| `metadata`      | Strict object described below.                                       |
| `pages`         | Array of at most 500 semantic matter-page objects, possibly empty.   |
| `body`          | Array of at most 10,000 chapter inclusion overrides, possibly empty. |
| `coverAssetId`  | Optional managed image UUID; resolved with the image rules below.    |

Metadata requires `title` and `author` (1–500 units each), `language` (at most 64,
matching `[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*`), `description` (0–20,000), and
`identifiers` (array of 0–20 strict objects). Each identifier has `scheme` equal to
`isbn`, `uuid` or `other`, and `value` of 1–256 units. The scheme labels do not
validate registration, ISBN checksums or UUID syntax of the value. These text
fields are not trimmed; they permit tab/LF/CR and Unicode scalar values from
U+0020 upwards except U+FFFE/U+FFFF, rejecting lone surrogates. These are publishing
text constraints, not a claim that all chapter strings have identical checks.

Each page requires `id` (UUID), `title` (1–500 units with the same text rules),
`type` (`title`, `copyright`, `dedication`, `acknowledgements` or `author`),
`placement` (`front` or `back`), `inclusion`, and `document` (the semantic root
defined above). Page text is stored **inside this JSON**, not under
`frontmatter/` or `backmatter/`. A body override requires only `id` and `inclusion`.
Every inclusion object requires three independent booleans: `navigation`, `ebook`
and `print`. Exclusion from an output does not delete content.

Page and body IDs together must be unique case-insensitively; page IDs must not
collide with manuscript chapter IDs. A chapter without a body override defaults
to all three flags true. Stale overrides for absent chapters do not create
chapters and are ignored when assembling the book. Body-array order is **not**
reading order.

Publishing uses the following assembled order, with inclusion flags applied for
the chosen output target (the assembled model itself retains excluded content):

1. Optional generated ebook cover from `coverAssetId` (no stored cover chapter).
2. Front pages in their relative order within `pages`.
3. Chapters in `project.json.manuscript.order`.
4. Back pages in their relative order within `pages`.

Interleaving front/back entries in `pages` does not interleave them with the body.
A chapter envelope's `frontmatter` or `backmatter` type does not relocate it out of
the manifest sequence. Recover **all** pages/chapters, including excluded drafts,
when the purpose is manuscript recovery rather than generating a particular book.

Without this file, publication reads derive title/author/language/description from
`book.json`, use its ISBN as an identifier if present, provide no matter pages and
include all chapters. Read-only derivation does not write a file. Once present,
publication metadata takes precedence for publishing while `book.json` remains
authoring metadata. There are no stored page timestamps, chapter envelopes or
revision hashes inside this component.

**Implementation note:** initial publication editing creates a verified local
snapshot under `.drelwick-publication-migration/backup-<uuid>/` before exclusively
creating the component. This additive initialization does not change book/chapter
bytes or project versions; v1 projects migrate to v2 first. Subsequent component
saves replace this one file atomically; the component is limited to 64 MiB.
Invalid/future publication data or an
unresolved temporary blocks publication operations, without requiring ordinary
chapter content to be discarded. Matter pages do not currently have per-page
chapter history. See [publication operations](publication-matter.md).

## `presentation.json`: selected theme

This optional strict object contains required `schemaVersion: 1`, `projectId`
(UUID v4 matching the project), and `themeId`. The latter is a lowercase slug of
at most 64 units matching `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`. Built-in choices are
`classic`, `modern` and `literary`. Absent settings mean Classic, without requiring
a new file. A well-formed but unavailable ID is retained and falls back to Classic
with a notice; malformed/newer settings block theme/publishing operations rather
than making ordinary manuscript text inaccessible.

This file stores selection, not CSS, fonts, executable theme code or a complete
theme model. The current reader limits it to 8 KiB. `styles/` has no implemented
custom-style contract. Built-in theme rendering is independent of Pro/plugins.

## Managed image assets

A semantic image or publication cover refers to an asset by ID, not URL or source
filename. For ID `00000000-0000-4000-8000-000000000903`, inspect:

```text
assets/images/00000000-0000-4000-8000-000000000903/
├── asset.json
└── original.png
```

The strict `asset.json` fields are all required:

| Field              | Type / meaning                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `schemaVersion`    | Integer `1`.                                                                                               |
| `id`               | Lowercase UUID v4 matching its directory and references.                                                   |
| `mediaType`        | `image/png` or `image/jpeg`. Determines `original.png` or `original.jpg`, respectively.                    |
| `originalFilename` | Informational source name, 1–255 units, no slash, backslash, ASCII control or DEL; never a path to follow. |
| `width`, `height`  | Positive integer pixels, each ≤12,000; product ≤24,000,000.                                                |
| `byteSize`         | Positive integer byte length ≤20 MiB (20 × 1024²).                                                         |
| `sha256`           | Exactly 64 lowercase hexadecimal characters: SHA-256 of the original bytes.                                |

The [example record](../tests/fixtures/public-example/assets/images/00000000-0000-4000-8000-000000000903/asset.json)
describes a 2×3 PNG of 96 bytes. Its image and cover references share the same
original. Multiple chapters/pages can share an asset. A JPEG source named `.jpeg`
still uses the managed filename `original.jpg`.

**Implementation notes:** metadata reads are bounded to 8 KiB. Import/read checks
the declared media type against actual complete PNG/JPEG structure, decoded
dimensions, byte length and checksum. Animated PNG, malformed containers and
trailing invalid data are unsupported. Original bytes are preserved, not silently
re-encoded. Asset import stages a directory before publishing the complete pair;
failed `.import-<uuid>` directories may remain for recovery. Removing a reference
does not delete a shared or unreferenced original automatically.

A missing or corrupt asset remains a reference with a recoverable error/placeholder;
it does not authorize fetching a replacement online. Keep the chapter's alt text
and UUID while recovering available files. Local originals and metadata must travel
with the project. Remote resources never silently become authoritative assets.
The legacy root `cover.jpg` is still admitted to backups but is not the current
managed-cover selection mechanism.

## Reference data and reserved structures

`reference/` exists as a standard supporting directory and its eligible files are
copied by backups. There is currently **no implemented reference-data schema**,
story-bible model, reference index or manuscript dependency on this directory.
A manuscript reader can ignore it for interpreting defined chapters, while a
recovery copy should retain any files the author placed there. The same caution
applies to unrecognized author files and the reserved matter/style directories.
Do not interpret these directory names as evidence of implemented page, font or
reference formats. This specification defines no prospective fields for them.

## Unknown data and forward compatibility

| Boundary                                                     | Current behavior                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Project/book/chapter/history envelopes                       | Unknown object fields are accepted but omitted from the schema's parsed projection. This is not a preservation guarantee.                       |
| Chapter semantic root/nodes/marks/attributes                 | Current editing validation rejects unsupported fields and node/mark types. The broader historical envelope alone is insufficient.               |
| Format, publication, presentation, asset and archive objects | Strict validation rejects unknown fields (including their defined nested objects).                                                              |
| Unreferenced files                                           | Not automatically part of the manuscript. Some complete recovery copies preserve them; portable backups use the explicit inclusion rules below. |

Some writers retain raw envelope fields; others serialize a parsed projection.
For example, saving chapter content currently retains an unknown chapter field,
but renaming that chapter drops it. The v1→v2 migration's special preservation
guarantee does not extend to every later editing operation. There is no generic
extension-data or Pro-metadata preservation mechanism.

An independent read-only consumer can ignore unknown envelope fields to recover
known content, but should retain original bytes. A writer must not claim lossless
round-trip support for unsupported data: reject the write or preserve a separate
unaltered copy and explicitly disclose any conversion. Do not insert proprietary
nodes/required fields and assume Community will preserve them. Future optional
Pro metadata needs a separately specified preservation policy; none is introduced
here. A newer version is not permission to reinterpret it as the current one.

## Migration and version handling

Version detection examines `project.json.schemaVersion` before interpreting its
fields. It must be a positive safe integer; absent, string, fractional or invalid
values are errors, not implicit v1. The current implementation supports v1 and v2,
rejects versions greater than 2 before writing migration/cache/lock artifacts,
and has **no downgrade operation**. Descriptor and component versions are also
checked. Optional component failures can be scoped to the operation using them;
opening the project summary is not proof that every image or publication is valid.

Desktop editing upgrades v1 to v2; low-level reading can inspect a valid v1
project without upgrading. The implemented transition:

1. Creates and independently verifies a complete local recovery snapshot.
2. Stages a v2 copy and validates its manifest and ordered chapter references.
3. Records commit intent, publishes `format.json` exclusively, then atomically
   replaces `project.json`.
4. Verifies completion; keeps original backup, staging and recovery records.

The only transformed existing file is the manifest: change its version and add
`formatFile`. Other manifest source text, including unknown metadata, numeric
precision and string escapes, is preserved. Book/chapter/history bytes, Unicode,
timestamps and chapter order are unchanged. An existing `format.json`, preexisting
`formatFile` field or duplicate top-level manifest keys blocks this transition
rather than being overwritten.

The `.drelwick-migration/` workspace contains versioned `state.json` recovery
records, `backup-<uuid>/` and `stage-<uuid>/`. The verified snapshot inventories
relative files/directories and their byte sizes/SHA-256 hashes. It copies regular
project contents, including unknown files, empty directories, history, orphan
chapters and temporary recovery prose, excluding the schema/publication migration
workspaces and the operation lock. This is broader than the filtered portable ZIP.
Current snapshot limits are 10,000 files, 10,000 directories, 64 directory levels
and 2 GiB of file bytes; backup and staging need additional disk space.

Failed copy/verification does not change authoritative files. Interrupted commit
is resumed using recorded original/target hashes; an unexpected third revision
or invalid journal blocks editing and preserves artifacts for explicit recovery.
A completed migration must not replay staged files over later edits. Recovery
copies remain outside ordinary history retention. To recover independently, copy
the verified `backup-<uuid>/` into a new destination and inspect that v1 project;
retain the failed original and workspace. Do not manually replay journal operations
into the only copy of a manuscript.

**Implementation note:** the detailed journal/lock protocol is described in
[migration implementation notes](project-format.md). It is not an additional
authoring schema or a synchronization protocol. Future transitions must be ordered,
explicit version-to-version transformations with retained historical definitions
and recovery tests. No future transition or compatibility promise is defined here.

## Local history, backups and recovery copies

These have different purposes:

| Mechanism              | Contains                                                                  | Needed to read current manuscript?                            |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Current project        | Authoritative metadata, order, semantic documents and managed assets      | Yes, relevant components as described above.                  |
| Local chapter history  | Earlier semantic content for individual chapters                          | No; auxiliary and subject to retention.                       |
| Deleted chapter copies | Removed chapter envelopes                                                 | No; useful for recovering removed work.                       |
| Migration snapshots    | Verified pre-operation filesystem copies and recovery records             | Not for an intact completed project; preserve after failures. |
| Portable ZIP backup    | Filtered project copy with versioned checksum inventory; optional history | Independent recovery copy, not the live authoritative store.  |

History files at `.history/snapshots/<chapter-id>/<snapshot-id>.json` require
`schemaVersion: 1`, `id` (snapshot UUID v4), `chapterId` (UUID v4), `created`
(timestamp), `reason`, and semantic `content`. Reasons are `interval`, `manual`,
`migration`, `before-import`, `before-recovery`, `before-replace`,
`before-restructure` and `status-change`. IDs relate the file to a chapter; each
snapshot is a content document, not a full chapter with title/status or a project
with assets/order/publication metadata. To recover text, walk its `content` tree
just like chapter content. Referenced images still require available originals.

**Implementation note:** interval history is normally spaced five minutes apart;
retention keeps recent snapshots densely and older ones sparsely over a 30-day
window. It is not permanent source control or an off-device backup. Deleted
chapters are retained as complete chapter JSON under
`.history/deleted/<chapter-id>-<unique-id>.json`. These do not automatically restore
their former position in the manifest. History is not required for normal opening.

### Portable local backup envelope

A `.drelwick.zip` is an ordinary, unencrypted ZIP containing project files at its
root (no required enclosing project folder), plus UTF-8 `.drelwick-archive.json`.
Stored/deflated ZIP entries use UTF-8 names and `/` separators. The strict manifest
has these required fields:

| Field             | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `schemaVersion`   | Integer `1`, archive envelope version independent of project version.                  |
| `projectId`       | Source project UUID v4, matching the project.                                          |
| `created`         | Archive creation timestamp.                                                            |
| `includesHistory` | Boolean recording whether history was requested. It does not imply any history exists. |
| `files`           | Array of at most 10,000 strict inventory entries.                                      |

Each entry requires `path` (relative path string, 1–1024 units), `size` (nonnegative
integer uncompressed bytes) and `sha256` (64 lowercase hex characters). The manifest
inventories every payload file, **not itself**. Exact inventory membership, sizes
and SHA-256 hashes are verified on restore. This detects damage; it is not an
authenticated signature against someone replacing both files and the inventory.

Included roots, when present, are `project.json`, `book.json`, `format.json`,
`presentation.json`, `publication.json` and legacy `cover.jpg`. Regular files are
included recursively under `manuscript/`, `frontmatter/`, `backmatter/`, `assets/`,
`reference/`, `styles/` and, if requested, `.history/` (default true). Empty
directories need not be represented; restore creates standard project directories.

The inclusion filter excludes the following names case-insensitively:

- File or directory names: `.chapter-summaries.json`, `.chapter-create.lock`,
  `.drelwick-archive.json`, `credentials.json`, `secrets.json`, `.env`, `.env.*`,
  and suffixes `.tmp`, `.lock`, `.log`, `.pem`, `.key`, `.p12`, `.pfx`.
- Additional directory names: `.git`, `node_modules`, `dist`, `build`, `out`, `coverage`,
  `test-results`, `playwright-report`, `.cache`, `cache`.

Other root files and migration workspaces are not in the inclusion list. Therefore
a ZIP is **not** a complete raw filesystem snapshot or a promise to retain every
unknown file. Keep a separate full copy when recovering interrupted operations.

The current reader rejects absolute/traversal/drive paths, backslashes, colons,
platform-invalid names, links/special files, encrypted/unsupported ZIP entries,
and duplicate paths (including case/Unicode-normalization collisions). Its budgets
are 1 GiB compressed archive, 2 GiB total expanded bytes, 512 MiB per file and
16 MiB archive manifest, in addition to the inventory count. Checksums and core
project validation precede activation; this does not constitute exhaustive
semantic, publication or image validation of every component.

Backup stages a consistent saved copy and checks its inventory/fingerprints before
writing. Restore extracts and verifies in staging, then publishes a **new** child
directory; it does not overwrite an existing project. The archive envelope is not
copied into that restored project's authoritative metadata. See
[backup operation notes](project-backups.md) for application behavior.

A remote/provider backup must never silently become the authoritative manuscript
store or replace a local project without an explicit restore operation. Normal
Community projects and local backup/restore require no remote service. No provider
protocol, credentials format, collaboration or synchronization is defined here.

## Missing, corrupt and interrupted data

Preserve the original directory/archive before repair. Missing required metadata,
malformed JSON, unsupported versions, missing ordered chapter files or mismatched
IDs prevent a valid project open; the loader does not silently drop the reference
or replace it with an empty chapter. A corrupt component need not prevent ordinary
tools from recovering the other intact files.

The summary cache is disposable and can be rebuilt; it is never the source for
chapter prose or authoritative order. A quick cached open does not validate every
semantic node. Invalid optional publication/presentation components block their
operations. Missing images retain recoverable references. Unknown author files
and orphan chapters should be inspected separately, not guessed into reading order.

**Implementation notes:** single-file saves write an exclusive sibling `.tmp`,
flush it and rename it over the destination. Existing temporaries block overwrite
so earlier recovery material is retained. Failed saves preserve the previous valid
file; an interrupted operation may leave an extra candidate. Multi-file manuscript
replace/restructure operations use a versioned `.manuscript-replace.json` journal
with before/after chapter data and, when applicable, structural manifest data.
Pending operations block ordinary access until resolved. These are recovery
artifacts, not alternate current manuscripts or general transaction APIs.

Startup recovery can offer valid newer chapter temporaries/history for explicit
review. It does not blindly promote malformed, unsupported or ambiguous files.
Inspect both copies manually if automated recovery cannot proceed. Do not delete
locks, journals or temporary prose merely to force opening. Filesystem failures
and physical storage loss can defeat any local copy; flushing/rename is not a
guarantee against every power failure, and there is no cross-machine synchronization.

## Independent recovery with ordinary tools

These steps require no Drelwick installation or packages:

1. Copy the project to a safe new directory; work on the copy. For a backup, inspect
   the ZIP listing with an ordinary ZIP tool, then extract into a **new empty**
   directory. On Windows, `Expand-Archive -LiteralPath example.drelwick.zip
-DestinationPath recovered-example` works; on other systems an ordinary ZIP
   extractor can do the same. Never extract an untrusted archive over a live project.
2. Open `.drelwick-archive.json` if present. Check its version and each inventory
   path, byte length and SHA-256 with ordinary hash tools (PowerShell `Get-FileHash
-Algorithm SHA256`, `sha256sum`, or equivalent). This envelope is not chapter
   order. Preserve the original archive even after extraction.
3. Open `project.json` and `book.json` in a UTF-8 editor/JSON viewer. Check project
   identity/version and, for v2, `format.json`. Copy title/author/language and any
   other available metadata. Inspect `publication.json` separately for publication
   metadata and matter text; both sets of metadata can be useful.
4. Read `manuscript.order` **in array order**. For each ID, open
   `manuscript/<id>.json`, verify its embedded ID and retain its title/status.
   Do not sort filenames. Recover front pages before this sequence and back pages
   after it, retaining their relative array order and excluded drafts.
5. Walk each chapter's `content` or matter page's `document` tree in child-array
   order. Copy every text node's string; insert line breaks for `hardBreak` and
   paragraph/heading/list-item boundaries. Retain epigraph attribution, headings,
   list structure, code text, links, image alt text and scene boundaries. Flattened
   prose is a useful recovery product, but keep JSON to preserve full semantics.
6. For each image `assetId` and `coverAssetId`, open
   `assets/images/<id>/asset.json`, then its `original.png`/`original.jpg`. Compare
   size/hash to metadata and copy the original. Do not fetch URLs to fill gaps.
7. If data is missing, inspect orphan chapter files, deleted chapters, snapshots,
   `.tmp` files and pre-migration backup directories on the copy. Record unresolved
   gaps rather than inventing order or overwriting the only source.

For example, ordinary PowerShell JSON inspection lists the body order and titles:

```powershell
$recoveryRoot = 'recovered-example'
$manifest = Get-Content -LiteralPath "$recoveryRoot/project.json" -Raw -Encoding utf8 | ConvertFrom-Json
$manifest.manuscript.order | ForEach-Object {
    $chapter = Get-Content -LiteralPath "$recoveryRoot/manuscript/$_.json" -Raw -Encoding utf8 | ConvertFrom-Json
    [pscustomobject]@{ Id = $chapter.id; Title = $chapter.title }
}
```

This illustration assumes the known-valid example IDs. For unfamiliar input,
validate IDs as UUIDs before using them in paths, and inspect damaged JSON as text
if a parser refuses it. The original semantic strings remain readable without a
recovery script.

An optional standalone helper, [recover-project-text.mjs](../scripts/recover-project-text.mjs),
automates text/asset inspection using only Node's standard library:

```sh
node recover-project-text.mjs recovered-example > recovered-text.json
```

It can be copied out of this repository and run without installing any packages.
It reads without writes, migration, application startup or network access. It
includes hidden matter, emits links as data and verifies referenced asset hashes.
It is an example extractor, not a second format validator or a lossless editor:
formatting is flattened, unreferenced/history files require separate inspection,
and unsupported nodes, damaged files, nesting beyond 64 levels or individual files
over 64 MiB require manual recovery. Its budget is not a project-format size limit.

## Synthetic example and executable verification

[tests/fixtures/public-example/](../tests/fixtures/public-example/) contains only
synthetic prose and fictional credits: nine UTF-8 JSON files and one 96-byte PNG.
It includes project v2, component versions v1, book/publication metadata, a Literary
theme selection, two deliberately reverse-filename-ordered chapters, all supported
nodes/marks, multilingual and combining Unicode, a shared inline/cover asset,
front/back matter, an excluded dedication and one manual local-history snapshot.
Empty reserved directories are omitted; no reference schema is invented.

Recovery yields front title `…904`, hidden dedication `…905`, body `…902` then
`…901`, and back author page `…906`. The publication `body` array is deliberately
in the opposite order, and the back page appears first in `pages`, proving that
neither array position across placements nor override order replaces manifest
order. The image original is recovered at `assets/images/…903/original.png`.

The [public-format tests](../packages/core/test/public-project-format.test.ts)
use production schemas, current loading/saving/assembly and archive creation/
restore. They also copy the helper outside the repository and recover exact text
without application imports; independently decode ZIP entries and verify every
inventory hash; exercise optional history, Unicode/newlines/BOM and unknown-data
behavior. [The #58 review](planning/58-format-review.md) records the implementation
cross-check and an ordinary-tool recovery exercise. Later persistent additions
must update this specification and its example tests; prospective reference,
Pro metadata, provider, custom-style and future publishing schemas are not part
of the current format.
