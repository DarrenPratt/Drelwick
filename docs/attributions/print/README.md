# Print resources

The print pipeline uses the unmodified Latin WOFF faces (400/700, normal/italic)
from pinned production packages `@fontsource/noto-serif` 5.2.8 and
`@fontsource/noto-sans` 5.2.10. Google Inc.'s SIL Open Font License 1.1 permits
bundling and document embedding. The verbatim package notices are retained here:
[Noto Serif](noto-serif.txt), [Noto Sans](noto-sans.txt).
The packages also retain these notices in application distributions.
Generated documents do not acquire the font's licence.

PDF assembly uses `pdf-lib` 1.17.1 (MIT) and `@pdf-lib/fontkit` 1.1.1 (MIT).
PDF inspection/viewing uses `pdfjs-dist` 5.4.624 (Apache-2.0), including its
packaged worker. Their upstream licences/notices remain in the production
packages. Node-side PDF inspection also requires pinned `@napi-rs/canvas`
0.1.100 (MIT bindings and platform-native Skia runtime); retain its upstream
package notices. The packaging hook explicitly includes the installed target
native binary, as it already does for Sharp. No system font is copied, licensed
or embedded by this implementation.
This does not change Drelwick's licence or clear the public release gate.
