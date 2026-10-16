# Canon records and research notes (#164)

Canon and research are offline Community (CORE) features. Prerequisite #161 was
closed after PR #219 merged at `8811b75e35d8ffaf33a551a539127f1cd412db6a`, an
ancestor of this implementation. Its versioned schemas, core record service,
restricted IPC, history/recovery writes and backup/export tests are reused.
The approved decisions are in [design §§24,28](design.md#28-canon-notes),
[technical specification §§65,68](technical-spec.md#68-canon-model), the
[story bible contract](story-bible.md) and
[local delivery plan](planning/local-publishing-plan.md#story-bible-design-and-owner-sequencing).
Advanced continuity, series and editorial allocation remains separate after #203.

## Author workflow

Open **Canon & research** in the workspace or **Canon and research** on the tool
rail. Each section has a labelled record selector, **New**, editable fields,
individual tags and save/delete controls. Canon categories are exactly
`character`, `technology`, `location`, `history`, `relationship`, `terminology`
and `other`. Research/general notes have title, body and optional plain-text
source citation. Organisation and technology research belongs in these notes;
there are no additional record kinds. Sources are never fetched or opened.

Changes autosave after 750 ms idle. Explicit Save, File → Save, Ctrl/Cmd+S, focus
loss and record navigation also flush edits. Each form reports unsaved, saving,
saved, validation and service error states. Failed saves retain the draft;
acknowledgements only clear the captured generation, preserving later typing.
Titles must be nonblank, fields respect the existing Unicode/length limits and
tags must be unique and nonblank. Text, whitespace and line breaks are preserved;
HTML and Markdown are displayed as inert text.

The forms load on first visit and stay mounted when the panel is hidden. Project
switching/closure, import completion, backup, restore and application shutdown
respect both save gates. Invalid or failed drafts block departure until saved or
explicitly discarded. Requests from the two forms are serialized against each
other to respect the privileged project's operation guard. A busy external
operation can still return a visible retryable error; it never discards a draft.

Delete saves pending edits and asks for confirmation, then uses the existing
recoverable tombstone operation. **Deleted records** remain readable and can be
explicitly restored. Native labelled controls, fieldsets, status/alert regions,
New-to-title focus and tool-rail focus restoration support keyboard navigation.

## Storage and compatibility

Canon files remain `reference/canon/<id>.json`; notes remain
`reference/notes/<id>.json`. Both use the independently versioned v1 reference
schema. Project/manuscript formats and migration versions are unchanged. The UI
uses the authoritative project-model validation and existing core operations via
restricted IPC; it has no path or filesystem authority. Existing links survive
editing without adding the #166 linking workflow.

The [storage contract](story-bible-storage.md) supplies revision/fingerprint
checks, serialized writes, verified history, durable drafts and atomic publication.
Failed writes preserve the previous valid bytes. Backups retain reference records,
tombstones and recovery evidence; existing v1 project migration preserves reference
bytes. Unsupported or malformed stores and unresolved recovery candidates are
shown as read-only, with content-free errors. No automatic migration, overwrite,
purge or recovery decision is introduced.

EPUB, DOCX and print PDF still consume manuscript/publishing inputs only. There
is no continuity checking, global search, AI, cloud dependency or Pro dependency.
Electron isolation, sandboxing and disabled Node integration are unchanged.

## Acceptance evidence

| Criterion                                                                   | Evidence                                                                                                                             | Result |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Canon fields and exactly seven categories                                   | UI tests create/edit every category; core tests persist each through CRUD/reopen; strict model rejection tests                       | PASS   |
| Separate versioned research/general notes; organisation/technology as notes | Note form tests, plain-text Unicode/source round-trips and independent v1 files                                                      | PASS   |
| CRUD, validation, dirty/save/error feedback and reopen                      | Form tests, lifecycle guards, core fault injection at each write checkpoint, native Electron restart and tombstone/restore scenarios | PASS   |
| Manuscript/export separation; no continuity claims                          | Unchanged manuscript byte assertions; existing core assembly/EPUB/DOCX and native EPUB/DOCX/PDF privacy tests                        | PASS   |
| Offline accessible navigation and safe rendering                            | Offline native keyboard scenarios, labelled controls, New focus, escaped hostile text and no network requests                        | PASS   |

Tests: `apps/desktop/test/canon-research-manager.test.ts`,
`apps/desktop/test/project-workflows.test.ts`,
`packages/project-model/test/reference.test.ts`,
`packages/core/test/references.test.ts`,
`tests/e2e/canon-research.spec.ts` and `tests/e2e/references.spec.ts`.

## Local verification

Windows, Node 24.18.0 and pinned pnpm 10.34.5:

| Command                          | Result                                          |
| -------------------------------- | ----------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS                                            |
| `pnpm lint`                      | PASS                                            |
| `pnpm format:check`              | PASS                                            |
| `pnpm typecheck`                 | PASS                                            |
| `pnpm test`                      | PASS: 99 files, 1,136 tests                     |
| `pnpm build`                     | PASS                                            |
| `pnpm check:workspace`           | PASS, including Community dependency boundaries |
| `pnpm test:e2e`                  | PASS: all 24 desktop scenarios                  |
| `git diff --check`               | PASS                                            |

The existing non-fatal Vite chunk-size warning remains.

## Limitations

Native runtime validation is on Windows; Linux/macOS execution remains platform
validation. Full integrated crash-draft review UI remains #168. Pending recovery
candidates block ordinary writes for explicit recovery review; keystrokes not yet
submitted durably cannot be guaranteed after abrupt process termination. Concurrent
external writers remain subject to the existing fingerprint/recovery contract.
