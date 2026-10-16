# Local story bible locations (#163)

Locations are offline Community records using the existing restricted reference
API and [story bible format](story-bible.md). No schema, persistence service,
network access, manuscript content or publication output format changes are made.
The dependency #161 was delivered by merged PR #219. The location panel follows
#162's character panel labels and styling, with additional lifecycle protection.

## Author workflow

Open **Locations** in the workspace. Records load on first use; the editor then
stays mounted for that project. Select a record or choose **New**. Edit name,
optional type, description, notes and individual tags. Tags are separate fields so
commas, Unicode and line breaks remain content. Whitespace and existing reference
links survive edits; this panel does not create or edit relationships or images.

Changes autosave after 750 ms idle using the shared autosave coordinator. **Save
location**, File → Save, focus loss and record navigation flush changes. The form
shows unsaved, saving, saved, validation and service errors. Acknowledgement only
clears the captured form: newer edits remain dirty and are saved subsequently.
Invalid drafts remain in memory. **Discard changes** requires confirmation and
reloads the saved record (or clears an unsaved new record).

Closing/switching a project first attempts to save locations and asks the author
to retry after saving, consistent with manuscript navigation. Backup, restore,
import completion and application shutdown await the location save gate. Failed
or invalid saves prevent those operations. Switching or closing tool panels keeps
the location editor mounted, so drafts remain available even while hidden.

**Delete** first saves pending edits, then asks for confirmation. The existing
service writes a recoverable tombstone. Deleted locations remain selectable in
**Deleted locations**, with read-only fields and an explicit **Restore location**
action. Stale revisions/fingerprints are rejected without replacing external edits.

## Safety and scope

The authoritative schema validates all inputs; the privileged reference service
continues to validate and authorize writes. List diagnostics are visible and
read-only stores disable editing. Before editing, recovery candidates are scanned;
unresolved/invalid candidates or incomplete recovery scans disable mutations and
report that review is needed. Full crash-draft preview/recovery UI is the separate
integrated workflow under #168. No automatic recovery, purge, overwrite or
candidate deletion is introduced here. Keystrokes not yet durably submitted cannot
be guaranteed after abrupt process loss.

## Acceptance evidence

| Requirement                               | Verification                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create, list, open, edit, delete, restore | Location unit tests plus native Electron location form scenario, including empty state and recoverable deletion                                                                      |
| Approved fields and Unicode               | Authoritative schema; unit tests for all fields, combining Unicode, whitespace, comma/newline tags and preservation of existing links                                                |
| Reopen and save states                    | Desktop restart/form assertions; 750 ms autosave and captured-save race unit tests                                                                                                   |
| Navigation and closure protection         | Project lifecycle tests cover open/new/close, backup, restore and shutdown; native test blocks project/application closure with an invalid draft and retains it across panel closure |
| Stale and failed writes                   | UI stale/rejected-save/retry/rejected-delete tests; existing core reference tests inject write failures, interruptions and stale revisions while verifying preserved bytes           |
| Keyboard and accessible controls          | Native Tab focus test; labelled native controls, fieldsets, status/alert regions, New focus assertion, read-only/error/empty states                                                  |
| Offline and export privacy                | Native location scenario runs offline; existing references E2E inspects EPUB/DOCX and PDF text/metadata for private reference canaries                                               |
| Manuscript, IPC and Community             | Native byte-for-byte chapter comparison; existing reference IPC authorization/security tests; Community workspace/architecture checks                                                |

## Review validation

The final local run passed:

| Command                          | Result                                                 |
| -------------------------------- | ------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | Passed with pinned dependencies                        |
| `pnpm lint`                      | Passed                                                 |
| `pnpm format:check`              | Passed                                                 |
| `pnpm typecheck`                 | Passed                                                 |
| `pnpm test`                      | 98 files, 1,083 tests passed                           |
| `pnpm build`                     | Passed                                                 |
| `pnpm check:workspace`           | Passed, including Community dependency boundary checks |
| `pnpm test:e2e`                  | All 22 desktop scenarios passed                        |
| `git diff --check`               | Passed                                                 |

The full E2E rerun includes regression verification for closing during initial
location loading and deferring location reads until the panel is first opened.
It also verifies offline reference privacy in EPUB, DOCX and print PDF.
The build retains the existing non-fatal Vite chunk-size warning.

All eight reviewed #163 criteria are satisfied by these local changes. They are
ready for PR review and support `Closes #163` once included in PR #221. The review
does not authorize committing, pushing, merging or changing issue state.
Local desktop validation runs on Windows; macOS/Linux execution remains
CI/platform validation. Full crash-draft recovery UI remains scoped to #168.
