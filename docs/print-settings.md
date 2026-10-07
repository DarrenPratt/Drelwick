# Community print settings

Open **Book design → Print settings** to configure the current book locally.
Save explicitly, or use the normal Save keyboard shortcut while the dialog is
open. Failed saves retain the draft and previous valid file. Closing a dirty
dialog requires confirmation. Project transitions and shutdown are blocked while
the dialog is open. No account, network, Pro package or publisher profile is used.
These are implemented settings for a later print consumer: pagination, print
preview and PDF output are not implemented by #128.

## Dimensions and defaults

The default interior is 6 × 9 inches, with 0.75-inch inside, outside, top and
bottom margins plus a 0.125-inch additional gutter. These are starting values,
not a guarantee of suitability for every binding, page count or printer.

| Preset           | Width × height (mm) |
| ---------------- | ------------------- |
| 5 × 8 inches     | 127 × 203.2         |
| 5.25 × 8 inches  | 133.35 × 203.2      |
| 5.5 × 8.5 inches | 139.7 × 215.9       |
| 6 × 9 inches     | 152.4 × 228.6       |
| A5               | 148 × 210           |

Choose **Custom dimensions** to edit width and height. Width supports 76.2–330.2 mm
(3–13 inches), height 101.6–482.6 mm (4–19 inches). These are basic supported
interior bounds, not publisher profiles. All dimensions can be entered/displayed
in millimetres or inches. Persisted lengths are integer micrometres, with exactly
25,400 micrometres per inch. Input is rounded once to the nearest micrometre;
changing display units preserves that physical value. Invalid input is rejected,
never clamped. Empty, non-finite, negative and zero trim dimensions are invalid.

Margins each support 5–100 mm; gutter supports 0–50 mm. At least 50 mm of content
width and 75 mm of content height must remain. Headers require at least 10 mm
top margin; enabled footer page numbers require at least 10 mm bottom margin.
Headers/folios occupy their existing margin areas, not an additional subtraction
from the content area. These geometric checks do not prove typesetting quality.

## Mirroring, chapters and folios

Inside is the binding edge, outside the fore-edge. Gutter is **additional** binding
space, added exactly once to inside. Content width is
`trim.width - inside - gutter - outside`; height is `trim.height - top - bottom`.
On recto (right-hand) pages left margin is inside + gutter. On verso (left-hand)
pages right margin is inside + gutter. Physical side is independent of displayed
page numbering. The current semantics describe left-bound books.

- Chapters start on the next page (default), or the next right-hand page (recto),
  with an intervening blank when necessary. This applies to body chapters, not
  matter-page classification.
- Left/right headers independently select none, author, book title or chapter
  title. Defaults are author on verso and book title on recto. Values come from
  publication metadata/current chapter, never copied prose or raw HTML/CSS.
  Headers are positioned at the outside edge; chapter-title headers are empty
  outside body chapters. Headers are hidden on chapter openings by default.
- Page numbers can be disabled, centered in the footer (default), or at the
  outside footer edge. Body numbering is decimal, starts at a chosen 1–9999
  (default 1), and continues through back matter. Front matter has a separate
  lowercase Roman sequence starting at i (default), or no visible numbers.
  Page numbers show on chapter openings by default; this can be disabled.
- Intentional blank pages suppress headers and numbers but still count in their
  section's sequence. Hidden numbers do not reset counting. Recto/verso decisions
  use physical page position, never odd/even displayed folios.

These are persisted semantic instructions. #129 must consume them when it
implements pagination; this dialog does not manufacture pages or claim rendered
header/folio correctness.

## Fonts and embedding

Typography reuses the existing [Community themes](book-themes.md); there is no
second font picker or arbitrary font-file field. The current print-target CSS
supports the theme's fixed local fallback chains:

- Classic: Georgia, Times New Roman, Liberation Serif, generic serif; 11pt body.
- Modern: Segoe UI, Helvetica Neue, Arial, Liberation Sans, generic sans-serif;
  10.5pt body.
- Literary: Palatino, Palatino Linotype, Book Antiqua, Georgia, Liberation Serif,
  generic serif; 11.5pt body.

Availability means a local renderer can resolve a family. Selecting a theme asks
it to use that fallback chain; it does not install, copy, license or embed fonts.
Missing faces fall back locally. Font metrics vary across Windows, macOS and
Linux. A font being installed does not establish redistribution or embedding
permission. An output adapter must separately establish permission for the exact
font files and the intended output, honor applicable embedding restrictions and
retain required notices. If permission cannot be established, it must use an
appropriately licensed alternative or report the limitation. #128 bundles no
fonts and embeds none; PDF embedding behavior must be verified with #129's
actual output pipeline. No remote font downloads are introduced.

## Versioning, persistence and recovery

`print.json` is an optional strict version-1 component:

```text
{ schemaVersion: 1, projectId: <project UUID>, settings: <PrintSettings> }
```

The persistent envelope is `PrintConfigurationSchema` in project-model; the
renderer-safe semantic vocabulary and validation are shared. Core exports
`loadPrintConfiguration`, `readPrintConfiguration`, `savePrintConfiguration` and
`PRINT_CONFIGURATION_FILE`; shared exports unit helpers and `printPageGeometry`.
The read helper may be used under the shared project lock by a future print job
to capture settings with its manuscript revision. It does not add print settings
to the ebook revision or current ebook assembly path.

Existing project/book/chapter/component versions are unchanged. Absent settings
produce deterministic defaults without writing anything, including historical
v1 snapshots. Normal desktop v1→v2 migration remains unchanged. This additive
component needs no destructive transformation or multi-file migration. The first
explicit Save creates it; subsequent saves atomically replace only that file.
Portable backups include it. A newer version, unknown field, foreign project ID,
malformed data or retained `print.json.tmp` blocks print operations without
rewriting it; normal manuscript authoring remains available.

Saves use the existing project lock, bounded safe-path reads, strict validation,
exclusive temporary-file creation, flush and rename. Expected SHA-256 revisions
reject stale drafts. A failed atomic replacement leaves the previous valid
configuration in place. Retained temporary/lock evidence blocks further writes;
preserve it for recovery. A post-commit lock cleanup failure reports saved settings
with a recovery warning. The same filesystem/power-loss limitations as
[project persistence](project-format.md) apply.

The restricted preload accepts project UUID, expected revision and validated
settings only. Main authorizes the active trusted frame/project and resolves its
own path. No arbitrary paths, font files, CSS, HTML or log payloads are accepted.
Print saves do not write manuscript, publication, theme or ebook configuration.

## Scope and evidence

This is CORE and builds/runs without Pro. Basic layouts are not licence-gated.
Publisher profiles, automated gutter recommendations, compliance, preflight,
advanced typography, premium themes and publishing automation remain separate.
#129 owns pagination/PDF; #133 owns later theme-design work.

- Model tests cover defaults, every preset, custom bounds, unit round trips,
  non-finite values, impossible areas, header/footer space and mirrored geometry.
- Core tests cover persistence/reload, legacy defaults, migration compatibility,
  backup/restore, stale/invalid/failed saves, recovery evidence, lock handling,
  unknown/newer configuration and byte-identical manuscript/ebook isolation.
- Desktop tests cover validated IPC authorization, dialog errors, failed-save
  draft retention, unit changes, semantic controls and explicit discard.
- The Electron print-settings scenario exercises offline native UI persistence,
  failed-save recovery, reopen and source-file isolation.
