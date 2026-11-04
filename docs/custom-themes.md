# Custom theme design contract v1 (#133)

Status: proposed implementation contract, completed by the #133 design PR subject
to review/merge. **No custom-theme runtime is implemented here.** Existing built-in
themes and Community publishing remain available. The package wire format is
[ThemePackageV1](theme-package-format.md); the [delivery assessment](planning/133-publishing-boundaries.md)
records verified foundations, product boundaries, follow-ups and acceptance cases.

The 2 October 2026 owner decision governs: evaluate the working private application
through #203 before final licensing and Community/Pro allocation. Existing CORE
commitments are preserved. New commercial allocation is **Undecided — owner review
after #203**. This design creates no Pro infrastructure or runtime dependency.

## 1. One semantic renderer, data-only presentation

`renderBook` continues to own semantic traversal, reading order, headings, marks,
lists, quotes, epigraph attribution, images/alt text, links and scene breaks.
Themes cannot receive prose callbacks, change nodes, suppress authored elements,
rewrite text, supply HTML, or invoke code. Existing semantic hooks from
[book rendering](book-rendering.md) are the only styling surface. A decorative
asset is presentation, never a replacement for narrative images or alt text.

Extend `BookThemeSchema` conceptually with a strict **ThemeStyleV2** adapter and a
resolved resource table. Do not loosen `BuiltinThemeIdSchema` into arbitrary strings
or teach each output a separate semantic renderer. Proposed service boundaries:

```text
privileged capture: book + explicit revision projection + presentation/edition
                    + pinned theme definition + validated resource bytes/hashes
  -> resolveTheme(reference, captured catalogue, target, capability version)
  -> compileTheme(resolved typed style, target, resource-ID resolver)
       -> deterministic CSS + required resource descriptors + fixed diagnostics
  + existing renderBook semantic fragments
  -> existing isolated EPUB simulation / EPUB packager / production PDF pipeline
```

`resolveTheme` is not a filesystem or network API. Capture belongs in core/main;
the renderer-safe compiler receives immutable data and opaque IDs. Generated CSS
is output, never accepted input. No custom selectors, URLs, expressions, imports,
scripts, extension hooks, arbitrary markup or user-authored CSS are allowed.
DOCX remains semantic manuscript interchange: custom book-page styling is not
silently represented as exact Word layout. Its current fidelity notices remain.

## 2. Typed editing vocabulary

All sizes are finite bounded numbers. The [schema fixture](examples/theme-package-v1/manifest.schema.json)
defines exact keys/ranges; every object rejects unknown keys. The following groups
are complete in `style.base`; overrides are sparse and use the same constraints.

| Group                   | Editable data and behaviour                                                                                                                                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body                    | Approved `fontSet` ID; EPUB `sizeRem` 0.875–1.5; line height 1.2–2.5; left/justified alignment; paragraph indent 0–3 em and spacing 0–2 em. Print body size is separately 9–32 pt. Existing large-print ranges remain available. No absolute positioning, hidden text, prose transforms or generated body text.                         |
| Headings                | Font-set ID; weight 400/600/700; six bounded relative scales, one for each existing heading level; before/after spacing. Never demote or replace semantic heading levels. A missing physical semibold face maps explicitly to the registered bold face, without synthetic font creation.                                                |
| Chapter opening         | Font-set ID; title size/alignment and opening whitespace; normal/flush-first paragraph treatment; a typed ornament above/below the existing title. The real title occurs once in reading order. A theme cannot invent chapter numbering, replace titles with images, move content between chapters or alter recto/chapter-start policy. |
| Scene breaks            | Space, rule, diamond or validated raster ornament, bounded width/spacing. Preserve the existing semantic separator. Raster decoration has an explicit rule/diamond fallback; no glyph from an unregistered ornamental font.                                                                                                             |
| Block quote             | Font-set ID, inset, spacing and normal/italic treatment. Keep semantic quotations, paragraph order and marks.                                                                                                                                                                                                                           |
| Epigraph                | Font-set ID, width, alignment, spacing, normal/italic and attribution sizing. Style existing attribution; do not duplicate or synthesize its text.                                                                                                                                                                                      |
| Other current semantics | Lists retain numbering/nesting; emphasis/strong/link marks retain meaning. Code/preformatted text, hard breaks, image sizes/alt text and publication navigation retain their existing policies. Unsupported custom typography for a semantic node uses its documented baseline and a located limitation, never text loss.               |

Drop caps, arbitrary page templates, CSS counters, user-defined nodes, footnote/verse
semantics (#137), reusable matter (#134) and parts/volumes (#135) are outside v1.
An ornamental chapter opening is in normal document flow, inside the content box;
it is not a full-bleed or fixed-layout page. Advanced narrative placement is assessed
separately. Text colours remain adapter/reader controlled; decorative ink may use
only a six-digit sRGB hex value. No theme can defeat the reader's accessible text
size/colour preferences or essential manuscript visibility.

### Resolution and override precedence

1. Resolve the exact pinned built-in definition or immutable custom package.
2. Apply complete base style, then the selected `epub` or `print.overrides` groups.
   Each overridden group is a complete group replacement, not an ambiguous recursive
   merge. An omitted group inherits base. Missing required references are errors.
3. For print, apply the selected Standard/Large-print profile's existing explicit
   `PrintTypography` overrides last. Show the effective values and their origin.
   Do not reset the other edition when applying a theme. `printPageGeometry`, trim,
   gutter, starts, headers/folios remain print settings, not theme fields.
4. Temporary ebook simulation font size/appearance remains last for simulation only;
   it is neither saved in the theme nor used as publication/export configuration.

EPUB uses relative sizes and reflow. It cannot promise facing spreads, exact line
breaks, installed font metrics or pagination. Print resolves exact licensed font
bytes before measuring and uses the existing production PDF, not a preview-only
layout. Existing Noto substitutions remain unchanged for built-in v1 presets.
EPUB's current generic-only export and print's single-family restriction are
implementation gaps, not evidence that custom fonts already work.

## 3. Ownership, identity and immutability

Built-in presets keep `classic`, `modern`, `literary` and their tested v1 definitions.
Their catalogue is application-owned, immutable and never overwritten by import.
Future catalogue revisions must retain the older pinned definition versions and
their goldens; upgrading a saved built-in pin is an explicit action, not an app-
update side effect.
Copying a preset creates author-owned data; it does not edit the shipped definition.
The compiler's built-in-v1 adapter must preserve all current preset goldens.

Custom identity is a UUID, independent of display name, filename, package origin or
author label. A new theme or **Duplicate** allocates a new UUID and starts at version
`1.0.0`. There is no runtime inheritance chain: copies contain complete values.
Names may collide and are escaped plain text. Import provenance is assigned by the
privileged importer, not trusted from a package's creator/ownership claims.

Each saved custom version is immutable and content-addressed. Editing creates a
new explicit semantic version under the same UUID only for the local editable
theme; imported data defaults to **Duplicate and edit** with a new UUID. Keep old
versions. Same UUID/version and same digest is an idempotent import. Same
UUID/version with different digest is a conflict: keep the installed version,
offer an explicitly named duplicate or cancel; never last-writer-wins.

The proposed reference union is:

```text
{ kind: "builtin", id: "classic"|"modern"|"literary", definitionVersion: 1 }
{ kind: "custom", id: UUID, version: "major.minor.patch", sha256: SHA256 }
```

No floating `latest`, filename-based identity, automatic package update, implicit
remote catalogue or paid entitlement is part of resolution. The digest covers the
canonical manifest including every asset/notice hash. It is an integrity check,
not a signature, proof of authorship or security approval.

## 4. Persistence and compatibility

Proposed `presentation.json` **v2** pins the EPUB `ThemeRef`; proposed `print.json`
**v3** retains the two existing edition profiles, replacing each profile's built-in
`themeId` with a `ThemeRef`. Their other semantics and units are unchanged. Do not
add custom IDs to the current slug field or change chapter/manuscript versions.
Custom resources live in project-owned immutable bundles at
`themes/<uuid>/<version>/<sha256>/` with the manifest, declared assets and notices.
There is no dependency on a machine-wide library; a library may only cache/copy
these portable bytes. Project-local data remains authoritative.

The exact proposed component shapes are:

```text
presentation-v2 = { schemaVersion: 2, projectId: UUID, theme: ThemeRef }
print-v3 = { schemaVersion: 3, projectId: UUID, edition: "standard"|"large-print",
  editions: {
    standard: { settings: PrintSettings, theme: ThemeRef, typography: PrintTypography },
    "large-print": { settings: PrintSettings, theme: ThemeRef, typography: PrintTypography }
  } }
```

`PrintSettings` and `PrintTypography` retain the current strict shared definitions.
No other component field is implicitly added. Native install provenance is separate
host-authored metadata and is never trusted from or exported inside the manifest;
missing provenance means unverified/imported, not first-party ownership.

| Saved state                                                             | Required future reader behaviour                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No presentation/print component                                         | Current Classic/default geometry behaviour, no write on read.                                                                                                                                                                                                          |
| Presentation v1 / print v1 or v2                                        | Read existing definitions unchanged. On an explicit custom-theme save, preview the migration, preserve a verified recovery copy and map built-in selections to exact built-in refs. Preserve legacy print separation and both edition settings. No background rewrite. |
| Valid v2/v3 custom references                                           | Resolve only exact installed UUID/version/hash. Never substitute another version because its name or UUID matches.                                                                                                                                                     |
| Safe unavailable old built-in slug                                      | Retain current Classic notice/fallback semantics and saved slug until an explicit choice. Do not turn malformed custom references into this case.                                                                                                                      |
| Missing custom bundle or unsupported capability                         | Keep the saved reference; authoring remains available. A labelled diagnostic preview may use Classic. Publication/production preview requires an explicit captured **use fallback for this operation** or Cancel choice. No silent pin rewrite.                        |
| Corrupt manifest/resource, hash mismatch, newer component/package/model | Preserve bytes, block affected theme/publishing operations and give fixed diagnostics. Do not interpret partially, strip unknown fields or automatically downgrade. Normal prose editing remains available where the project format permits it.                        |

Older readers already reject future presentation/print component versions. They
must not claim to render custom themes; no backward-compatible silent flattening
is promised. Migration adapters are explicit, version-to-version and tested on
copies. Unsupported immutable snapshots are not migrated in place.

### Publication and write protocol

Use existing active-project authorization and the shared operation lock. Validate
schema, expected component hashes, project ID/generation, exact theme/resources,
capacity and all input inventory before changing a selection. Keep immutable
bundle installation separate from reference publication:

1. Quarantine/validate the complete candidate outside authoritative selected data.
   Capture a native-authorized source file; recheck source identity/hash.
2. Under the project writer gate, publish the verified immutable directory without
   overwrite, then reread its inventory. A crash here can leave an unselected
   complete bundle, never a reference to half-installed data.
3. Publish the one selected component last. For project v3, reuse #170's context
   transaction (`saveEditorialContext`/prepared transaction), advancing the shared
   generation and retaining images. For legacy projects, reuse the existing locked
   exclusive-temp/fsync/atomic single-component writer, with a verified pre-migration
   recovery copy. Do not introduce a second transaction journal or nest writer locks.
4. Applying to EPUB and a print edition are separate explicit scopes. A legacy
   operation must not promise a multi-file atomic update it cannot provide.
   A v3 combined action, if exposed later, must use the existing transaction.
5. Acknowledge only the captured draft/version. On failure keep the previous
   reference/bundle and newer in-memory edits. Unknown results retry the same
   operation identity where supported; never replay as a new update automatically.

Directory publication and file replacement need the same local filesystem
guarantees as existing managed images/exports. Reject linked paths and unsupported
atomic operations; no delete-first/copy fallback. Incomplete owned staging is
recovery evidence, not an installed theme. Retain/quarantine it for explicit
inspection/discard. Power loss and hostile external writers remain explicit limits.

### Backup, restore and removal

Implementation must extend **both** the current project-archive managed-directory
allowlist and #171's strict snapshot path/inventory/asset-closure validators before
custom selection is enabled. Merely creating `themes/` does not make it portable.
Include every selected/pinned bundle and its notices in consistent captures;
portable full project backup also retains author-saved versions and removal records.
Validate exact closure on restore, including print editions. Never query a global
library or fetch a missing resource to make a backup appear complete.

**Restore theme version** previews a retained immutable version and explicitly
repins one target with expected-state checks; it never rolls back manuscript prose.
Full project archive restore continues to create a separate validated project.
Named snapshot restore preserves current-only theme versions as retained data and
restores its captured pins through the existing safety transaction.

V1 **Remove/archive theme** is reversible: hide an unselected theme from the picker
with a versioned removal record under the same lock. Refuse removal of versions
referenced by live selections, snapshots, durable drafts or unresolved recovery
evidence; show where they are used and offer explicit repinning, never implicit
fallback. Restore clears only that removal state. No automatic garbage collection,
hard deletion of historical resources or disk-wide font uninstall is authorized.
If the bounded reference scan cannot prove safety, refuse removal.

## 5. Author workflow, preview and validation

Provide **New from preset**, **Duplicate**, **Edit**, **Save new version**,
**Import package**, **Export package**, **Restore version** and reversible
**Archive/restore**. State whether data is built-in, locally created or imported;
display metadata as unverified. Editing built-ins/imports starts a local copy.
An import/export never silently applies a theme to a manuscript.

The editor is a labelled keyboard-operable form with grouped numeric controls,
field errors, target/edition labels, unsaved-state indication, focus restoration
and Save/Discard/Cancel navigation/shutdown handling. Invalid drafts remain visible;
the last valid preview remains labelled as such. Theme typing does not manufacture
manuscript edits. Flush actual prose, editorial/revision and other dirty state
through existing coordinators before capturing a book for preview/publication.

Preview one captured book with base/EPUB/selected print controls. A theme-only change
can restyle cached semantic fragments; print must repaginate through the existing
production pipeline when metrics/resources change. Keep an immutable source/theme
revision identity, cancellation and deadlines; late replies cannot replace a newer
preview. Validation has distinct schema/resource, target-capability, rendered-output
and human-proof stages. Never label schema-valid data as publisher-compliant.

Saved theme changes invalidate existing prepared output even if prose is identical.
Capture theme hash, style/compiler version, actual font/image hashes, target/edition,
geometry and current pipeline/Chromium identity. Preview/export must use the same
captured resources. Pending revisions still require #173's separate explicit
accepted/proposed/cancel decision; theme selection never accepts revisions.

| Condition                                                | Preview/export policy                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown property, active-content field or invalid number | Reject candidate/draft application; preserve form and previous valid output. No permissive CSS fallback.                                                                                                                                                    |
| Missing/invalid declared file at import                  | Reject entire package; no partially installed theme.                                                                                                                                                                                                        |
| Installed resource missing/corrupt later                 | Fixed resource diagnostic; keep original files/ref, block production render. An explicit operation-only built-in fallback is allowed after a new capture.                                                                                                   |
| Font unavailable, glyph missing or prohibited embedding  | Name the role/target limitation without manuscript payloads. Restore a verified resource, choose an approved alternative, or explicitly use the captured built-in fallback. Print never silently invokes a system font; EPUB can also be reader-overridden. |
| Reader ignores decorative CSS                            | Preserve semantic separator/title and declared simple fallback. Explain that reflowable reader presentation is not a PDF proof.                                                                                                                             |
| Stale source/reference or cancelled/failed render        | Discard that render result, retain the prior preview/draft and require recapture. No partial final output.                                                                                                                                                  |

## 6. Security and API responsibilities

Project-model owns versioned theme/ref/manifest shapes and cross-reference rules.
Core owns package preflight, normalization, resolution, hashes, immutable capture,
rights-policy decisions, storage/backup and stale/recovery checks. Renderer owns
pure schema-validated style compilation and semantic hooks. Desktop main owns
native file selection, capability tokens, bounded resource decoding/render jobs,
project/session authorization and fixed diagnostic transport; preload exposes only
strict DTOs. These are proposed contracts, not additions to the current IPC API.

Proposed commands use `{projectId, operationId, expectedComponentHash, ...}` and
bounded validated data, or short-lived opaque native-selection/preview tokens.
Never accept renderer paths, raw CSS, filesystem grants, module names, arbitrary
URLs, shell commands or output PDF bytes as authority. Bind tokens to the trusted
main frame, session epoch, action and source hash; reject replay in another session.
Reauthorize after dialogs/awaits and immediately before publication. Do not log
theme text, creator/licence text, filenames, source paths or manuscript content;
fixed codes and operation IDs suffice.

Imported image/font parsing is an untrusted-data boundary. Reuse existing bounded
image validation where applicable; new font support requires a reviewed isolated,
deadline/memory-bounded parser/sanitizer before any imported font reaches Chromium
or PDF-lib. The existing main-process parser for trusted bundled fonts is **not**
approval to feed it arbitrary packages. No networking, filesystem/process APIs,
dynamic code or plugins are granted to resource workers. Validate worker output.
Retain sandbox, context isolation, disabled Node integration and the current
network-denying render sessions. Permit only captured data/resource tokens through
narrow CSP changes; never `unsafe-inline`, `file:`, remote fonts or a plugin runtime.
