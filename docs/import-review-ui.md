# Importing a DOCX manuscript

**Import manuscript** on the welcome screen or in the workspace opens the same
workflow as **File → Import manuscript…** (Ctrl+Shift+I on Windows/Linux,
Cmd+Shift+I on macOS). This is offline Community functionality. No Word installation,
account, hosted conversion or Pro package is required.

## Review before creating a project

1. Save pending edits in the current project. Import uses the existing project
   navigation guard: if a save is pending or fails, the manuscript stays open.
   Wait for **All changes saved**, then retry Import manuscript.
2. Choose a DOCX with the native file picker. Inspection parses the file in the
   existing isolated, bounded importer and creates only a private temporary stage.
3. Review imported metadata, proposed chapter titles/boundaries, manuscript blocks
   in reading order, asset count and located conversion warnings. This is semantic
   conversion, not a reproduction of Word pages. Text preview is paged in groups
   of 50 blocks. Images are identified by placeholders, not rendered in this view.
4. Keep proposed chapters, remove boundaries to join adjacent chapters, or select
   a block number and **Add chapter boundary**. Chapter titles can be changed.
   The first block always starts the first chapter. Boundaries partition the
   original top-level blocks; they cannot reorder, duplicate or omit content.
   Nested lists and quotations remain whole blocks.
5. Approve each warning individually. **Choose destination and import** remains
   disabled until every warning has an explicit approval and chapter titles are
   valid. This conservative policy also requires approval of informational
   warnings because the importer does not classify warning severity. There is no
   blanket approval, guessed recovery or unsupported skip operation. Cancel if
   the described conversion is unacceptable. Warning locations refer to the
   original DOCX/proposal, even after chapter boundaries change.
6. Choose a new, existing empty folder using the native destination picker.
   Create a folder there if needed. It must be outside existing project folders.
   Dismissing this picker returns to the approved preview without writing a project.
7. The privileged coordinator rereads and validates the private stage, applies
   the approved partition, validates assets, stages the project and publishes it
   exclusively. It rejects a destination that becomes nonempty before publication.
8. The application validates the committed destination through the normal project
   open handler, including checking the committed project identity. Only success
   replaces the active workspace. The imported project can then be edited, saved
   and reopened like any other local project.

Metadata reflects the importer output, including its explicitly warned missing
metadata placeholders. This dialog does not introduce a separate metadata editor.
See the [DOCX support matrix](docx-import.md) for supported conversions. Tracked
changes still **block inspection** with a located error: resolve revisions in a
separate DOCX copy first. The application does not choose accepted/rejected text.

## Cancellation, errors and recovery

Stage descriptions report inspection, destination/staging/writing and
validation/opening; no percentage progress is invented. Cancel import/Escape
requests privileged cancellation during inspection, review and commit. During
in-flight work the dialog waits for the operation to settle, including cleanup.
Native file/folder pickers also support their own Cancel action. Validation/opening
is not cancellable; it completes through the existing project lifecycle.

Before manifest publication, cancellation or failure removes only import-owned
artifacts. An invalid/nonempty destination is never overwritten. A consumed or
failed stage requires a fresh inspection. If cleanup fails, preserve the
interrupted folder and retry in a different empty destination.

Manifest publication is the existing commit point. If cancellation arrives after
publication, the complete project is retained and the dialog reports that it
finished; cancellation prevents automatic opening. A cleanup warning after
publication does not turn a completed project into a reported failed import.

If validation/open fails, the prior project remains active and the committed
folder remains available for recovery. Retry opening, or close the dialog and
use Open project later. Failed saves retain dirty editor content and prevent
commit/open. The modal holds the existing project operation guard and makes the
editor read-only; it does not introduce another dirty-state system.

The source DOCX is read only and remains byte-for-byte unchanged on preview,
cancellation, failure, commit and open. Import never merges into the active project.

## Implementation boundaries

`ImportReviewSchema` accepts bounded chapter-start indices/titles and warning
indices. It accepts no source paths, destinations, prose, parser code or assets.
Main checks every warning decision and validates the mapping before showing the
destination picker; core repeats review validation against the digest-checked
stage at commit. `reviewImportedManuscript` partitions immutable staged blocks.
Existing core callers may omit review options; desktop IPC always requires them.

Successful commit authorizes a single destination/identity pair owned by the
trusted frame. `imports.open(operationId)` enters the existing project-open IPC
handler with that grant. The normal loader, operation lock, history lifecycle,
workspace summary and recent-project behavior remain shared with Open project.
Neither preview nor commit itself activates a project. Failed validation retains
the grant for retry; a successful open consumes it. No source/staging/destination
paths are exposed by import inspection or commit.

Project v2, chapter v1 and asset v1 formats are unchanged. Renderer sandboxing,
context isolation, disabled Node integration, parser isolation and resource
limits remain unchanged. Warning/prose content is never sent to logging.

## Executable evidence

- `tests/e2e/desktop.spec.ts`: real synthetic DOCX selection, proposals, individual
  warning approvals, boundary removal/addition, destination cancellation, commit,
  validation/open, edit/save, restart/reopen and exact text/Unicode verification.
  It also invokes the native menu with an active project and cancels its preview.
  Source bytes are compared throughout.
- `apps/desktop/test/project-workflows.test.ts`: shared welcome/native workflow,
  unresolved decisions, dirty-save failure, privileged cancellation, cancelled
  destination, failed commit and failed validation preserving the old workspace.
- `apps/desktop/test/manuscript-import-ipc.test.ts`: path/frame/token rejection,
  missing decisions, native destination validation, real write rollback/staging
  cancellation, source-byte preservation and committed-project validation/open.
- `apps/desktop/test/project-open-ipc.test.ts`: owned one-use import grants, normal
  loader invocation, invalid identity/schema and previous active project retention.
- `packages/core/test/import-review.test.ts`: exact ordered-block partitioning,
  immutable input, merge/split and invalid boundaries/warning decisions.
- Existing core import/DOCX tests retain parser, source preservation, stage
  failure, destination race, publication rollback and cleanup failure coverage.
- Menu/preload tests cover the import accelerator on all platform menu templates
  and restricted request forwarding. Native execution is tested on Windows;
  macOS/Linux runtime verification still requires those platforms.
