# Recent projects

Issue #18 adds a Recent projects list to the welcome screen and workspace.
Successful native opens, recent opens and project creation move that folder to
the top of the list and refresh its title. Select a title to reopen it, or
**Remove** to forget the entry. Removal never deletes project files or closes
the current workspace.

Missing, moved or inaccessible folders produce the existing loader's safe error
messages without replacing the current workspace. Their entries remain available
for retry or removal. Use **Open project** to select a moved folder at its new
location. Failed opens and cancelled selections do not add entries.

## Storage and compatibility

The main-process `RecentProjects` service stores
`app.getPath("userData")/recent-projects.json`, with a version 1 envelope and an
ordered `projects` array. Its persistent schema lives in `packages/project-model`;
the desktop service validates paths for the host platform. Each entry contains an opaque UUID, canonical absolute
folder path and last opened book title. It contains no chapter bodies. Paths are
resolved with `realpath`; aliases collapse to one entry, with case-insensitive
comparison on Windows. Distinct folders remain separate even if they contain
copies of the same project UUID. The list has no automatic eviction limit.

Settings mutations are serialized within the application process and use the
existing atomic JSON writer. A missing settings file starts an empty list.
Malformed, unsupported or unreadable settings produce a safe error and are left
untouched for recovery; the service never silently replaces them. A tracking
write failure returns a warning alongside a successful project result, so authors
can still open/create their books. Failed removals retain the displayed entry.
The previous valid settings file is preserved on atomic write failure.

This is a new application settings format; no existing settings migration is
needed. Authoritative project schemas/files are unchanged, and machine-specific
paths never enter them. No account, database or Pro package is required.
Serialization is process-local; simultaneous independent application instances
do not have a shared settings transaction lock.

## Process boundary

Preload exposes only `project.listRecent()`, `project.openRecent(id)` and
`project.removeRecent(id)`. Main validates strict payload schemas and the owning
window, top-level frame and renderer URL. IDs resolve only through saved settings;
the renderer cannot submit an arbitrary path. Recent opening shares the native
open handler, loader validation, error mapping and pending-operation guard.
Authorization is rechecked after asynchronous work before returning data.
Electron sandboxing, context isolation and disabled Node integration remain in
place. Future dirty-state handling applies to recent switching in the same way
as the [existing open workflow](project-open-ui.md#switching-and-pending-changes).

## Validation

Service tests exercise normalized/case-equivalent paths, symlink aliases,
ordering, restart persistence, removal, missing folders, invalid settings and
write failures. Main tests exercise real project creation/opening, unchanged
project metadata, ID authorization, missing folders, pending operations and safe
warnings. Renderer tests cover startup loading, reopen/remove, failure/retry,
workspace preservation and disabled actions during a form or pending request.
Preload tests verify the exact channels and ID-only payloads.

For an interactive check, create/open two synthetic projects, restart the app,
reopen the older entry and verify it moves to the top. Move its folder, attempt
reopening and verify the current workspace remains. Remove the entry, restart
again and verify it stays removed while the project folder remains intact.
