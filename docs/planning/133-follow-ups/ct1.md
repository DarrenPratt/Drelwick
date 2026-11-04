# Implement custom author-theme editing and pinned presentation persistence

<!-- DRELWICK-133-CT1 -->

Tracking: [#232](https://github.com/DarrenPratt/Drelwick/issues/232); design owner #133.

## Objective and scope

Implement the reviewed #133 ThemeStyleV2 author workflow over the existing semantic
renderer. Deliver new-from-preset, duplicate, edit, save-new-version, restore and
reversible archive, with independent EPUB and Standard/Large-print references.
Start with existing approved built-in font tokens and simple ornaments.

## Classification and readiness

**Undecided — owner review after #203** (`product:undecided`). Existing CORE
typography/settings/publishing remain unchanged. This is a private implementation
candidate, not a Pro assignment, licence decision or automatic v1.0 commitment.
Start in Backlog; verify #133 merged and technical scope/readiness recorded before
coding. #203 evaluates approved implementations or explicit owner deferrals before
final allocation; it is not a reverse technical dependency. #52 is not a blocker
for existing CORE work.

## Acceptance criteria

- Strict versioned ThemeRef/ThemeStyleV2 and explicit presentation-v2/print-v3
  migration preserve built-ins, both print editions, prose and all prior valid data.
- Local UUID/version/hash ownership and conflicts follow #133; copying creates a
  new identity, saved versions are immutable, imports cannot replace built-ins.
- Body/headings/paragraphs/openings/scene breaks/quotes/epigraphs support the bounded
  contract. One semantic renderer and deterministic style compiler serve both
  targets; no custom CSS, HTML or new manuscript authority.
- Override precedence preserves existing per-edition manual typography and EPUB
  reader controls. Failed/invalid drafts retain previous valid preview and form.
- Accessible keyboard form, target labels, dirty Save/Discard/Cancel and normal
  navigation/quit guards work. Theme edits alone create no manuscript save/edit.
- Save/restore/archive use exact expected state and existing atomic persistence;
  referenced snapshot/draft/recovery versions cannot disappear.
- Extend archive managed paths and #171 snapshot exact resource/notice closure
  **before enabling custom selection**; restore works without a global library.
- Captured preview/output identity includes the exact theme version/resources.
  Preserve #173 accepted/proposed/cancel policy. Stale source/theme replies fail.

## Expected components

`packages/project-model` proposed theme/ref/component schemas; renderer pure
adapters/compiler and goldens; core selection/version store, context transactions,
assembly/archive/snapshots; shared restricted DTOs; desktop author form/preview.

## Security and persistence

Use #133's reviewed contracts, existing project lock and #170/#171 protocols.
Publish immutable bundle before its selected reference; v3 advances shared
generation, legacy single-component operations make no false multi-file guarantee.
Keep context isolation/sandbox, disabled Node integration, frame/session/path
authorization, strict limits and private-content-free diagnostics. No Pro imports.

## Automated acceptance tests

T01/T02/T03/T05/T06/T11/T12: preserve current built-in CSS/semantic goldens; compare
exact chapter bytes through editing/duplicate/reopen; format/edition override
round-trips; missing/future/foreign/conflicting data; stale tokens; fault/termination
at install/reference publication; backup/snapshot closure; dirty autosave races;
offline IPC/CSP checks and Community-only build. Include all existing semantics,
Unicode and unsupported glyph diagnosis; do not promise unimplemented font assets.

## Manual acceptance tests

Keyboard-only ordinary novel → duplicate preset → edit both targets → save/reopen
→ restore version → archive/restore; validate actual EPUB reader and PDF-backed
proof while prose stays unchanged. Exercise invalid drafts and interrupted saves
on Windows/macOS/Linux, recording actual platform/resource limitations.

## Dependencies and exclusions

Dependencies: #133 (merged design), implemented #122/#128/#136, #170/#171 and #173
integration. Verify actual code/PRs, not issue state alone. CT2 (#233)/CT3 (#234) follow this work.
Exclude package import/export, untrusted fonts/decorative binaries, new semantic
nodes, bleed/spreads, publisher rules, marketplace, executable plugins, cloud, AI,
licensing changes and Pro infrastructure. Related to #133 and #203.
