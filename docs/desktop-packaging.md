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
unpacked Linux application and runs `package:validate`; it does not build or
validate AppImage/deb installers. The job has not been executed as part of this
local recovery. All packaging commands explicitly disable publishing. Windows portable
and NSIS output require Windows validation, and macOS DMG output requires macOS
validation. A Windows build must not be described as macOS or Linux runtime
evidence, and the current Linux CI check must not be described as Windows or
macOS evidence.

No signing, notarisation, app-store packaging, auto-update, release upload or
publishing credentials are configured. Electron Builder may read standard
platform signing variables when a maintainer deliberately supplies them (for
example `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` and `APPLE notarisation` settings), but this repository does not
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
