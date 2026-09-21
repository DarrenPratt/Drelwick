# Chapter creation

Issue #19 adds the core `createChapter({ projectPath, title })` service. It creates
a version 1 chapter with a UUID v4, `type: chapter`, `status: draft`, timestamps
and an empty paragraph document. The result contains the chapter and an updated
session with body-free summaries. The caller replaces its session only on success.
Renderer controls and chapter IPC integration belong to later issues.

## Persistence decision

Two files cannot be committed with one atomic rename. Creation therefore:

1. Resolves the absolute project root and exclusively creates
   `.chapter-create.lock/`. A competing creation receives `PROJECT_BUSY` and can
   retry after the first operation completes. Root aliases share the same lock.
2. Loads/validates the project and current summaries, then reads the current
   manifest. Existing unknown manifest fields are preserved when appending order.
3. Writes and flushes the new chapter to a temporary file, publishes it using an
   exclusive hard link, then removes the temporary name. Existing UUID files are
   never overwritten. Filesystems without hard-link support fail safely.
4. Checks that the manifest has not changed, then replaces it with the existing
   atomic JSON writer. This replacement is the commit point.
5. Returns updated summaries and removes the creation lock. The optional summary
   cache is rebuilt by the existing loader when it sees the newly ordered UUID.

Before manifest commit, failure leaves its old order intact. A chapter already
published at that point remains unreferenced for recovery; it is never silently
deleted or appended on restart. After commit, the manifest references a complete
chapter. A lock-release failure returns a warning with the successful result,
so callers do not retry an already committed creation.

The lock coordinates creation across processes, including root symlink aliases.
Chapter deletion acquires the same lock exclusively. An existing lock makes
deletion return `PROJECT_BUSY` before reading or changing project files; it does
not remove that lock. Only creation of the history/trash directory is recursive.
It is not a general project session lock. Other programs that ignore it can still
modify files; a manifest comparison detects edits before commit but is not an
atomic filesystem compare-and-swap. Do not edit a project concurrently in external
tools. Future manifest-mutating operations must coordinate with this lock before
they are exposed. Directory-entry durability after sudden power loss depends on
the filesystem; file flushes and atomic publication do not imply a multi-file
power-loss transaction.

## Recovery and compatibility

A process crash can leave `.chapter-create.lock/`, a temporary chapter file, or
an unreferenced complete chapter. The lock is never automatically stolen. After
closing all processes using the project, back up the project and inspect its
manifest and manuscript files. Remove only the empty creation lock directory to
allow another creation. Preserve unreferenced chapter files for recovery; inspect
and validate them before manually restoring their UUIDs to the manifest order.
The loader never guesses their intended order. Retain temporary files for
inspection if they might contain recoverable content.

Existing version 1 schemas remain unchanged; no migration is required. Book
metadata and existing chapter files are untouched. Application errors contain
fixed messages without manuscript text or raw filesystem/parser error payloads.
The service uses Community packages only and needs no Electron or account.

## Validation

Tests cover creation defaults, UUIDs, ordered summaries, reopen persistence,
unchanged book/existing chapter files, unknown manifest fields, optional cache
failure, UUID collisions and pre-existing temporary files. Failure injection
checks chapter writes, manifest writes and atomic rename failure. Child processes
exit immediately before/after manifest commit to verify crash ordering and stale
lock handling. Additional tests cover competing creation through a root alias,
external manifest edits, invalid input, linked manuscript directories and lock
cleanup warnings.
