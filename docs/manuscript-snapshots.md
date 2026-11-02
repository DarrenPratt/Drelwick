# Named manuscript revision snapshots

Product: CORE. Use **Manuscript snapshots** in the outline to name a saved
checkpoint, inspect it, preview a restore, or open **Deleted snapshots** to
undelete one. Duplicate labels are allowed; immutable UUIDs and manifest hashes
identify selections. This is distinct from editor undo, periodic Chapter History
and a full portable project backup. It works offline without an account or Pro.

Projects must first use the confirmed editorial-format upgrade in **Comments &
annotations**. That existing upgrade verifies a complete backup. Snapshots never
silently migrate a project or accept unsupported revision-mode data. Comparison
and revision mode remain #172 and #173.

## Capture and inspection

Opening the panel flushes manuscript changes, annotation drafts/replies/edits and
the mounted reference editors. Selection evidence is captured before freezing
the editor. Failed saves keep drafts visible and cancel capture. Capture flushes
again, settles Chapter History work, then validates the expected generation and
complete source-inventory hash under the shared project writer gate.

Captured scope includes every ordered chapter envelope, project/format/book
metadata, editorial state and existing restore-conflict collections, optional
publication/ebook/print settings, and managed asset records/originals referenced
by manuscript projections, matter, cover and retained annotation slices. Required
review evidence is inline in the supported editorial format. Missing assets and
unsupported components block capture. No network URL is fetched. Story Bible
data, application settings, other snapshots and periodic history are excluded.

The existing verified-copy service stages exact bytes under a new snapshot ID.
It flushes and hashes copies, revalidates the complete source scope, then publishes
the immutable manifest last. The manifest is never replaced by label. Incomplete
directories remain unavailable, retained and labelled with their IDs. Asset
verification does not write summary caches into immutable snapshot trees.

Inspection shows identity/hash, chapter text and formatting, saved discussions,
publication context, inventory and explicitly absent/excluded components. Restore
preview shows current and captured chapter order/content, publication context,
asset inventory and the count of discussions requiring conflict preservation. It
is a before/after preview, not #172 semantic comparison.

## Restore and conflicts

Restore requires explicit confirmation of an opaque preview token scoped to the
active project and renderer frame. Generation, source hashes, snapshot ID/hash,
deletion state and authorization are checked again. A verified **before-restore**
safety snapshot is mandatory; its ID equals the restore operation ID. A failed
safety copy prevents replacement.

The existing editorial transaction commits the full semantic/editorial scope,
including optional-component removal and chapter removal/reintroduction. It
preserves current project identity/creation time and out-of-scope files. Root
generation and touched chapter revisions advance; restored anchor revisions bind
to the restored documents. An incompatible identity or divergent retained conflict
collection blocks replacement for explicit inspection instead of choosing a winner.

Assets use the existing immutable managed-asset convention. Existing divergent or
partial asset identities block restore. Missing asset files are file-backed inputs
to the same journal: the verified-copy service stages their after-images without
materializing the whole asset set in memory. File publication, draft preservation,
rollback and rollforward use the existing transaction machinery. A failed restore
retains recovery images and possibly empty parent directories, rather than publishing
unreferenced asset bytes outside its transaction.

Current-only and divergent annotations retain their complete original annotation,
anchor and thread records in `editorial/restore-conflicts/<restore-id>.json`, with
their source generation. The selected snapshot's version becomes active. A
persistent conflict-count notice survives reopen. In the panel, explicitly copy a
discussion into orphaned annotations, copy and reattach it to selected manuscript
text, or mark it discarded. Copies get new identities; every original payload
remains retained. These choices are journaled with manuscript/editorial generation.

Restore is not added to chapter undo. Editors reload only after verified commit.
The safety snapshot supplies the inverse recovery operation. Unknown outcomes
retain the original operation ID for receipt verification/retry and block further
editing until reopen/recovery. Cancelled or stale previews never restore another ID.

## Retention, portability and independent recovery

Delete writes a versioned, hash-bound `deleted.json` marker using the shared
transaction service. Undelete removes that marker; captured files and the manifest
are untouched. Receipts are durable and idempotent. There is no automatic pruning
or permanent purge. Live restore-preview selections and unfinished journal/recovery
operations prevent deletion. Periodic Chapter History retention never visits this
namespace. Portable archives preserve snapshots, markers, conflicts and journal
evidence even when periodic history is excluded.

Snapshots are ordinary UTF-8 JSON plus exact original files. After first copying
the project for independent recovery, verify every inventory size/SHA-256 and read
the chapter `content` or `review.proposed` and editorial JSON with ordinary tools.
`files/` can be extracted into a separate empty recovery location; it does not
contain excluded Story Bible/application data. Prefer a full portable backup when
restoring an entire project. Never copy a historical generation counter over a
live project or resolve an interrupted journal by timestamp alone.

The [versioned format contract](editorial-format.md) remains normative. Ceilings:
8 MiB per chapter/editorial component, 256 MiB semantic/editorial capture,
512 MiB per asset, 2 GiB per snapshot and 10,000 inventory files. Existing managed
PNG/JPEG format validation still imposes its own 20 MiB/pixel limits. Archive limits
also apply to the complete archive, including retained snapshots; failures never
silently omit snapshots or prune author data. Component overflow requires a new
format, not truncation or a paid unlock.

## Validation and limits

Core tests map S01–S05 to exact multi-chapter/asset capture, retained image evidence,
disk-copy/fsync/publication/commit-marker failures, source mutation, concurrency,
optional absence, conflict copies, retention and portable archives. Child processes
are killed after safety capture, image staging, draft staging, preparation, first
and last publication, and the commit marker; recovery repeats in the same direction.
Partial images with no published journal remain preserved and block automatic
recovery for independent inspection. IPC tests reject paths/extra fields,
untrusted frames, other projects and stale previews without private log payloads.
Native Electron tests exercise unsaved discussion flush, accessible inspection,
restore, deletion/undelete and offline reopen.

Validation is performed on Windows. Native macOS/Linux validation is not claimed.
Existing Windows directory-fsync limits remain; killed-process tests and injected
I/O failures do not prove hardware power-loss durability. Unwritten keystrokes
cannot be promised recovered.
