# Declarative local theme package v1

Design contract for #133; not an implemented importer. This specifies a strict
subset of ZIP and a versioned manifest, not a plugin format. See
[custom theme behaviour](custom-themes.md) and the
[schema/examples](examples/theme-package-v1/README.md). An extension or a valid
manifest alone never authorizes executing code, reading arbitrary files, applying
a theme, installing fonts system-wide, or publishing an output.

## 1. Container, identities and compatibility

The proposed extension is `.drelwick-theme`, an ordinary non-encrypted ZIP with
exactly one root `manifest.json` and the regular files in its asset/notice inventory.
There is no containing top-level folder, executable header, archive comment,
embedded archive, undeclared file or explicit directory entry. Export emits a
deterministic subset (stored entries, sorted paths, fixed timestamps, no extra
fields); import additionally accepts DEFLATE after the bounded checks below.
Deterministic validation is separate from byte-identical third-party ZIP encoding.

The accepted v1 flag values are `0` and `0x0800` (UTF-8 names); names must still
match the ASCII path grammar. Methods are `0`/`8` only, with ZIP version-needed
10 or 20 as appropriate. No data descriptors or extra fields are supported in v1.
Creator platforms are FAT/Unix only: FAT entries must not be directories/devices;
Unix file-type bits must identify a regular file. Reject link/special-file types
and ambiguous attributes. Local file extents cover the file-data region exactly,
followed by the matching central directory and final EOCD; reject overlaps, gaps
and trailing records. Timestamps never define identity and are not restored as
authority. These constraints apply before any extraction or resource decoding.

| Manifest field                                 | Meaning                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format: "drelwick-theme"`, `formatVersion: 1` | Container/layout/decode profile. Never infer it from filename.                                                                                                                                                                                                                   |
| `schemaVersion: 1`                             | Exact manifest structure. Unknown fields/versions are not extensions to ignore.                                                                                                                                                                                                  |
| `theme`                                        | Lowercase UUID-v4 identity, immutable three-part version, bounded Unicode name/creator/description, and `rights` (`author-declared` or `unverified`). These are display/provenance claims, not authentication or a licence grant. No reserved built-in identity can be imported. |
| `compatibility`                                | Renderer-contract integer range `{min,maxExclusive}`, presentation version 2, print version 3, and a sorted unique exact set of required capability IDs. These are contract versions, **not** the application's current `0.0.0` version.                                         |
| `style`                                        | ThemeStyleV2: complete `base`, sparse EPUB group replacements, and print `{bodySizePt,overrides}`. Properties/ranges are enumerated in the schema; no arbitrary property maps.                                                                                                   |
| `fontSets`                                     | Local role IDs referencing a built-in font token, or four declared static font faces plus an explicit built-in fallback. Family names are not filesystem lookups.                                                                                                                |
| `assets`                                       | Unique IDs, kind, restricted relative path, MIME type, exact byte length, lowercase SHA-256 and licence-notice ID. Fonts and decorative raster images only.                                                                                                                      |
| `licenses`                                     | Unique notice ID/path/hash/length, identifier/copyright display text and explicit per-operation permission declarations. Notices are bundled UTF-8 text. No fetched URLs or executable licence expressions.                                                                      |

The checked-in renderer-contract-2 examples require `style-v2`. Raster ornaments
add `ornament-raster-v1`; asset fonts add `font-static-sfnt-v1`. Derive and validate
the exact capability set from inventory/style. A reader without any required
capability refuses the **whole** import; it never quietly drops unknown fields or
resource types. A package accepted by a documentation validator is not evidence
that the current production renderer supports these future capabilities.

Versions use three decimal integers 0–999, no leading zeroes, prerelease or build
suffix. A saved version cannot be edited in place. Canonical manifest hashing
uses the existing canonical-json-v1 rule: recursive lexicographic object-key sort,
array order preserved, JSON string/number serialization and UTF-8 SHA-256. Values
are not Unicode-normalized. Asset hashes cover exact original bytes. The manifest
has no self-hash field; its inventory hashes bind resources and notices. Import
also captures/rechecks the raw source archive hash against replacement races.

The `.drelwick-theme` suffix and UUID/version are not trust credentials. Equal
UUID/version plus different digest is a conflict, never an update. Preserve both
source/installed data and ask for duplicate-as-new-identity or cancel. Identical
imports are idempotent. No signatures, online activation, catalogue lookup or
automatic update service are introduced.

## 2. Font and asset policy

Font sets resolve regular, italic, bold and bold-italic explicitly. Built-in tokens
retain the current target policy: generic/local fallback for the existing ebook
path, bundled licensed Noto for print. Imported font sets must identify four
distinct static face assets with matching decoded family/style/weight metadata.
Do not synthesize italic/bold or search the host filesystem for a named family.
An explicitly displayed 600-weight request resolves to the registered 700 face.

Allowed imported faces are static SFNT TrueType `.ttf` and OpenType `.otf`, after
isolated structural/sanitizer, glyph, face and embedding checks. WOFF/WOFF2, TTC
collections, variable fonts, SVG/colour/bitmap fonts, EOT and executable installers
are unsupported in package v1. Existing _trusted bundled_ WOFF files are not import
precedent. Broader script support requires licensed faces and shaping/output tests;
the current Latin-only print limitation is not a Pro boundary.

Decorative images are single-frame PNG/JPEG, decoded with bounded dimensions,
pixel count and memory. Reject SVG, animation/APNG, scripts, PDFs, external
references, CMYK JPEG, unsupported colour models and nested containers. MIME,
extension, signature and actual decoded format must agree. Do not trust EXIF size
or orientation; generate a deterministic sRGB/alpha-safe display derivative with
metadata removed and include its decoder/version/hash in render identity. Keep
original validated bytes immutable for package integrity and explicit export.
Use existing image validators where they satisfy these requirements, not a second
unrestricted image subsystem.

No package may import arbitrary local/system font paths, CSS `url(...)`, network
fonts, HTML ornaments, JavaScript, WASM, DLLs, shell commands or executable plugins.
A raster separator is purely decorative; retain the semantic `hr`, empty alt/
presentation semantics where a wrapper is needed, and its declared simple fallback.
Never replace authored narrative content with a theme image.

### Rights are separate from technical availability

Every bundled asset must reference an included notice. Record separate boolean
declarations for `copyToProject`, `redistributePackage`, `embedEpub`, `embedPdf` and
`subsetFont`. Missing/contradictory permissions are not silently granted:

| Operation                   | Required evidence/policy                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install/copy into a project | Valid notice/inventory and declared project-copy permission for each copied asset. Keep original notice/provenance. Unverified ownership remains visibly unverified.                                                                                                         |
| Package export/share        | Redistribution permission for every included asset. A font permitted in a PDF is not thereby permitted in an extractable theme ZIP. Refuse export or explicitly export a **new derivative theme identity** using approved substitutes; never silently omit required files.   |
| EPUB                        | Permission for extractable ebook font/image embedding for the effective EPUB resource closure. Include required notices and OPF resources; no remote fetch. Font obfuscation is neither a rights grant nor DRM.                                                              |
| PDF/production preview      | Permission for PDF embedding of the effective print closure and actual successful embedding. Current subset-dependent paths also require subsetting permission. A no-subsetting face blocks that path until a verified full-font alternative exists; do not ignore its flag. |
| Personal recovery backup    | Preserve installed project-owned data and notices through the normal private backup workflow. Do not mislabel a backup as a cleared redistribution package or publish it automatically. The application does not determine the user's legal rights.                          |

Check actual OpenType embedding restrictions (`OS/2.fsType`) against declarations;
a manifest cannot override restrictive flags. Technical flags alone do not establish
all licence/redistribution rights. Ambiguous, missing or conflicting rights require
an approved substitute or refusal for the affected operation. Use the supplied
licence for the exact font version, retain copyright/reserved-name obligations and
do not relabel third-party ownership. No font licences or Drelwick product licences
are selected by #133. The example permission booleans are synthetic test claims,
not legal approval.

For technical background see [OpenType fsType](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype),
[Microsoft's font redistribution distinction](https://learn.microsoft.com/en-us/typography/fonts/font-faq)
and the [OFL FAQ](https://openfontlicense.org/ofl-faq/). These require checking each
actual licence; they are not a blanket permission for a font found on a computer.

## 3. Mandatory resource bounds

These are proposed safety ceilings, not commercial limits. Readers may use lower
documented platform limits and fail explicitly. Apply them to actual streamed/
decoded values as well as declared metadata; no unbounded allocation precedes checks.

| Resource                       | V1 ceiling                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source ZIP                     | 32 MiB; one regular source file; no ZIP64, multi-disk or encryption                                                                                                                                      |
| Entries / total expanded bytes | 64 entries; 64 MiB actual expanded aggregate, including notices/manifest                                                                                                                                 |
| Manifest                       | 256 KiB UTF-8, depth 16, 20,000 JSON values; duplicate keys, invalid scalars, BOM, non-finite/out-of-range numbers or trailing data reject                                                               |
| Assets / font sets             | 32 assets (at most 16 faces and 16 ornaments); 8 font sets                                                                                                                                               |
| Font bytes                     | 8 MiB per face; 32 MiB aggregate                                                                                                                                                                         |
| Raster bytes / pixels          | 4 MiB per file, 16 MiB aggregate; dimensions at most 8,192 each, 16,777,216 pixels/image, 33,554,432 aggregate decoded pixels                                                                            |
| Notices                        | 16 files, 64 KiB each; decoded text only, no markup execution                                                                                                                                            |
| Compression                    | Stored or DEFLATE only; maximum 100:1 actual expanded/compressed ratio per entry; use at least one byte as divisor                                                                                       |
| Jobs                           | One active import/render per project; 30 s package validation overall, 5 s resource job deadline, bounded 256 MiB resource worker heap/decoded output; terminate stuck workers and discard their results |

The worker budget must be demonstrated on supported platforms, not asserted because
an async function has a timeout. Blocking/native parser work needs an isolation
boundary that can be terminated; a main-process timer cannot enforce it. Deadlines
do not promise an interruptible disk syscall or a whole-OS memory quota. Existing
book/PDF limits remain in addition; do not raise them to make a package pass.

## 4. Archive/path preflight and validation order

Treat ZIP metadata and JSON as untrusted. The future implementation must reuse/audit
existing DOCX/archive preflight patterns, not call a general-purpose extract-all API.

1. Main authorizes the native source selection and captures identity/size/hash.
   Open a regular non-linked file, not a directory, device, alternate stream or URL.
2. Preflight EOCD/central-directory/local-header bounds before decompression.
   Validate offsets, entry extents, no overlap, matching names/methods/flags/sizes,
   supported flags/encoding, CRC and actual expanded counts. Reject encryption,
   data descriptors/extra fields outside the explicitly supported profile, ZIP64,
   ambiguous records, prefixes/trailing junk and malformed/understated sizes.
3. Decode names with the specified UTF-8/ASCII subset. Paths are exactly
   `manifest.json`, `assets/<lowercase-slug>.(png|jpg|ttf|otf)` or
   `licenses/<lowercase-slug>.txt`. Refuse absolute/drive/UNC names, backslashes,
   colons/ADS, NUL/control bytes, `%` escapes, `.`/`..`, duplicate paths, case-fold
   collisions, trailing spaces/dots and Windows device names. Never repair a path
   into an apparently safe name. Directory, symlink, hard-link/reparse and special
   entries are invalid even when their spelling looks safe.
4. Bounded strict UTF-8/JSON decode and exact schema/version check. Compare the
   **complete** archive inventory to the manifest (plus manifest itself), including
   duplicate IDs, sorted unique capability list, font/style references, file lengths,
   MIME/extension agreement and hashes. No undeclared files, optional executable
   entries or in-package relative imports. Decompress only into owned quarantine;
   ensure resolved paths remain there and reject links already on disk.
5. Verify notices/permission declarations and resource cross-references. Run isolated
   bounded raster/font validation and validate its output. Do not pass unchecked
   bytes to Chromium/PDF-lib because a header or SHA-256 looked plausible.
6. Validate target capabilities and render a synthetic smoke sample where resources
   are supported. Report exact limitations. Recheck source hash/authorization before
   installing an immutable bundle under the existing project lock.
7. Return an opaque validated candidate token, fixed diagnostics and bounded escaped
   metadata. **Import** installs only after explicit confirmation; **Apply** is a
   separate action with expected reference hashes. On failure/cancel retain the
   previous valid selection, discard only owned disposable quarantine or retain
   identified recovery evidence, and never auto-open package content as a page.

Use fixed codes such as `THEME_MANIFEST_INVALID`, `THEME_REFERENCE_INVALID`,
`THEME_UNSUPPORTED`, `THEME_ARCHIVE_INVALID`, `THEME_LIMIT`,
`THEME_RESOURCE_INVALID`, `THEME_RIGHTS_UNRESOLVED`, `THEME_CONFLICT` and
`THEME_STALE`. Diagnostics may identify bounded logical roles/entry indexes, not
raw parser errors, author text or private filesystem paths. Sort by validation
stage then logical ID; do not use locale-dependent/timestamp ordering.

ZIP details are grounded in [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).
The restrictions above are Drelwick's deliberately smaller proposed acceptance
profile, not a claim that every legal ZIP variant should be supported.

## 5. Installation, export, backup and removal

Follow the [immutable installation/reference-last protocol](custom-themes.md#publication-and-write-protocol).
No mutation of a built-in preset, shared global font directory, existing version
or source archive is authorized. Source changes after validation invalidate its
token. Installation racing a same-identity install resolves by exact digest, not
mtime. A stale selection is not applied after a newer edit/project switch.

Export packages from the captured validated theme and complete declared resources/
notices only. Never include project metadata, chapter prose, reference/editorial
records, snapshots, machine paths, source archives or hidden temporary files.
An included permission record does not grant rights automatically. Export needs
native destination/overwrite review and the existing validated atomic binary writer;
validate staged bytes and destination identity before publication. Cancel/failure
preserves an existing destination. Do not replace selected bundle bytes with a
repacked archive or alter its identity simply to export it.

Restore imports through the same strict gateway; a backup is not trusted input.
Full project archives/named snapshots must extend their exact allowlists and
capture the pinned closure before the feature is enabled. Unavailable versions
are explicit; offline means no resource fetch even during restore. Reversible
archive/removal refuses referenced versions and retains recoverable data/notices.
Physical deletion/automatic retention is outside v1.

## 6. Trust boundary and validation claims

Theme data, creator/licence claims, asset binaries and third-party ZIP records are
untrusted. Manuscript content is separately authoritative and never part of a
theme package. Privileged main/core resolve authorized files, enforce permissions,
capture immutable bytes and commit references. The pure renderer sees only
validated values and ID-resolved resources. Generated output is not allowed to
grant capabilities back into the editor or host.

Keep the existing capability-free iframe, sandboxed print surface, disabled
`nodeIntegration`, context isolation, no navigation/download/permission grants,
and denied network/file requests. Extend resource handling narrowly for captured
font/image bytes; do not enable remote resources or unrestricted style sources.
No plugin runtime, arbitrary JavaScript, WASM or dynamic import is involved.

The schema/graph fixtures in #133 prove that these example documents conform or
fail for specified reasons. They **do not** prove a ZIP decoder, font sanitizer,
rights database, real importer or resource-limit enforcement exists. Those are
mandatory automated and manual follow-up acceptance tests, not design-PR results.
