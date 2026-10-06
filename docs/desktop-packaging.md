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
pnpm install --frozen-lockfile
pnpm --filter @drelwick/desktop package
pnpm --filter @drelwick/desktop package:dir
pnpm --filter @drelwick/desktop package:inspect
pnpm --filter @drelwick/desktop package:validate
```

`package` cleans the five application/workspace `dist` directories, rebuilds the
desktop and its workspace dependencies, and creates installable artifacts.
Do not run packaging concurrently with development or other builds in the same
checkout. Cleaning prevents removed modules, stale Vite chunks and temporary
files from leaking into artifacts. Only known compiler output directories are
removed; redirected output directories are rejected.
`package:dir` performs the same build and creates an unpacked application for
inspection. `package:inspect` performs the ASAR-only checks without launching the
application, which is useful on hosts that block unsigned executables.
`package:validate` creates the unpacked application, checks its ASAR
inventory, starts the packaged executable, and verifies a smoke marker written
only after the bundled renderer has loaded and confirmed the preload API. The
validation script uses an isolated temporary user-data directory and removes it
when it exits.
To inspect or launch an already-built target without rebuilding, run
`pnpm --filter @drelwick/desktop exec node scripts/validate-package.mjs`.
It accepts `--inspect-only` and `--app-dir=<path>` (absolute or relative to
`apps/desktop`), for example `--app-dir=release/portable/win-unpacked` or
`--app-dir=release/nsis/win-unpacked`. This checks the actual target staging
directory; it does not test the installer itself.
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
The desktop manifest's `homepage` points to the repository and supplies the
project URL required by the Debian package builder.

## Inclusion and runtime paths

Packaging starts with `pnpm --filter @drelwick/desktop... build`, which rebuilds
the desktop and its workspace dependencies in dependency order. The explicit `files` list includes only compiled
`dist/main/**/*.js`, the bundled preload, renderer HTML/assets, the two runtime
application icons and the desktop package manifest. Electron
Builder resolves production dependencies from that manifest, including the
workspace package distributions. Our workspace source files, declarations, source maps,
tests, fixtures, coverage, reports, environment files, repository metadata,
temporary files and user/manuscript data are excluded.
Third-party `src` directories are retained by default because some packages execute code
from them. The pinned TipTap, ProseMirror, entities, Sharp and Zod packages were
checked to execute compiled/root JavaScript; only their source directories are
excluded explicitly. Exclusions are scoped to known development content rather than
assuming every dependency uses a `dist` directory. Dependency notices and
runtime data, including both Hunspell dictionaries and isolated import parser
bundles, remain included and are checked by package inspection.

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

The validation script checks the ASAR inventory for required entries, native
libraries, dictionary data, referenced renderer scripts/styles, manifest version and
development-only paths, then launches the packaged executable and verifies:

- the packaged main process starts;
- the renderer loads from the packaged `dist/renderer/index.html`;
- the restricted `window.drelwick` preload API is available.

It does not create a project or include manuscript content. Artifact inspection
must additionally review generated notices and dependency licensing before any
distribution decision.

## Platform and environment limitations

Electron Builder should be run on the target operating system and architecture
with its native dependencies installed. Cross-compilation is not supported by
these commands. The existing CI packaging job now has Windows, macOS and Linux
matrix runners. Each builds its configured installer targets, then builds and
inspects an unpacked application and launches it with an isolated profile. Linux
uses Xvfb and configures its Chromium sandbox helper. Installer generation does
not establish installation/upgrade or first-launch acceptance on clean machines.
The jobs neither upload releases nor require publishing credentials. All
packaging commands explicitly disable publishing. Windows portable
and NSIS output require Windows validation, and macOS DMG output requires macOS
validation. A Windows build must not be described as macOS or Linux runtime
evidence. Record actual matrix results before claiming platform validation.

On Linux hosts that require Chromium's setuid sandbox, the unpacked build's
`chrome-sandbox` helper must be owned by root with mode `4755` before validation.
The disposable CI runner configures only that generated helper after
`package:dir`, then invokes `node scripts/validate-package.mjs` without rebuilding
and resetting those permissions. Local maintainers need an equivalently
configured host. The application itself runs as the ordinary user with sandboxing
enabled; no `--no-sandbox` flag or system-wide sandbox-policy change is used.

No environment variables need to be set for local packaging. pnpm supplies its
own executable path to the build wrapper. Downloads of Electron and installer
tooling require network access during build; the resulting application runs
offline. The smoke validator sets `DRELWICK_PACKAGE_SMOKE_FILE` internally and
passes an isolated `--user-data-dir`; do not set this variable for ordinary use.
On restricted build agents whose normal user cache is not writable, optionally
set `ELECTRON_BUILDER_CACHE` to an absolute writable cache directory, for example
`C:\Projects\Drelwick\out\electron-builder-cache`. This relocates build tooling
only and has no effect on runtime user/manuscript storage.

Windows retains `signAndEditExecutable: false`; macOS explicitly uses
`identity: null` to skip certificate discovery/signing even on a developer's
configured keychain. See the pinned Builder v26
[macOS signing documentation](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/).
No signing credentials, notarisation, app-store packaging, auto-update or release
upload are configured. OS trust controls may block unsigned builds; this task
does not bypass them. An eventual signed build needs separately reviewed
configuration and credentials under #59; these local commands are not a signing
workflow.

Unsigned artifacts from local builds and CI are validation artifacts only. The
official-build, trademark, signing and publication policy remains governed by
[#59](https://github.com/DarrenPratt/Drelwick/issues/59); this configuration
does not make an official-release or licensing decision.

## Release-validation procedure

Continue the [v0.1 checklist](v0.1-release-validation.md) from #51/#151. Historical
#207 results remain in the [recovery record](planning/bookeditor-recovery.md);
they are not evidence for a newly built revision.

For a candidate, record the exact revision, host OS, Node.js/pnpm versions,
Electron Builder version, target, artifact path and SHA-256. Run
`package:validate` against the unpacked artifact and inspect the generated
archive for source/test/manuscript data. On Windows, install and launch both
the portable executable and NSIS result from a clean user account or isolated
profile. On macOS, open the DMG and perform the equivalent first-launch and
renderer checks. On Linux, test both the AppImage and `.deb` installation on
supported distributions. These checks are release validation, not publication
approval.
