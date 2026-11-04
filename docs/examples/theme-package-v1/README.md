# ThemePackageV1 documentation fixtures

These are **#133 design fixtures, not installed/supported application themes**.
The proposed [format](../../theme-package-format.md) and
[style contract](../../custom-themes.md) govern them. No application importer,
custom style compiler, executable plugin or font runtime is delivered here.

| Example                                                               | Expected conformance result                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `valid/minimal/manifest.json`                                         | Smallest asset-free example: current safe font token, complete base style, separate print size, no overrides/assets/notices.                                                                                |
| `valid/ornament/manifest.json`                                        | One synthetic 1×1 PNG plus an exact hashed notice. Demonstrates resource-ID resolution, declared permissions and simple separator fallback; not useful production artwork.                                  |
| `packages/minimal.drelwick-theme`, `packages/ornament.drelwick-theme` | Stored-entry example ZIPs of those directories only, with fixed timestamps and complete declared inventory.                                                                                                 |
| `invalid/active-css.manifest.json`                                    | `THEME_MANIFEST_INVALID`: otherwise valid style includes forbidden author CSS/remote URL/hidden-text instructions.                                                                                          |
| `invalid/traversal.manifest.json`                                     | `THEME_MANIFEST_INVALID`: asset path escapes the package. Never repair it.                                                                                                                                  |
| `invalid/future.manifest.json`                                        | Unsupported manifest version; preserve rather than interpret/downgrade. Documentation shape validator reports `THEME_MANIFEST_INVALID`; runtime must distinguish `THEME_UNSUPPORTED` before shape decoding. |
| `invalid/missing-font.manifest.json`                                  | `THEME_REFERENCE_INVALID`: four font IDs name no declared faces.                                                                                                                                            |
| `invalid/rights.manifest.json`                                        | `THEME_RIGHTS_UNRESOLVED`: project-copy permission is explicitly false.                                                                                                                                     |
| `invalid/duplicate-key.manifest.json`                                 | Strict JSON rejection before schema validation; ordinary `JSON.parse` alone is insufficient.                                                                                                                |

`manifest.schema.json` is a machine-readable Draft 2020-12 description of the
proposed **shape**, generated from the deliberately test-only Zod declaration in
`packages/project-model/test/design/theme-package-v1.ts`. Cross-reference,
capability, aggregate-resource, target-rights and binary/container checks are
additional normative rules. The test compares the checked-in schema to that
declaration to prevent drift. It is not a runtime export and cannot enable the
current application's unsupported theme/package versions.

`custom-theme-design-examples.test.ts` checks positive/negative manifests, strict
JSON, exact resource hashes/lengths, example ZIP entry bytes/CRCs/inventory,
target-rights separation, capabilities and bounds. No third-party font is bundled.
The notice's booleans are synthetic test claims; they do not change repository
licensing, attest ownership or approve redistribution. Runtime archive fuzzing,
symlink handling, font/image sanitizer isolation, actual worker limits, atomic
import and renderer/output tests remain mandatory follow-up work.

Archive adversarial review cases in the package specification include traversal,
UNC/drive/ADS/encoded/device names, collisions, links, malformed/mismatched records,
unknown methods/flags, CRC/hash errors, expansion bombs and interrupted writes.
Reject them before publishing a candidate. The checked-in ZIP inspection test
checks these **known examples**, not an implementation that can safely import
arbitrary attacker-selected archives.

Run after the existing workspace build:

```sh
pnpm exec vitest run packages/project-model/test/custom-theme-design-examples.test.ts
```
