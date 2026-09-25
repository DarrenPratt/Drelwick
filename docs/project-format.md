# Project format and local migration

## Pre-release product identity

Drelwick uses `@drelwick/*` workspace packages and the restricted
`window.drelwick` preload API (`DrelwickApi`). Application settings,
recent projects, Chromium session data and unclean-session recovery live in
`appData/@drelwick/desktop`; an explicit `--user-data-dir` takes precedence.
Logs use `drelwick.log`.

Portable backups use `.drelwick.zip` filenames and a
`.drelwick-archive.json` manifest. Schema migration recovery uses
`.drelwick-migration/`. This is a clean pre-release identity change: previous
application profiles, archive manifests and interrupted migration directories
are not discovered or converted. Development data in those locations is left
untouched. Finish any in-progress schema migration with its originating build
before using that development project here, and recreate development backups.

Project and chapter schema versions and manuscript content are unchanged. The
existing version-1-to-version-2 schema migration remains part of normal project
loading; it is unrelated to the product rename. Projects remain directories
containing `project.json`, rather than using a branded project-file extension.

The existing GitHub repository and project board have also been renamed; see
the [tracking register](planning/github-tracking.md#pre-release-product-identity).

## Implemented format

The [staged manuscript import pipeline](manuscript-import.md) translates validated
imports into this existing format. Its temporary intermediate envelope is internal
version 1; it does not change authoritative project or component versions.

This is the implemented format including issues #111–#113. Project files are authoritative;
EPUB, PDF and DOCX outputs are not. All JSON is UTF-8. No account, service or Pro
package is needed to read, migrate, back up or recover a project.

## Version 1

Issue #122 adds optional `presentation.json`, an independently versioned component
containing `schemaVersion: 1`, the project UUID and a safe stable `themeId` slug.
It does not change manifest/book/chapter schema versions. Missing settings default
to Classic without rewriting chapters; unavailable IDs preserve their saved value
and display Classic with a notice. See [theme persistence and recovery](book-themes.md#persistence-and-recovery).
Portable backups include this component. Malformed/future presentation configuration
blocks publishing/theme changes, while authoring remains available.

Historical schemas are retained in `packages/project-model/src/versions/v1.ts`.
They are not replaced by the current format definition.

| File                     | Version | Contents                                                                                                                                                                                                    |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.json`           | 1       | UUID v4 `projectId`, `created`/`modified` ISO timestamps, literal `bookFile: "book.json"`, and `manuscript.order`, an ordered array of unique chapter UUIDs. Duplicate IDs are rejected case-insensitively. |
| `book.json`              | 1       | Required title, author, language and timestamps; optional subtitle, publisher, ISBN, description and series name/positive integer number.                                                                   |
| `manuscript/<uuid>.json` | 1       | UUID, type, title, status, timestamps and a ProseMirror `doc` content object. The filename and embedded UUID must match the manifest reference.                                                             |

Chapter types are `chapter`, `prologue`, `epilogue`, `frontmatter`, `backmatter`.
Statuses are `draft`, `revising`, `review`, `final`. The manifest defines order;
filenames never imply order. Unreferenced files are preserved for recovery.

`frontmatter/`, `backmatter/`, `assets/`, `reference/`, `styles/` and `.history/`
hold supporting data. `.chapter-summaries.json` is a disposable, version-1 cache.
Issue #113 stores versioned image records and byte-preserved originals under
`assets/images/<uuid>/`; manuscripts reference only the UUID. See
[local image assets](local-image-assets.md) for the format, security and recovery
contract. This is an additive vocabulary with independent version-1 asset records,
not a change to the existing project or chapter envelopes.
History snapshots, recent-project settings, the session marker and portable ZIP
manifest each have their own version-1 envelope. Settings/session data live outside
the project; machine-specific paths do not become project metadata.

The chapter envelope accepts a ProseMirror document; editor load/save additionally
checks the supported semantic node/mark vocabulary. Migration preserves historically
accepted content even when the current editor cannot edit a particular node. It
does not normalise, silently remove or rewrite such content.

Issue #112 adds headings, nested lists, validated links and epigraphs to the
deliberate editor contract without changing the version-1 chapter envelope.
All previously supported structural nodes and marks remain valid and existing
files are not rewritten. See [manuscript semantic elements](manuscript-semantics.md).
Any future incompatible document change must increment `chapterSchemaVersion`
and use the recoverable migration framework rather than redefining this version.

## Version 2

New projects use version 2. This version introduces an explicit component-version
descriptor so future publishing additions do not imply rewriting every chapter.
It defines no themes, assets, front/back matter semantics or print settings; those
remain the responsibility of their respective implementation issues.

`project.json` changes to `schemaVersion: 2` and adds `formatFile: "format.json"`.
The new authoritative `format.json` is:

```json
{
  "schemaVersion": 1,
  "projectId": "00000000-0000-4000-8000-000000000001",
  "bookSchemaVersion": 1,
  "chapterSchemaVersion": 1
}
```

Its project ID must match `project.json`. **Book and chapter schemas remain at
version 1.** This combination is the specified v2 format, not a partially migrated
project. The format descriptor is included in portable ZIP backups.

The V1 -> V2 transformation changes only the manifest's version number and adds
its descriptor reference. It preserves the remaining manifest text, including
unknown metadata, numeric precision and escaped strings. `book.json`, all prose,
formatting, Unicode, chapter order, chapter timestamps and history remain
byte-identical. An existing `format.json`, an existing unknown `formatFile` field,
or duplicate top-level manifest keys blocks migration rather than overwriting or
ambiguously interpreting author data.

## Detection and compatibility

`detectProjectVersion` examines the envelope before schema interpretation:

- Positive integer 2 is the current project version.
- Version 1 is supported historical input requiring migration for desktop editing.
- A version greater than 2 is unsupported and requires a newer compatible
  Drelwick. It is rejected before migration artifacts, caches or locks are written.
- Missing, string, fractional, zero, negative or otherwise malformed versions fail
  explicitly. Missing/corrupt JSON is not treated as version 1.

The descriptor and book/chapter component versions are checked too. Newer
unsupported data is never downgraded or interpreted through an older schema.
Low-level `openProject` remains capable of reading a valid historical backup;
desktop open uses `openProjectForEditing`, which migrates before activation.

Future versions must retain historical schemas and transformations, define a
specific `from`/`to` transition, extend the migration sequence and compatibility
tests, and update this document. They must not redefine V1 -> V2 to mean "whatever
the current application expects".

## Complete backup and staging

Migration creates `.drelwick-migration/` inside the project. It contains a
versioned `state.json`, owner/recovery records, `backup-<uuid>/` copies and
`stage-<uuid>/` directories. These are recovery artifacts, not the editor's
authoritative manuscript. No authoritative file changes before backup verification.

The backup copies **every regular project file and directory**, including unknown
author files, assets, empty directories, unreferenced chapters, history and `.tmp`
recovery prose. Only the migration workspace itself and its operation lock are
excluded. This intentionally differs from portable ZIP backup's sharing-oriented
exclusions: ZIP archives omit unknown roots and transient files and therefore are
not a complete pre-migration recovery copy. Local snapshots reuse the checksummed
inventory schema and the existing atomic JSON writer.

Verification independently re-reads the copy, checks the complete directory/file
inventory, byte sizes and SHA-256 hashes, and validates the real V1 project and
ordered chapter references. It re-inventories and hashes the source to confirm it
still equals the captured revision. A failed copy or verification aborts before
authoritative mutation. A retry retains partial copies and starts a separate copy;
it never overwrites the verified backup.

Staging copies the verified backup into a separate directory, verifies its bytes,
applies the fixed V1 -> V2 manifest transformation, adds the descriptor, then
validates the full staged project without rebuilding caches. Target checksums are
recorded before commit. The original backup remains V1 and independently readable.

Symlinks, junctions, special files and unsafe paths are rejected rather than
followed. The complete snapshot currently permits at most 10,000 files, 10,000
directories, 64 directory levels and 2 GiB of file data. Copying requires space for
both backup and staging in addition to the original; failed attempts consume
additional space until explicitly removed by the author. Disk/access failures
retain recoverable copies and report fixed, content-free errors.

## Journal and recoverable commit

The journal records `from: 1`, `to: 2`, project identity, backup/staging names,
the original inventory, staged target hashes, phase and committed-file progress.
The existing atomic writer publishes journal updates after flushing the temporary
file. A unique temporary name avoids overwriting an earlier recovery artifact.

| Recorded phase                    | Authoritative changes allowed                      | Reopen behaviour                                                                                           |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| No workspace                      | None                                               | Validate compatibility, then begin migration.                                                              |
| Workspace with no initial journal | None                                               | Initialize only when it contains exclusively known initial owner/journal artifacts; otherwise fail closed. |
| `preparing`                       | None                                               | Retain partial copies and create/verify a fresh backup.                                                    |
| `backup-verified`                 | None                                               | Reverify backup and unchanged source, then stage.                                                          |
| `staging`                         | None                                               | Retain partial staging and recreate it from the verified backup.                                           |
| `validated`                       | None                                               | Reverify staged files, backup and source, then record commit intent.                                       |
| `committing`                      | Descriptor and/or manifest may have been published | Match files against journaled original/staged hashes and replay the two publication steps idempotently.    |
| `committed`                       | Both new targets published                         | Reverify/replay recorded targets as needed, validate authoritative V2 and finalise.                        |
| `complete`                        | Normal application editing resumes                 | Validate current V2; never replay old staged content over subsequent edits.                                |

Commit order is fixed:

1. Record `committing` before publishing either authoritative target.
2. Publish `format.json` exclusively through a hard link; never overwrite an
   unrelated file that appeared at that path. Record progress.
3. Atomically replace `project.json` with the flushed, checksummed staged version.
   Record progress. Existing manuscript and book files are not written.
4. Validate the resulting project, record `committed`, reverify the result and
   record `complete`. Release the owned operation lock.

A crash between publication and progress recording is resolved using the original
and target hashes already in the commit-intent journal. Recovery does not infer
intent from whichever files happen to exist. An unexpected third revision,
missing/corrupt verified backup, unsafe path or malformed journal blocks editing
and preserves all artifacts for explicit recovery. External edits are never
silently overwritten to force completion.

The coordinator acquires the existing `.chapter-create.lock` exclusively using a
hard link to a durable migration owner record. Normal chapter-operation lock
directories are never reclaimed. A migration lock can be reclaimed only when its
inode matches its owner record, the host matches and the recorded process is
known to have exited, or the same process has recorded that its operation finished
but lock cleanup failed. Token-specific exclusive recovery claims serialize competing
recoverers; a crashed claimant can itself be recovered. Live, inaccessible,
foreign-host or potentially reused process IDs fail safely as busy. This does not
provide live network-drive synchronization or protection from external tools that
ignore the lock.

Complete backups, journals and staging are retained; finalisation does not delete
the only recovery copy. They are outside ordinary history retention. Preserve the
whole folder after a failure. For independent manual recovery, **copy** the verified
`backup-<uuid>/` into a new empty destination and validate/open that V1 project;
keep the failed original and all recovery artifacts until the contents are checked.
The application normally resumes automatically rather than replacing the whole
original folder from backup.

Files are flushed before publication. Directory entries are also flushed where
supported. Node on Windows does not expose directory fsync; durability after actual
power loss depends on the filesystem/hardware honouring completed writes and
renames. No software protocol can recover bytes lost from both original and
backup by storage failure. Tests simulate process termination and filesystem
failures; they do not claim physical power-cut validation on all three platforms.

## Desktop and error boundaries

Desktop open performs native/recent-path authorization, read-only inspection,
version detection, interrupted-migration recovery/migration, full validation, and
only then exposes body-free workspace summaries. Unclean startup recovers existing
migration journals before scanning chapter recovery candidates. A failure blocks
startup/editor access. Opening, chapter recovery and history operations reject an
unfinished migration; history retention cannot prune migration backups.

Privileged work stays in core/main. Preload/IPC payloads do not gain arbitrary
paths, migration hooks or filesystem access. Context isolation, sandboxing and
disabled renderer Node integration are unchanged. Migration errors contain fixed
messages, never parser payloads, manuscript bodies or raw filesystem causes.
`PROJECT_SCHEMA_UNSUPPORTED`, `PROJECT_VERSION_MALFORMED`, backup creation and
verification errors, staged-validation errors, commit errors, recovery-required
and invalid-state errors remain distinguishable domain codes.

## Executable evidence

Tests copy the real deterministic V1 fixtures `minimal-book`, `unicode-book`,
`formatted-book`, `multi-chapter-book` and `recovery-project`. Canonical fixtures
remain V1. Additional unknown metadata/files and recovery temporaries are synthetic
and created only in disposable copies; no real manuscripts are used.

Failure tests throw or terminate a child process before/after workspace and lock
acquisition, initial journal, backup copying/verification, staging/validation,
commit intent, each file publication and its progress journal, authoritative
commit, finalisation and lock release. Further process tests interrupt recovery
claiming itself. Every normal transition is followed by repeated reopen, full
backup verification and byte comparisons of the original prose. Tests also cover
backup corruption, staging corruption, rename failure, external revisions,
concurrent calls, unsafe paths, unsupported/malformed versions, retained edits
after completion, archive round trips and the desktop authorization/startup gates.
