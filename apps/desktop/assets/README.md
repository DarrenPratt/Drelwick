# Application artwork

`branding/app-logo.png` is the original supplied Drelwick logo, preserved without
changes. `icons/app.png` (512 pixels) and `icons/app.ico` (16, 24, 32, 48, 64, 128
and 256 pixel frames) are generated from it without cropping or changing the design.

These files constitute the current Drelwick application branding. No artwork
reuse licence is established by this guide or inferred from the intended
Community source licence. Artwork rights and reuse permissions are pending
professional review. See the [proposed branding policy](../../../docs/branding-distribution-policy.md)
and [asset/provenance inventory](../../../docs/planning/59-branding-review.md#asset-inventory).
The owner reports ChatGPT origin; preserve the original provenance metadata.
Tool origin does not establish ownership, trademark clearance or reuse rights.

Regenerate with the repository's pinned Electron version:

```sh
pnpm --filter @drelwick/desktop icons:generate
```

The main process loads these assets relative to `app.getAppPath()`, independent
of the working directory. Windows/Linux windows use the icon; macOS uses the PNG
for its running Dock icon. No renderer filesystem privileges are involved.

Installer packaging is not configured yet. When it is added, include `assets/icons`
in the application and use `icons/app.ico` for the Windows executable/installer.
Generate the macOS bundle ICNS from the preserved source at that point. The
development Electron executable itself (and shortcuts pinned to that executable)
still has Electron's embedded icon; this change sets the running application icon.
