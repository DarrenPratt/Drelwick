# #57 extension architecture review

**Classification: CORE.** Review of the [Community extension design](../extension-architecture.md)
against main `354ae60` and live GitHub issue state on 28 September 2026. These
are design walkthroughs, not tests of a plugin runtime. Existing implementation
evidence is distinguished from future verification throughout.

## Dependency and scope review

- Required prerequisite #55 is closed; PR #196 is merged and supplies the actual
  package inventory, independent Community verification and automated boundary
  checker. Its original PR notes about pending #52 are historical; #52 remains
  open, and its broader product review is not completed by #57.
- #109 is closed / PR #140 merged: basic DOCX interchange, EPUB/basic PDF and
  local archive backup are Community requirements. Import #114 is implemented;
  #125 export remains open and is a contract test, not a claimed working exporter.
- #53 remains open: owner-selected intended `AGPL-3.0-only`, pending legal review
  and final approval; no plugin licensing exception is inferred. #61 owns any
  future Pro repository. No repository/publication/contribution gate changes.
- #139 remains open with no provider evaluation/decision. A backup-provider API
  and example are deliberately excluded, pending that evidence.
- `packages/plugin-sdk` is deferred. Public contract semantics are documented;
  no code, package manifest, lockfile, IPC, persistence or runtime changes are
  necessary to establish this design boundary.

## Required example walkthroughs

### DOCX importer

1. **Choose and validate:** author chooses a DOCX in the native picker. Host
   `import.input` grants only bounded bytes, not a path or directory. DOCX hints
   select the parser; ZIP/OOXML contents still need validation. The optional
   importer contract negotiates import-result/semantic support before parsing.
   Built-in import keeps its direct Community registration and works offline.
2. **Parse:** map `Importer.parse` to the existing trusted
   `ManuscriptImporter.parse(source, signal)`. `DocxManuscriptImporter` bundles
   its parser; no script/macro execution, external relationship resolution or
   document-triggered network is permitted. The worker/VM is for audited code
   processing untrusted documents, never a third-party plugin sandbox.
3. **Bound resources:** retain 64 MiB input, 128 MiB serialized output and each
   stage, 1,000 chapters/warnings and 256 assets. Retain DOCX's 2,048 ZIP entries,
   20 MiB per-entry ceiling, 96 MiB aggregate expansion, 200:1 ratio, 8 MiB XML
   parts, depth 64 and 250,000 XML elements. Images retain 20 MiB / 24 million
   pixels / 12,000 pixels per side and static PNG/JPEG validation. Worker limits
   are 30-second VM execution / 35-second worker deadline, 384 MiB old space,
   32 MiB young space and 4 MiB stack, not a whole-process memory guarantee.
4. **Review:** serialized `ImporterResult` enters project-model validation,
   semantic/reference checks and strict image decoding. Only the host creates
   `ValidatedManuscript` and a private stage. Located `DOCX_RUN_FORMAT` warnings,
   for example, can map to the future fidelity report's normalized/omitted
   formatting outcomes while retaining text. Tracked changes block import;
   warnings never authorize selecting one revision silently. Fidelity metadata
   is a future transport envelope; today's strict schema remains unchanged.
5. **Commit/cancel:** cancellation terminates parsing or discards owned staging.
   Separate review approves warnings and chapter boundaries; a separate native
   picker authorizes a new empty destination. Host checks stage digest,
   revalidates content/assets and uses existing exclusive root-manifest
   publication. Before publication, failure/cancel preserves source/active
   manuscript and removes owned artifacts. Cleanup failure gives recovery
   guidance. After publication, late cancellation is committed success, possibly
   with a cleanup warning. Opening the new project is a further explicit action.

**Conclusion:** no additional permission, source-relative read or weaker parser
isolation is required. Compatibility rejects unsupported versions before
execution; malformed output and missing assets fail before an authoritative
project exists. Existing executable evidence: core `docx-import.test.ts` and
`manuscript-import.test.ts`, desktop `manuscript-import-ipc.test.ts`, and the
[DOCX](../docx-import.md)/[staging](../manuscript-import.md) support/security guides.
This review adds no claim of executable external-importer compatibility.

### DOCX exporter

1. **Scope/consistency:** author chooses editable DOCX export and grants a book
   snapshot, captured image bytes and one output destination. Desktop flushes
   dirty state or explicitly fails; core assembly captures canonical order,
   publication metadata/matter, supported semantic documents and original assets
   under the existing project-operation lock. An adapter must include the
   DOCX-relevant matter/inclusion rules from #125; it cannot guess from an ebook
   preview or silently lose content.
2. **Compatibility:** negotiate exporter target and snapshot/semantic versions;
   report feature fidelity separately. New unsupported nodes cannot be silently
   removed. The #125 support matrix must state which marks/styles/lists/links,
   matter and embedded images round-trip. Exact Word page layout is not promised.
3. **Generate:** local exporter appends to a bounded staged sink. No path,
   directory write, account, Word installation, network or Pro requirement. The
   host owns destination authorization, overwrite confirmation and atomic
   publication. Byte/chunk, snapshot/asset, compression, memory and duration
   budgets plus phase progress must be concrete before implementation ships.
   Current `assembleBook` is in-memory with per-file bounds; it does not yet prove
   an aggregate bounded/cancellable external export pipeline.
4. **Validate/cancel/fail:** host checks generated output and warnings before
   publication. A malformed artifact, exception, resource limit or pre-commit
   cancellation discards temporary output and preserves the old destination and
   source. Warning approval cannot convert an incomplete write into success.
   Once atomically published, late cancellation does not undo the export. Failed
   flush retains unsaved edits; retry is explicit and does not re-overwrite.

**Conclusion:** the proposed snapshot/sink/report contract covers #125 without
filesystem access. Runtime proof remains #125: independently inspect OOXML and
re-import supported Unicode/formatting/image fixtures, check order/text, test
failed writes/cancellation and offline operation. No DOCX export/output test is
claimed in #57 because the exporter does not exist yet.

### Validator

A chapter-heading check requests selected chapters through `snapshot.read` and
returns `findings.report`: namespaced code, severity, plain-text explanation and
revision/chapter/semantic path. It receives no project paths, history, asset bytes
or network. Host checks API/validator/semantic compatibility and validates every
finding/location. Cancellation, changed revision, scan deadline or finding limit
marks the check incomplete; stale results cannot move an editor cursor into
unrelated text. A thrown exception disables only that contribution and leaves
editing/Community validation available. The check can run entirely offline.

An optional selected publishing profile may require this check; unavailable
results mean profile validation is incomplete, not that ordinary Community
publishing is unavailable. Existing project-model validation and renderer
diagnostics show the semantic input/location approach; external registration,
timeout and adversarial-result tests remain runtime work.

### Theme

A declarative theme supplies bounded typography/scene-break/target tokens under
`theme.data`; it receives no snapshot, network, credentials or execution rights.
Host negotiates theme-model/API versions and validates passive data before
generating CSS. Injected CSS/URLs/unknown fields or excessive size/depth fail;
no extension code executes. Cancelling selection retains the previous choice.
An absent/incompatible theme falls back visibly to Classic, preserving the
requested identity where the storage model permits. All built-ins work offline.

Current evidence is the strict `BookThemeSchema`, deterministic theme generator,
`themes.test.ts`, persisted simple identity/fallback and isolated preview CSP.
External namespaced IDs are **not** accepted today. Future loader/model/version
and #58-compatible persistence work must test identity retention, backup and
fallback without rewriting prose; raw CSS or a cast to the built-in ID type is
not an acceptable shortcut.

### AI/provider

An author requests a suggestion for one selected paragraph using a chosen model.
Host previews the exact instruction/context and recipient before submission.
`ApprovedAiRequest` contains only those fragments and revisions. Provider setup
and model discovery do not grant a manuscript read. Host checks API/request/result
and model capability support independently; unsupported runtime means disabled.

For a remote provider, explicitly grant `network.request` for that endpoint and
`credential.use` for that provider/account. Host broker attaches credentials;
provider code and renderer never receive secrets. Unapproved redirects or a
result requesting more context cannot expand authority. Request/response bytes,
context/tokens, time and concurrency are bounded; timeout/revocation closes the
operation and ignores late results. Cancellation cannot recall transmitted text
or guarantee remote billing stopped. Errors are sanitized; no automatic resubmit.

A local model needs no remote grant or Drelwick backend. A future host-controlled
local compute adapter or specifically approved loopback endpoint can satisfy the
same request/result interface; no process/shell API is implied. If that model is
unavailable, report unavailable rather than silently falling back to a remote
one. A valid response is untrusted suggestion data. Only a separate author review
and current-revision check can apply an undoable change; cancellation/malformed
output never changes prose. AI, the broker and local execution remain unimplemented.

### Other category checks

| Category           | Permissions / execution                                                                                   | Cancellation, compatibility, limits and failure                                                                                                                                                                              | Offline expectation                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Publishing Profile | `profile.data` only for passive constraints/configuration; separately granted Validator for custom checks | Cancel validators with publishing; negotiate target/layout/profile versions. Bound rules/parameters. Missing/failed check means profile incomplete; explicitly choose Community defaults, never fake compliance.             | Local profiles must work offline; no upload/backend hook.                                                       |
| Editor Tool        | Declared command + selected snapshot + semantic proposal; no DOM/TipTap/file access                       | Negotiate allowed operations. Bound proposal bytes/count/time; cancel before apply, reject stale revisions, validate all operations before a single reviewed undoable transaction. Broken tool does not discard dirty state. | Local command behavior needs no network; executable third-party support awaits isolation.                       |
| Reference Tool     | Bounded query to bundled or explicitly selected local dataset; no SQL/path handles                        | Negotiate query/result/dataset formats; cancel stale lookup, bound database/result size and duration; missing/corrupt source is unavailable, not an implicit network request.                                                | Local dictionaries/databases are supported by design. Optional remote lookup needs a separate privileged grant. |

## Acceptance verification

| #57 acceptance criterion                  | Design verification                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension interfaces documented           | All eight categories define purpose, named Community contract, inputs/outputs, permissions, cancellation, resources, failures, compatibility and execution class. Shared vocabulary makes findings, revisions and host authority consistent without one generic executable runtime. |
| Security boundary considered              | Capability table separates default/user-mediated/privileged grants; trust table distinguishes built-ins, passive data, official/third-party and privileged code. No unrestricted filesystem/Node/Electron/process/DOM/credentials. No claimed hostile-plugin sandbox.               |
| Versioning strategy documented            | Independent API semantic version, explicit manifest/category/data versions, required/optional capability discovery, negotiated payload shape, unsupported-version rejection and invocation rechecks.                                                                                |
| Pro can consume interfaces                | One Community-owned future SDK; separate Pro composition consumes contracts and supplies implementations to Community host adapters. No reverse import or Pro code is needed. Current package graph/checker remains unchanged.                                                      |
| Third parties can use the same interfaces | Identical category contracts and manifest; admission/grants depend on trust and implemented enforcement, not Pro-specific functional APIs. Public means general contract, not present licence permission or a published package.                                                    |

## Deferred implementation register

These are follow-up scopes, **not work implemented or new GitHub issues created
by #57**. Open focused issues when their prerequisite design/implementation exists.
Do not grow this PR into a runtime project.

| Follow-up                                 | Coordination / gate                                             | Required proof before advertising support                                                                                                                                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First SDK and host capability             | #57 design; choose one real consumer                            | Small DTO-only Community package, reviewed exports/graph, independent consumer/type fixture, schema validation, discovery and version rejection. Preserve #55; no renderer/core internals transitively exposed.                                                           |
| Runtime admission and isolation           | Separate threat model and Windows/macOS/Linux design            | Manifest/bundle validation before execution; identity/duplicate rules; cancellation/termination; no ambient filesystem/network/process authority; malformed/oversized result, crash and grant-revocation tests. Do not bypass static-loader architecture checks casually. |
| Built-in DOCX/EPUB/PDF delivery           | #125–#131                                                       | Offline fixtures, consistent snapshots, bounded/cancellable capture and generation, independent artifact validation, atomic output/failure preservation. No plugin prerequisite.                                                                                          |
| Declarative external themes/profiles      | #122 baseline, #128/#133 configuration, #58 format coordination | Namespaced identities and negotiated data schemas, controlled rendering, migration/absence/fallback/backup tests; bounded declarative rule evaluation; no arbitrary CSS/code.                                                                                             |
| Editor/reference contributions            | First supported runtime and scoped semantic operations          | Stale-selection checks, one undoable reviewed transaction, preserved dirty state, dataset bounds; no DOM/file handles and no automatic network.                                                                                                                           |
| AI provider and credential/network broker | Separate approved feature/security design                       | Context consent, origin/account-bound credentials, redirect/private-network policy, non-content logging, bounded transport/local compute, cancel/late-result/retry tests. Local providers possible; no required Drelwick backend.                                         |
| Portable extension metadata               | #58 and a concrete persistence use case                         | Namespaced/versioned inert representation, size limits, round-trip migration/backup/absence tests and Community recovery without the extension. No arbitrary fields promised today.                                                                                       |
| Optional backup capability                | Conclusions of #139 first                                       | Scoped immutable archives, credentials, explicit new-location restore, offline/provider-loss behavior; no live synchronization/collaboration. No API selected here.                                                                                                       |
| Pro integration                           | #61 readiness and #53 legal review                              | Separate consumer tests against public Community versions; empty optional set still builds/works; no proprietary dependency in Community.                                                                                                                                 |

## Verification scope

Run the repository CI checks for this documentation-only change: frozen-lockfile
install, lint, format check, typecheck, unit tests, build and workspace smoke
(including the architecture tests and actual graph scan). Report actual results
in the PR rather than treating this checklist as an execution record.

No application source, IPC, package graph or persistent schema changes; new
runtime/type tests for conceptual interfaces would not validate enforcement and
are intentionally omitted. Desktop E2E, new coverage measurements, packaged
installers and cross-platform runtime/sandbox verification are outside this
documentation change. PR #196 recorded an existing ebook-preview navigation E2E
failure; #57 neither fixes it nor claims the complete E2E suite passes.
