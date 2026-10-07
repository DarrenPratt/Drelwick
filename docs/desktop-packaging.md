# Desktop packaging

Drelwick uses Electron Builder to create local standalone desktop artifacts. A
packaged application contains the compiled Electron main process, preload bundle,
Vite renderer assets, application icons and production dependencies. It does not
require Node.js, pnpm or a repository checkout on the target machine. Project
folders and manuscript data remain outside the application bundle and are never
packaged.

## Local commands

Run these commands from the repository root:

```text
pnpm --filter @drelwick/desktop package
pnpm --filter @drelwick/desktop package:dir
pnpm --filter @drelwick/desktop package:inspect
pnpm --filter @drelwick/desktop package:validate
```

`package` rebuilds the desktop and its workspace dependencies and creates installable artifacts.
`package:dir` performs the same build and creates an unpacked application for
inspection. `package:inspect` performs the ASAR-only checks without launching the
application, which is useful on hosts that block unsigned executables.
`package:validate` creates the unpacked application, checks its ASAR
inventory, starts the packaged executable, and verifies a smoke marker written
only after the bundled renderer has loaded and confirmed the preload API. The
validation script uses an isolated temporary user-data directory and removes it
when it exits.
On Unix it force-stops that manuscript-free smoke process and waits for its exit
before removing the profile; Electron's normal graceful-shutdown handling can
otherwise leave the validator running after successful validation.

The output directory is `apps/desktop/release/`. The Windows `package` command
places the two same-host artifacts in `release/portable/` and `release/nsis/`
so they cannot overwrite one another. The configured targets are:

| Platform | Targets                                | Availability                                                              |
| -------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Windows  | Portable executable and NSIS installer | Build on Windows                                                          |
| macOS    | DMG                                    | Build on macOS; signing/notarisation are not configured                   |
| Linux    | AppImage and `.deb`                    | Build on Linux; package-manager/runtime testing remains platform-specific |

Electron Builder target selection and artifact naming are defined in
`apps/desktop/electron-builder.yml`. The application ID is
`com.drelwick.desktop`, the product name is `Drelwick`, and the version comes
from `apps/desktop/package.json`. The output directory is deliberately outside
`dist/`, so stale development output is not mistaken for a package.

`apps/desktop/package.json` is the authoritative application/package version
source. The workspace root manifest has its own private workspace version, but
Electron Builder is invoked from the desktop package and reads the desktop
manifest; it does not use the root version. Artifact names therefore use the
desktop package version, for example `Drelwick-0.0.0-win-x64.exe` for the
current development version.

## Inclusion and runtime paths

Packaging starts with `pnpm --filter @drelwick/desktop... build`, which rebuilds
the desktop and its workspace dependencies in dependency order. The explicit `files` list includes only compiled
`dist/**`, application icons and the desktop package manifest. Electron
Builder resolves production dependencies from that manifest, including the
workspace package distributions. Source files, declarations, source maps,
tests, fixtures, coverage, reports, environment files, repository metadata,
temporary files and user/manuscript data are excluded.

The compiled main entry is `dist/main/main.js`, the preload entry is
`dist/preload/preload.cjs`, and the renderer entry is
`dist/renderer/index.html`. The main process resolves these paths relative to
its own packaged module URL and resolves icons through `app.getAppPath()`, so
the paths work inside the ASAR archive rather than depending on the checkout
working directory. Native runtime files, when present in a production
dependency, are unpacked by the `asarUnpack` rules.

The `beforePack` hook explicitly includes installed Sharp native packages.
Without this mapping the pinned builder omitted those optional image-processing
binaries in this workspace and the packaged main process failed to load.
Build on the target host and architecture with its frozen dependencies installed.
Each explicitly mapped native package is excluded from automatic dependency
copying. Linux can otherwise discover the same libvips package through both
paths, causing duplicate hard links during ASAR staging. The hook is idempotent
and a regression test checks both copy filters using the pinned builder.
Linux explicitly names its executable `drelwick`, matching the runtime validator
instead of deriving a name from the scoped workspace package name. On Unix,
launch errors and early exits are reported immediately, with native stderr kept
visible for the isolated, manuscript-free smoke run.

The validation script checks the ASAR inventory for required entries and
development-only paths, then launches the packaged executable and verifies:

- the packaged main process starts;
- the renderer loads from the packaged `dist/renderer/index.html`;
- the restricted `window.drelwick` preload API is available.

It does not create a project or include manuscript content. Artifact inspection
must additionally review generated notices and dependency licensing before any
distribution decision.

## Platform and environment limitations

Electron Builder should be run on the target operating system for reliable
native artifacts. The configured `Linux packaging validation` CI job builds an
unpacked Linux application, configures its Chromium sandbox helper, and runs the
package validator against that same build; it does not build or
validate AppImage/deb installers. The job passed on CI run
`37345022876` (Linux packaging validation job `111883727910`). All packaging
commands explicitly disable publishing. Windows portable
and NSIS output require Windows validation, and macOS DMG output requires macOS
validation. A Windows build must not be described as macOS or Linux runtime
evidence, and the current Linux CI check must not be described as Windows or
macOS evidence.

On Linux hosts that require Chromium's setuid sandbox, the unpacked build's
`chrome-sandbox` helper must be owned by root with mode `4755` before validation.
The disposable CI runner configures only that generated helper after
`package:dir`, then invokes `node scripts/validate-package.mjs` without rebuilding
and resetting those permissions. Local maintainers need an equivalently
configured host. The application itself runs as the ordinary user with sandboxing
enabled; no `--no-sandbox` flag or system-wide sandbox-policy change is used.

No signing, notarisation, app-store packaging, auto-update, release upload or
publishing credentials are configured. Electron Builder may read standard
platform signing variables when a maintainer deliberately supplies them (for
example `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` and Apple notarisation settings), but this repository does not
set or require them. Never add credentials to the repository or CI logs.

Unsigned artifacts from local builds and CI are validation artifacts only. The
official-build, trademark, signing and publication policy remains governed by
[#59](https://github.com/DarrenPratt/Drelwick/issues/59); this configuration
does not make an official-release or licensing decision.

## Release-validation procedure

For a candidate, record the exact revision, host OS, Node.js/pnpm versions,
Electron Builder version, target, artifact path and SHA-256. Run
`package:validate` against the unpacked artifact and inspect the generated
archive for source/test/manuscript data. On Windows, install and launch both
the portable executable and NSIS result from a clean user account or isolated
profile. On macOS, open the DMG and perform the equivalent first-launch and
renderer checks. On Linux, test both the AppImage and `.deb` installation on
supported distributions. These checks are release validation, not publication
approval.

## Current validation evidence

The following evidence was recorded from the current checkout on Windows
(Node.js 24, pnpm 10.34.5, Electron Builder 26.0.12, x64) and from the
successful Linux CI job above. “Built” means the target artifact or unpacked
application was actually generated. “Runtime tested” is limited to the exact
runtime described; it does not imply clean-install, installer, signing or
cross-platform support.

| Platform | Target               | Configured | Built      | Runtime tested                                                      |
| -------- | -------------------- | ---------- | ---------- | ------------------------------------------------------------------- |
| Windows  | NSIS installer       | PASS       | PASS       | NOT TESTED (unsigned installer was not installed)                   |
| Windows  | Portable executable  | PASS       | PASS       | NOT TESTED (unsigned executable launch was blocked by local policy) |
| macOS    | DMG                  | PASS       | NOT TESTED | NOT TESTED                                                          |
| Linux    | AppImage             | PASS       | NOT TESTED | NOT TESTED                                                          |
| Linux    | `.deb`               | PASS       | NOT TESTED | NOT TESTED                                                          |
| Linux    | Unpacked application | PASS       | PASS (CI)  | PASS (CI smoke validator)                                           |

Windows package artifacts from the local run were:

| Artifact                                                   | Size              | SHA-256                                                            |
| ---------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `apps/desktop/release/portable/Drelwick-0.0.0-win-x64.exe` | 95,379,669 bytes  | `CDA9B23DC7FDFC108E10681BEC42D2CD71D359E821DC86B16663E8BF174AC400` |
| `apps/desktop/release/nsis/Drelwick-0.0.0-win-x64.exe`     | 105,999,765 bytes | `D4F8F5F70C32F0996A8E689E34AD9C5584EF758B0BB9A1BAE389CFEAEBAD5B03` |

The unpacked Windows application was inspected with
`pnpm --filter @drelwick/desktop package:validate`. It contained the compiled
main process, preload, renderer index, icons, production dependencies and
unpacked Sharp native libraries; no repository source, tests, fixtures,
coverage, reports, environment files or manuscript/project data were present.
The validator launched that packaged application and observed the
`renderer-and-preload-ok` smoke marker. The portable and NSIS container files
were generated successfully, but their clean install/launch behavior remains
unvalidated because the local Windows Application Control policy blocks
unsigned executable launch.
