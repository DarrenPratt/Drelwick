# Staged local manuscript import

Issue #114 is CORE infrastructure. The desktop registry now includes the
[`docx` adapter](docx-import.md) from #115. The [preview/mapping workflow](import-review-ui.md) from #116 uses this API.
Text/Markdown/HTML remains #117. Unknown adapter IDs return `IMPORT_UNSUPPORTED`.
No account, hosted conversion, Pro package or network connection is required.

## Trust and lifecycle

```text
native source picker -> bounded privileged read -> isolated first-party parser
-> untrusted serialized result -> structural/semantic/image validation
-> validated intermediate manuscript -> private stage and inspection
-> explicit commit + native empty-folder picker -> revalidation
-> staged current-format project -> exclusive manifest publication
```

`ImporterResult` in project-model contains metadata, ordered semantic chapters,
PNG/JPEG bytes with UUID identifiers, and located warnings. Warning locations
contain a bounded label plus optional zero-based chapter and source-block indices;
they contain no parser objects or source paths. Source block indices may describe
content omitted during conversion. The chapter index must identify a proposed
chapter. Metadata translates to the existing book fields. Unsupported metadata
must produce an adapter warning rather than become arbitrary project fields.

`validateImportedManuscript` accepts serialized JSON as untrusted data. It bounds
bytes, depth, values, strings and arrays before schema validation, rejects unknown
fields and unsupported semantic nodes/marks, and verifies asset references and
unique asset IDs. Only validated output receives the `ValidatedManuscript` type.
Core additionally decodes every asset using the existing strict image validator.
No imported filename becomes a path. Asset UUIDs are validated; chapter/project
identifiers and timestamps are newly generated during commit.

The renderer can call `imports.inspect({ operationId, importer })`,
`imports.cancel(operationId)`, `imports.commit(operationId, review)` and
`imports.open(operationId)`. Review contains bounded chapter-start indices/titles
and individual warning approvals; it cannot replace manuscript content. The operation ID
is a UUID selected before inspection so cancellation is possible while parsing.
The ID is bound to the authorized main frame, not a transferable filesystem grant.
One operation is allowed at a time. Main checks the trusted window/frame/URL and
startup recovery gate, validates strict request schemas, and revalidates outgoing
inspection data. Inspection contains metadata, proposed chapter documents, asset
summaries and warnings. No source/destination/staging paths, raw image bytes,
parser programs, shell commands or filesystem APIs cross this interface.

Inspection never creates an authoritative project or changes the active workspace.
Commit asks for a destination separately. Dismissing that picker retains the
preview. A completed commit returns the new project ID and does not activate the
project, replace dirty editor state or update the active project's history.
The review UI explicitly opens the committed project through a one-use, frame-owned
destination/identity grant in the existing project-open handler. That handler validates
the actual committed project before activation. See [review and decisions](import-review-ui.md).

## Parser execution

Desktop registration accepts only packaged `IsolatedManuscriptImporter` adapters.
An adapter is a trusted, synchronous JavaScript function taking a base64 source
string and returning serialized `ImporterResult` JSON. Bundle parser dependencies
into that function: runtime module loading is unavailable. Never construct parser
programs from source documents, renderer input or third-party plugins.

The runner executes the function in a worker with a fresh VM context containing
JavaScript intrinsics only. It supplies no `fetch`, XHR, WebSocket, Node require,
process, filesystem, shell, timer or browser/DOM capabilities. Dynamic string/Wasm
code generation and runtime imports are unavailable. The document is supplied as
a quoted string argument, never evaluated. Scripts, macros, external entities and
relationships must remain data. Future adapters must preserve/report unsupported
content and must not evaluate it. This is isolation for audited first-party
parsers handling untrusted documents, not a security boundary for hostile plugins.

Execution has a 30-second VM timeout, 35-second worker deadline, 384 MiB old-space,
32 MiB young-space and 4 MiB stack limits. V8 limits are not a total process-memory
guarantee; bounded source/output and adapter-specific expansion limits are also
required. Cancellation terminates the worker. Only bounded string output crosses
back; errors are replaced with fixed content-free messages. No import code logs
manuscript content, raw exceptions, paths, images or warning text.

## Limits

`IMPORT_LIMITS` is the shared import validation policy:

| Resource                                     | Limit                       |
| -------------------------------------------- | --------------------------- |
| Source                                       | 64 MiB                      |
| Serialized parser output                     | 128 MiB UTF-8               |
| Intermediate stage / generated project stage | 128 MiB each                |
| Chapters / assets / warnings                 | 1,000 / 256 / 1,000         |
| JSON depth / visited values                  | 64 / 1,000,000              |
| General manuscript strings                   | 1,000,000 UTF-16 code units |
| Title / author / language                    | 500 / 500 / 100 code units  |
| Chapter title / location label               | 200 code units              |
| Other metadata / warning message             | 4,000 code units            |

Base64 asset strings have their own size allowance. Images retain `IMAGE_LIMITS`:
20 MiB each, 24 million pixels, 12,000 pixels per side, static PNG/JPEG only.
The generated-project budget includes indented JSON, asset bytes and asset records;
replacement metadata is conservatively counted again. Temporary disk use includes
both the intermediate and generated project stages. Format-specific parsers must
also bound archive entries, expansion and XML structures within their worker.

## Filesystem and commit

Source reads reuse the existing bounded image-file reader and path checks: absolute
local paths only; no traversal, UNC paths, alternate streams, control characters,
symlinks, junctions, hard-linked source files or nonregular files. Every ancestor is
checked. Native selection authorizes source/destination access; renderer paths are
never accepted. Destinations must already exist and be empty, and may not be inside
an existing project. These checks coordinate application operations; they do not
claim protection from a hostile external process replacing directories concurrently.

Inspection writes a private `sarel-manuscript-import-*/manuscript.json` under the OS
temporary directory, with an exclusive file create and flush. It has an internal
`schemaVersion: 1` envelope containing `manuscript`. The coordinator retains its
SHA-256 digest. Commit rereads it with bounded safe-path checks, verifies the digest
and revalidates all data and images. Mutating a preview cannot change staged data.

Commit builds `.sarel-import-<uuid>/` inside the selected destination, reusing
`createProject`, existing schemas, the atomic JSON writer and directory flushing.
This keeps publication on one filesystem. Current project format remains v2;
book/chapter/image component versions remain v1. No migration or existing-save
rewrite is necessary. Supporting directories are claimed exclusively and populated;
book/format files are linked exclusively. Finally `project.json` is published by
an exclusive hard link. An existing file is never replaced. Filesystems without
hard-link support fail safely before project publication.

The destination inventory is rechecked before publishing supporting data and
again before the manifest: content introduced during staging causes rejection
and is preserved. The inspection cancellation signal remains attached to the
stage; supplying a fresh commit signal cannot revive a cancelled import.

That final link is the commit point. Before it, failure or cancellation removes
owned artifacts and cannot leave an openable destination project. After it, the
complete project is authoritative: late cancellation or cleanup failure does not
report the completed import as failed. Post-commit cleanup/flushing failures
return success with an explicit warning. Directory fsync has the existing Windows
limitations described in [project format](project-format.md).

## Cancellation and recovery

Cancellation propagates from IPC through the parser and coordinator, with checks
around reads, staging, image validation, chapter writes, publication and the final
commit point. Navigation, renderer loss and application quit also abandon the
operation. No cancellation is blocked behind the busy-operation check.

Normal failures/cancellations remove private and destination staging and only the
destination artifacts created by this import. Source documents, active projects
and prior saves are never written. A failed attempt consumes its stage capability;
retry begins with a fresh inspection.

Cleanup failures before publication return `IMPORT_CLEANUP_REQUIRED` through IPC,
including when cancellation was the original reason for stopping. Process
termination or cleanup permission failures may retain temporary data.
Preserve it for inspection; do not infer a successful import from staging alone:

- A private `manuscript.json` is a versioned intermediate recovery copy, never an
  authoritative project. The source remains the normal retry input. The current
  API does not resume old session tokens automatically.
- A destination without root `project.json` is incomplete and must not be opened
  as a successful import. Preserve its contents and retry into another empty
  folder. After verifying the unchanged source, the abandoned folder can be
  removed explicitly; the importer will not overwrite it on retry.
- A destination with a successfully published root manifest contains the complete
  project. Validate/open it normally. A retained `.sarel-import-<uuid>` directory
  is a cleanup artifact; it is not an alternate authoritative project.

Automatic broad temp-directory deletion is deliberately avoided. Existing
manuscript recovery, migrations and history retention are unchanged.

## Dependency and test evidence

#112 supplies shared headings/lists/links/epigraph validation and semantic round
trips. #113 supplies strict local image decoding, image references, managed asset
records and path validation. #14 supplies v2 project creation with validated
metadata, IDs, timestamps, layout and failure cleanup. Their implementations were
inspected rather than inferred from closed issue status.

`packages/core/test/manuscript-import.test.ts` covers content/asset preservation,
invalid and oversized results/sources, structural limits, executable/remote image
rejection, cancellation, partial writes, staged tampering, destination collisions,
traversal/links, network-free parser execution and worker termination.
`apps/desktop/test/manuscript-import-ipc.test.ts` covers authorized native selection,
path-free preview, strict input, frame/token authorization, separate commit,
cancellation during parsing, picker dismissal and navigation abandonment.
