# Community book themes

Issue #122 adds three local presentation presets to the shared renderer delivered
by #121 / merged PR #189. Themes never receive manuscript nodes or rewrite prose.

```text
project lock -> assembleBook -> BookRevision + presentation + captured assets
  -> renderBook -> semantic chapter fragments
  + resolveBookTheme -> getBookTheme -> generateThemeStyles(theme, target)
  -> isolated preview wrapper / future ebook or print adapter
```

## Model and validation

`BookThemeSchema` in `packages/project-model/src/book-theme.ts` is strict version 1.
Stable IDs are `classic`, `modern` and `literary`; display names are not identity.
The model describes body/heading font tokens, bounded numeric sizes and spacing,
paragraph alignment/indentation, chapter openings, headings, quotes, epigraphs,
scene-break variants and small ebook/print overrides. Every object rejects unknown
keys. Versions, enums, font tokens, numeric ranges and finite numbers are validated
again at style generation. There is no CSS, HTML, path or resource URL field.

`getBookTheme(id)` returns a validated copy of the built-in definition.
`generateThemeStyles(theme, "ebook" | "print")` returns `{themeId, target, css,
requiredAssets}`; required assets are currently empty. These are pure Community
APIs exported by `@drelwick/renderer`, usable under plain Node without Electron,
filesystem access, a DOM or a network. Repeated input produces identical CSS bytes.

## Preset support matrix

| Presentation    | Classic                                                  | Modern                                                 | Literary                                                 |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Body prose      | Traditional serif, justified, indented, no paragraph gap | Sans-serif, left aligned, spaced paragraphs, no indent | Bookish serif, left aligned, deeper indent and small gap |
| Chapter opening | Centered, restrained divider                             | Left aligned, larger title, compact opening            | Centered, smaller title, generous opening space          |
| Headings        | Bold serif                                               | Semibold sans-serif                                    | Regular serif                                            |
| Quotes          | Normal type, moderate inset                              | Normal type, smaller inset, more separation            | Italic, deeper inset                                     |
| Epigraph        | Centered, italic, 75% width                              | Left aligned, normal, 90% width                        | Right aligned, italic, 65% width                         |
| Scene break     | Rule                                                     | Whitespace                                             | Outlined diamond                                         |
| Ebook override  | Relative body size, base spacing                         | Relative body size, base spacing                       | Relative 1rem body size                                  |
| Print override  | 11pt, denser leading                                     | 10.5pt, reduced leading/gap                            | 11.5pt, denser leading, no paragraph gap                 |

Selectors use only #121's publishing API: `.chapter`, `.chapter-title`,
`.chapter-body`, native semantic headings/paragraphs/lists/quotes, `.epigraph`,
`.scene-break`, `.manuscript-image.image-<size>` and `.manuscript-link`.
No editor DOM classes or new semantic nodes were required. Bold/emphasis and other
marks retain their native semantics. Lists retain their order and indentation.
Scene breaks remain `hr` elements; empty CSS pseudo-elements and borders draw
decorations without adding copied or spoken manuscript prose.

## Typography, fonts and offline behavior

No fonts or theme assets are bundled, downloaded or redistributed; no additional
font licence or attribution files are required. The application names fonts only
as optional local choices, with these fixed fallback chains:

- Traditional serif: Georgia, Times New Roman, Liberation Serif, generic serif.
- Humanist sans: Segoe UI, Helvetica Neue, Arial, Liberation Sans, generic sans-serif.
- Literary serif: Palatino, Palatino Linotype, Book Antiqua, Georgia,
  Liberation Serif, generic serif.

Windows, macOS and Linux can choose an installed member of the chain. A missing
font is normal and silently falls through to the browser/reader's generic family;
it is not a manuscript diagnostic or a rendering failure. The internal
`fontPolicy: "generic-only"` generator option allows adapters/tests to use only
generic families. There is no font picker or environment probing. CSS bytes are
deterministic; exact glyph metrics across operating systems are deliberately not
promised. Future export must not assume system fonts can be embedded or copied.

## Persistence and recovery

The optional root `presentation.json` is an independently versioned additive
project component:

```json
{
  "schemaVersion": 1,
  "projectId": "00000000-0000-4000-8000-000000000101",
  "themeId": "classic"
}
```

This is project configuration, separate from `project.json`, `book.json` and
chapter documents. No existing component schema changes. Missing configuration
means Classic, without writing a file; older v1/v2 projects remain valid. Existing
v1 migration leaves chapter bytes intact. Portable backups include the sidecar.

Saved theme IDs may be safe unavailable slugs. Such a project opens with Classic
and an unavailable-theme UI notice, preserving the original saved ID until the
author explicitly selects a built-in theme. Malformed/future-version or foreign
configuration blocks theme operations and book assembly with fixed errors, but
does not block ordinary authoring or erase the configuration.

`saveBookTheme` validates the ID before path access, validates the active project,
acquires the shared project operation lock and uses the existing exclusive-temp,
flush-and-rename atomic writer. Failed writes preserve prior settings and chapters.
Retained `.tmp` evidence blocks writes/assembly until recovery; it is never
overwritten or deleted by theme loading. Linked/network paths are rejected through
the existing path boundary. A post-commit lock cleanup failure returns a saved
selection plus a recovery warning instead of pretending persistence failed.

Assembly captures settings under the same lock as the manuscript and rechecks
the captured bytes/settings. Presentation is separate from `BookRevision`; switching
themes does not change its semantic revision hash. The standalone theme getter
reads one atomically replaced component, not a manuscript snapshot.

## Desktop and preview safety

The Book design panel and Book preview dialog expose a labelled native select,
keyboard operation, focus outline, selected value and status/error text. Pending
manuscript edits must finish saving before selection; theme selection itself does
not invoke manuscript save. Preview still flushes genuine pending edits before
assembly. Temporarily freezing editor editability does not emit an edit event.

The restricted `book:theme-get` and `book:theme-set` IPC requests accept only an
active project UUID, built-in theme ID and optional preview revision. Main-frame
authorization, strict request validation and the existing project-operation gate
apply; no caller supplies paths, CSS or font files. Failed saves retain the previous
UI selection and preview. Async loads ignore replies from a previous project.

The main process retains one prepared semantic preview. Selection with its revision
restyles that exact markup without assembling or traversing manuscript data again.
Closing/switching/reopening a project invalidates the cache; a stale revision is
rejected before persistence. The preview remains a captured saved revision, not a
live editor view. Close/reopen preview to include later manuscript changes.

Only generated preset CSS is placed in the controlled wrapper. Its exact SHA-256
hash is authorized by CSP; arbitrary inline styles remain blocked. `script-src`,
`font-src`, `connect-src`, frames, objects, base and forms remain disabled; images
are still controlled embedded PNG/JPEG bytes. There is no `unsafe-inline`, remote
stylesheet, font request or theme asset path. The iframe retains `sandbox=""`, no
referrer, no same-origin privilege and no preload. Electron isolation/Node settings
are unchanged. Theme operations do not log manuscript input, output or errors.

## Target and extension boundaries

Each theme has one base definition with small validated overrides. Ebook output
uses relative body sizing and ordinary reflowable CSS; readers may override it.
Print output uses point body sizes and adjusted leading/spacing. Neither target
copies prose or invokes another semantic renderer.

- #124 can consume the selected theme and ebook CSS for a full reflowable preview.
- #126 can package the shared XHTML and ebook CSS; `requiredAssets` is empty today.
- #128 owns physical book layout (trim, gutters, headers and page configuration),
  separately from typography. #129 owns pagination/print rendering/PDF.
- #133 may evolve the versioned presentation vocabulary after its design/security
  decisions. This change accepts no custom/imported CSS, theme packages, arbitrary
  fonts, dynamic modules, plugins or user-defined themes.
- #136 retains the dedicated large-print preset and export-validation profile.

Future Community presets extend the typed catalogue, schema where needed, support
matrix and golden tests together. There are no Pro dependencies or licence gates.

## Verification

`packages/renderer/test/themes.test.ts` applies six CSS golden files (three themes
by two targets) to the same comprehensive semantic fixture from #121. Exact markup
and text comparisons detect presentation-induced changes, alongside the original
renderer source-text inventory tests. Golden CSS preserves serializer bytes and is
excluded from formatting. Validation tests reject active-content strings, CSS,
URLs, filesystem paths, unknown keys and out-of-range/unsupported configuration.

Core tests cover old projects, migration defaults, byte-identical chapters, theme
switch/reopen, portable backup, unavailable IDs, failed atomic rename, lock exclusion,
recovery evidence and linked paths. Desktop tests cover cached restyling, IPC/preload
authorization, CSP hash scope, selection failure and unchanged prose. Native Electron
tests switch all presets offline, compare chapter bytes and exact preview markup,
simulate generic-only fonts, restart, and exercise #121's privilege/network boundary.
See [the acceptance audit](book-themes-acceptance.md).
