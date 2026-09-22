# Existing project loading

Issue #15 uses the existing function-based core service convention: `openProject`
returns the resolved project path, validated project configuration and book
metadata, and chapter summaries in manifest order. Desktop dialogs and IPC wiring
belong to their own issues.

## Summary strategy (recorded before implementation)

Chapter JSON files remain authoritative. `.chapter-summaries.json` is an optional,
versioned, rebuildable JSON cache, tied to the project UUID. Each entry contains a
body-free summary, word count, and source file size, modification time and change
time. Opening always validates the manifest and metadata and checks that every
ordered UUID has a regular `manuscript/<uuid>.json` file. Duplicate IDs, invalid
UUIDs, missing references and filename/embedded-ID mismatches are errors. Extra
unreferenced files are left untouched for recovery; opening never invents order.
UUID duplicate checks are case-insensitive. Existing `ChapterSummary` remains
compatible; `CountedChapterSummary` adds the required derived `wordCount` for
opening and cache entries without changing authoritative chapter schemas.

A valid cache allows opening without reading chapter bodies. A missing, invalid,
unsupported or stale cache is rebuilt sequentially, reading and validating only
one affected chapter at a time outside the editor. This is the bounded-read
fallback allowed by the repository audit: cold opens require body reads because
the existing chapter format stores metadata and content in the same JSON file.
Returned sessions and cache entries never contain bodies. Word counts use text
nodes, join adjacent inline text across marks, separate blocks and hard breaks,
and count whitespace-delimited words. They are not a linguistic tokenizer.

Cache writes use the existing atomic JSON writer and are best effort; read-only
projects can still open. Delete the cache, or use `rebuildSummaries: true`, to
force revalidation and rebuilding. File fingerprints detect ordinary external
edits, including same-size edits, but are not cryptographic integrity checks.
Concurrent external mutation during a rebuild is detected by rechecking the
fingerprint and reported for retry. Opening is not a multi-file snapshot or lock.
Future chapter saves must invalidate/update summaries after authoritative saves.

## Compatibility and errors

The reader supports historical V1 and current V2 projects, including the V2
`format.json` component descriptor. It rejects an unfinished migration journal.
Desktop opening uses `openProjectForEditing` to perform the verified-backup and
recoverable V1 -> V2 migration before activation. `validateProjectFiles` performs
full read-only validation for backups/staging without cache writes or editor
activation. See [project formats and migrations](project-format.md).

The cache retains its independent version-1 envelope and can always be discarded.
Projects without it use the rebuild path. No database, account, Pro dependency or
editor instance is needed.

Missing files, invalid JSON/schema, unsupported numeric schema versions, invalid
ordering and filesystem failures have distinct application error codes. Errors
identify the affected relative file without including JSON, manuscript text or
raw parser errors. Relative roots and symlinks within project input paths are
rejected; the user-selected root itself may resolve through a symlink.
