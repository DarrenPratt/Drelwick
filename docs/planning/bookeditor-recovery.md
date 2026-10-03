# Recovery of work from the BookEditor checkout

On 3 October 2026, uncommitted work was recovered from `D:\Source\BookEditor`
into `D:\Source\Drelwick`. Classification: CORE (`product:core`), related to
#107 (packaging) and #127 (publishing validation).

## Review and scope

BookEditor's HEAD was `4d93afedfd9be257c1939eb8a9ef88065dc34e88`.
Drelwick's starting HEAD was `2f0be8b`; its tracked tree was identical to that
BookEditor commit. All recent committed DOCX/EPUB changes were already present
through the merged PRs. Only the 16 modified tracked files and six untracked
files needed recovery. The source checkout was left unchanged.

The recovered work adds Electron Builder targets, package inspection/runtime
validation, Linux CI checks, publishing E2E coverage, export failure/security
tests, a 100,000-word EPUB fixture, and release documentation. Prerequisites
#5/#46 for packaging and #126/#125/#116/#124/#45/#47 for publishing were checked
closed against GitHub and the corresponding implementation was inspected.
#51 remains a coordination/release gate; #59 does not block local packaging.
No issue was closed and no PR, publication or repository archive operation was
performed. Changes are on `chore/107-recover-bookeditor-changes`.

## Corrections made during review

- Build desktop workspace dependencies before packaging, including on a fresh
  checkout, and explicitly disable artifact publishing.
- Correct macOS bundle resource paths and architecture-specific output paths.
- Include installed Sharp native image packages explicitly: the recovered
  configuration omitted them and the packaged application could not start.
  Keep native libraries outside ASAR using Electron Builder's unpack rules.
- Hide the Windows smoke helper, quote profile paths, constrain temporary
  cleanup to its generated workspace directory and exclude package output from
  lint/format scans.
- Restart the publishing scenario with its original profile before exporting.
  Preserve the existing text-import test's same-profile restart instead of
  adopting the source change that replaced it with a fresh profile.
- Distinguish historical BookEditor evidence from fresh Drelwick checks and
  remove unsupported claims that a configured Linux job validates installers.

The native inclusion hook uses Electron Builder's documented
[beforePack hook](https://www.electron.build/v26/docs/features/hooks/) and
[file mappings](https://www.electron.build/v26/docs/contents/). It resolves the
installed packages rather than embedding pnpm store paths. Build on the target
host and architecture; cross-compilation is not validated.

## Validation and remaining limitations

Fresh checks in Drelwick on Windows with Node 24.18.0 and pnpm 10.34.5:

| Check                                         | Result                                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| Frozen-lockfile install                       | Passed                                                  |
| Lint, format check and strict typecheck       | Passed                                                  |
| Unit tests                                    | 961 passed in 84 files                                  |
| Build and workspace/Community-boundary checks | Passed                                                  |
| Publishing scenario with same-profile restart | Passed                                                  |
| Full Electron suite                           | 17 passed on second full run                            |
| Packaged ASAR inspection                      | Passed; 1,389 entries, including native image libraries |
| Packaged executable launch                    | Blocked by Windows Application Control; not validated   |
| Windows portable and NSIS generation          | Passed; both artifacts are unsigned                     |

Generated local artifacts (relative to `apps/desktop/release/`):

- `portable/Drelwick-0.0.0-win-x64.exe`, SHA-256
  `0ee582145b3e66175428707332a6ccddc06c009b49d28e4f32f84921b357aefa`.
- `nsis/Drelwick-0.0.0-win-x64.exe`, SHA-256
  `3ff671fdfc680dd9f55507d191b4547758322182c36b6c5142841b2d359e66ea`.

`pnpm --filter @drelwick/desktop package` exited successfully. Authenticode
inspection returned `NotSigned` for both outputs. They were not installed or
published; successful artifact generation does not establish runtime acceptance.

Raw port-check logs are ignored files named `artifacts-port-*.log` at the
repository root. The Windows host explicitly rejected the unsigned executable
with “An Application Control policy has blocked this file.” No policy changes
or bypass were attempted. Native dependency inclusion and unpacking are checked
by the package inspector; a successful launch still needs a permitted host.

The first full Electron run passed 16 scenarios but hit the existing chapter
organisation cursor-position assertion (`LeftX Right` versus `Left XRight`).
An immediate isolated rerun passed without changing that scenario or production
code. This intermittent result is retained rather than silently discarded.

The historical EPUBCheck failure is preserved in
[publishing validation](../publishing-release-validation.md). Its synthetic
candidate and logs were copied into ignored `artifacts/issue-127/` and the
documented SHA-256 was verified. EPUB conformance repair, manual reader review,
clean installer testing, macOS/Linux execution and owner release approval remain
separate work. This recovery does not claim those gates are complete.
