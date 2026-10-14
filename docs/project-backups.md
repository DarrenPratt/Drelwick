# Portable project backups

Use **File → Back Up Project** to save a local `.drelwick.zip` copy, and
**File → Restore Project Backup** to restore one. These commands work offline and
do not use a Drelwick account or remote service. The active chapter is flushed
before either operation can replace the workspace. If saving fails, the command
stops and the unsaved editor state stays open.

## Archive format

Archive entries use UTF-8 names with portable `/` separators. The archive root
contains `.drelwick-archive.json`, a strict version-1 manifest with the source
project UUID, archive creation time, the optional-history flag, and an inventory
of every included relative path, uncompressed byte size and SHA-256 checksum.
The manifest is separate from the authoritative project format. Both V1 projects
and V2 projects with their `format.json` descriptor are supported. Uncompressed
lengths and manifest SHA-256 checksums are verified before a restored project is
activated. These checks detect damage, not an attacker replacing both inventory
and payload; an independent ZIP CRC verification is not promised.

The archive includes `project.json`, `book.json`, `format.json`, `presentation.json`
and `publication.json` when present, the project `cover.jpg` when
present, and regular files under `manuscript/`, `frontmatter/`, `backmatter/`,
`assets/`, `reference/` and `styles/`. The **Include saved version history**
prompt controls whether `.history/` is included. History is included by default.
The rebuildable `.chapter-summaries.json` cache is never included. Neither are
Git data, dependency/build/test caches, logs, `.tmp` files, lock files, common
credential files (`.env`, `credentials.json`, `secrets.json`, private-key and
certificate files), or the archive manifest from a nested folder. Symbolic
links and non-regular project entries in included folders make backup fail;
Drelwick will not follow them.

The `.drelwick-migration/` workspace is not included in portable archives.
An unfinished migration blocks archiving. Its complete pre-migration recovery copy
is distinct from this filtered ZIP format; see [project migration recovery](project-format.md).

The archive reader rejects absolute, traversal, drive-qualified and
platform-invalid paths, duplicate/case-colliding entries, linked entries,
encrypted or unsupported ZIP entries, corrupt checksums and unsupported project
schemas. To bound resource use it accepts archives up to 1 GiB, up to 2 GiB of
uncompressed project data, up to 512 MiB per file, and at most 10,000 files;
the version manifest is limited to 16 MiB.

## Consistency and restore

The renderer first saves pending edits through the normal persistence path. The
main process serializes backup against project mutations. Core validates the
project without rebuilding its source cache, copies one fixed inventory to
temporary staging, hashes the copied bytes and checks file fingerprints and the
inventory again before writing the ZIP. If the project changes, a file is
unreadable, disk space runs out or archive creation fails, the partial output is
removed and the project files are left untouched. Backups must be saved outside
the project folder.

Restore asks for a ZIP and a parent folder. It extracts to a temporary sibling
folder, verifies every path, declared size and checksum, then opens the staged
project with the normal project loader. Only after validation does it rename the
project into a new child folder based on the book title. If that name is already
in use, a numbered name is chosen; an existing folder is never overwritten.
Restore destinations inside any existing Drelwick project are rejected. A
failed or cancelled restore leaves the current workspace and its project files
unchanged. A successful restore opens the new project and records it in Recent
projects.

Cancelling either native picker cancels the command. Disk-space failures and
invalid or unsafe archives receive actionable messages. Archive paths and
manuscript bodies are not logged. Backups are copies; the project files remain
the authoritative editable source, and generated EPUB/PDF files are not
authoritative project data.

The [public format specification](project-format-specification.md#portable-local-backup-envelope)
defines the envelope and exclusions, and explains
[independent recovery](project-format-specification.md#independent-recovery-with-ordinary-tools)
using ordinary ZIP, JSON and hashing tools without Drelwick. Local history is
optional content inside a backup, not itself a complete project backup.

Tests cover Unicode and asset round-trips, optional history, excluded files,
source preservation, restore collision handling, tampered and malformed ZIPs,
traversal paths, symlinks, IPC authorization, cancellation and project-operation
serialization. Test archives and restored projects use isolated temporary
directories.

## Prospective story bible extension (#160)

The [story bible contract](story-bible.md) defines independently versioned reference
records without changing existing project/descriptor versions. #161 must implement
reference validation, dirty-state recovery and backup integration. Active records,
tombstones, reference snapshots, drafts and preserved corrupt bytes remain under `reference/` and belong in
portable backups even when optional chapter history is excluded. Current archives
copy eligible reference bytes but do not yet implement these reference semantics.
Unknown reference content must be preserved; no lossy migration is authorized.
