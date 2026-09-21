# Manuscript recovery

Issue #40 (CORE) adds startup decisions to the read-only crash scan from #39.
After an unclean session, BookEditor scans recent projects and shows a modal
before mounting the editor. Each candidate shows its chapter, project folder,
source and timestamp. Candidates are ordered newest first within each project.
Visual comparison remains future work.

Before this chapter scan, main resolves any existing
[project migration journal](project-format.md). Migration recovery failure blocks
startup, and chapter recovery cannot operate on an unfinished migration. Projects
without a pending migration are not upgraded merely by the startup scan.

- **Recover** revalidates the selected version, preserves the original chapter
  content in history, atomically replaces its content and removes the selected
  recovery file. Other candidates still require an explicit decision; an older
  version cannot overwrite the newly recovered chapter.
- **Discard** removes only the selected recovery file. It does not write the
  original chapter or create history.
- **Cancel startup**, Escape or quitting with unresolved candidates leaves the
  session unclean and files unchanged by cancellation. The next launch scans
  again. Decisions already completed are retained.

The editor becomes available after all candidates have been resolved. A failed
scan blocks startup and offers cancellation so incomplete scans cannot silently
skip recovery. Fix access to recent project folders before retrying.

## Privileged boundary

The preload exposes only list, recover, discard and cancel methods. Central IPC
schemas accept no paths or manuscript data from the renderer, only an opaque UUID
issued by the scan for a decision. Main checks the sender, main frame and URL,
returns metadata without manuscript bodies or recovery-file paths, serializes
operations and blocks project access while recovery is pending. Cancel startup
cannot bypass normal save-on-exit after the recovery queue is empty.

The core service owns file operations. It checks candidate schema, chapter
identity, timestamp and content again at decision time. Recovery also requires a
valid original chapter still in the manifest and older than the candidate.
Changed or invalid files are preserved with an actionable error. Existing path
components must be regular files/directories, without symlinks or junctions.
Recovery uses the existing chapter operation lock; it never automatically steals
a stale lock. After a crash during a chapter mutation, inspect and preserve project
files and the stale `.chapter-create.lock` before retrying recovery.

## History and failure ordering

Every Recover operation creates a version-1 history snapshot with reason
`before-recovery` before replacing the chapter. This reason bypasses interval
throttling and identical-content suppression. These backup snapshots are excluded
from startup candidates: their creation time must not make the pre-recovery
content appear newer than the recovered work. Normal history retention still
applies.

The chapter envelope and unknown metadata are preserved; only content and modified
time change. Modified time advances to at least the candidate timestamp. The
atomic writer uses a separate, unique recovery temporary path, flushes and closes
it before rename, and never deletes an existing temporary file it did not create.
Snapshot or replacement failure leaves the authoritative chapter and candidate
intact. Retry may create another backup; it never sacrifices the earlier one.

Rename is the commit point. Candidate cleanup failure after commit returns a
success warning and retains the candidate in the current dialog for Discard to
retry cleanup. Lock-release failure also reports a warning. If startup is cancelled
after a cleanup failure, a now-older leftover `.json.tmp` may no longer qualify
for the newer-version scan; ordinary saving still refuses to overwrite it.
Preserve and inspect that file before retrying saves.

Chapter/project schema versions are unchanged. The additional history reason is
an additive version-1 vocabulary change; older builds may ignore these snapshots
as unsupported history, but the JSON remains independently readable. No migration
or rewrite of existing manuscript/history data occurs.

The project lock coordinates cooperating operations, not external editors or
hostile concurrent filesystem replacement. Existing platform rename/durability
limits remain. Invalid/missing originals require manual recovery; this workflow
never silently replaces them.

## Validation

Core tests use temporary projects and exercise temporary/history recovery,
mandatory pre-recovery history, discard, stale/changed candidates, linked
ancestors, locks, concurrent decisions, write failures and post-commit cleanup.
Desktop tests cover typed preload routing, IPC authorization and validation,
startup lifecycle/unclean cancellation, and modal recover/discard/cancel/retry
flows under React StrictMode. Native Electron presentation and macOS/Linux
execution require separate platform smoke testing.
