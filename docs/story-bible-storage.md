# Story bible storage and restricted IPC (#161)

The normative persistence contract is [story-bible.md](story-bible.md), with
[version 1 examples](examples/story-bible-v1.json). This implementation adds no
project, chapter, book or format-descriptor version. All five reference types are
offline Community functionality. Files remain authoritative; no database, account,
network service or Pro package is involved.

## Responsibilities and API

`packages/project-model/src/reference.ts` owns strict record, input and draft
schemas, Unicode/size validation and duplicate JSON-key rejection. Unknown fields
and versions are never stripped. The shared package supplies typed transport
contracts; core validates content with the authoritative project-model schema
before accessing the project filesystem.

`packages/core/src/references.ts` exposes `executeReferenceOperation` with list,
read, create, update, delete, restore, links and explicit recovery operations.
The privileged caller supplies the authorized project directory separately from
the request. Record and edge UUIDs are allocated in core. Updates require both the
expected revision and SHA-256 fingerprint of original bytes. Full record content
replaces editable fields; existing edges retain their IDs, while new edges omit
IDs. List excludes tombstones unless requested, and returns diagnostics separately
from valid summaries. Links are derived in both directions with resolved, deleted,
missing, invalid and unsupported target states. Existing dangling edges survive
edits; new or retargeted edges require an active target. No scene/range links exist.

`window.drelwick.references.execute` is the only preload entry point, through
`reference:execute`. Main validates the request, sender window, exact top-level
frame, startup readiness and active project ID. Main serializes against other
desktop project operations and rechecks authorization at publication. The renderer
supplies no directory or filename. Fixed directories and validated UUID components,
regular-file checks, symlink/junction rejection, hardlink rejection and bounded
reads protect filesystem access. Existing context isolation, sandboxing and disabled
Node integration remain unchanged. Errors contain fixed messages/codes, never
record content, raw schema errors or filesystem exception payloads.

## Saves, deletion and recovery

Core queues operations by canonical project path and shares `.chapter-create.lock`
with existing project mutations and backup. A reference-owned lock contains
`reference-owner.json` with a version, UUID token, PID and host. Only a verified dead
local owner can be reclaimed; foreign, unknown or live locks fail closed. A crash
during reclamation or an ambiguous lock requires manual investigation, without
deleting project data.

Each mutation writes and verifies its durable recovery draft, snapshots previous
valid raw bytes, flushes a unique sibling temporary and revalidates the manifest,
reference inventory, linked chapter files, authorization and expected source bytes.
Replacement uses atomic rename; initial publication uses exclusive hardlink then
temporary removal. Publication acknowledgement distinguishes a confirmed commit
from failure before commit. Delete writes a revisioned tombstone retaining the
payload; restore writes another revision. There is no purge or history pruning API.

Recovery listing includes drafts, snapshots and temporary candidates with hashes.
Earlier committed drafts are recognized only by exact live/history byte evidence.
Pending or invalid candidates block ordinary mutations. Recovery read previews a
selected candidate; apply and discard require its fingerprint and explicit
confirmation. Apply also requires the reviewed current fingerprint (null only for
a missing live file). Corrupt live bytes are copied, flushed and verified under
`reference/preserved/` before replacement. Unknown newer records cannot be
overwritten. Ambiguous, oversized or unsafe data fails closed for independent
extraction. In particular, interruption between exclusive hardlink publication and
temporary unlink may leave two links to the same inode: these are retained and
rejected as unsafe until independently reviewed, rather than guessing which name
to remove. Cancellation preserves previously committed data and durable evidence.

The persistence service accepts a captured editor generation in mutation requests
and stores it in the draft. Future editors must acknowledge only their captured
generation and retain later edits as dirty. This issue supplies no editor or recovery
UI and cannot recover keystrokes that were never submitted/durably captured.

## Compatibility, backups and exports

Empty and legacy projects need no reference seeding. Existing v1-to-v2 project
migration preserves reference files verbatim; reference schema version 1 is
independent of those versions. Malformed and future reference data produce
diagnostics without rewriting it or preventing ordinary manuscript export.

Full backups include active records, tombstones, history, drafts and preserved raw
bytes even with chapter history disabled. Unresolved reference temporaries block
backup. Existing credential/cache exclusions still apply, but reference exclusions
require exact privileged approval; desktop displays native review before creating
the archive. Unsupported/malformed reference records are retained as opaque bytes
with a review warning. Restore uses the existing checked archive/new-directory
workflow and preserves IDs and raw bytes; reference services subsequently report
unsupported records as read-only. No reference repair occurs implicitly on restore.

EPUB, DOCX and print PDF continue to consume manuscript/publishing inputs only.
References, including tombstones and recovery evidence, are never export content.

## Verification and follow-ups

Model tests validate the approved examples and strict schema/JSON boundaries. Core
tests exercise all five CRUD round trips, stale/concurrent writes, fault checkpoints,
partial/corrupted temporaries, process interruption, tombstones, dangling links,
malformed and future versions, duplicate IDs, path attacks, legacy migration and
backup/restore. IPC tests check authorization and sensitive-log exclusion. The
desktop reference E2E test exercises the real isolated preload offline, restart,
backup history inclusion and private-content exclusion from EPUB, DOCX and PDF.

The #160 dependency graph remains unchanged. #162–#165 build editors on these
services; #166 supplies the linking workflow, #167 search and #168 integrated UX
recovery/backup tests. Advanced continuity, series and editorial scope remains for
review after #203, without pre-assigning Pro. Cross-platform CI remains necessary
in addition to local Windows checks.
