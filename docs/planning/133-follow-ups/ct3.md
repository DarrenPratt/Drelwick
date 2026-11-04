# Support decorative theme assets and licensed static font sets offline

<!-- DRELWICK-133-CT3 -->

Tracking: [#234](https://github.com/DarrenPratt/Drelwick/issues/234); design owner #133.

## Objective and scope

Activate #133's raster-ornament and static-font capabilities through the reviewed
theme package gateway. Extend the existing renderer, EPUB packaging and production
PDF/font pipeline to resolve captured resource IDs, without a second semantic
renderer or narrative image-placement feature.

## Classification and readiness

**Undecided — owner review after #203** (`product:undecided`). Existing built-in
themes, font resources/manual print settings and ordinary Community outputs remain
CORE. Backlog until #133, CT1 (#232) and CT2 (#233) are merged, isolated resource-parser technology
and technical scope are reviewed, and acceptance tests are concrete. #203 evaluates
approved scope/deferrals before allocation; no Pro prerequisite or reverse edge.

## Acceptance criteria

- Only declared single-frame PNG/JPEG and static TTF/OTF files pass bounded isolated
  validation; enforce type, dimensions/pixels/bytes, family/face metadata, glyphs,
  deadlines, heap/decoded output and complete inventory. Prove termination works
  for blocking parsers; do not send arbitrary fonts to the current main parser.
- Reject animation/SVG, variable/collection/colour/bitmap fonts, executable/remote
  resources and unsupported properties. Preserve sources and previous theme data.
- Track exact notice/provenance and separate project-copy, redistribution, EPUB/PDF
  embedding and subsetting declarations; cross-check fsType. Unknown/conflicting
  rights do not pass. Metadata/installed availability never certifies a licence.
- Match explicit normal/italic/bold/bold-italic roles; no hidden system substitution
  or synthetic faces. Existing built-in targets retain current fallbacks/goldens.
- Resolve effective target closure: prohibited unused resources from the other
  target do not block a safe output; copied/exported resources retain required
  permissions/notices. Font subset restrictions are honoured by the actual output.
- Decorative assets retain semantic separators/titles and fallbacks; deterministic
  display derivatives remove metadata. Never replace narrative alt text/prose.
- EPUB packages capture required local resources/notices and use narrow generated
  CSS/CSP. PDF measures and embeds the exact captured fonts/assets before preview.
- Missing/corrupt/unsupported resources yield fixed diagnostics and explicit captured
  fallback/cancel, never a silent pin rewrite. Archive/snapshot closure round-trips.

## Expected components

Model asset/font/notice schemas and capability rules; core bounded capture/resource
policy and worker coordinator; pure renderer resource descriptors/compiler; EPUB
manifest/resource packaging; desktop isolated decoder/font loading, print embedding,
PDF inspection and accessible resource/rights UI; notices/attribution and fixtures.

## Security and persistence

Reuse shared locks, immutable theme storage, #170/#171 safety and restricted IPC.
Resource workers have no filesystem/network/process/dynamic-code authority and
their output is validated. Retain renderer sandbox/isolation/Node restrictions.
No raw font names/paths/CSS or remote URLs become capabilities. Never log author,
licence or manuscript payloads; keep project/destination bytes on failure.

## Automated acceptance tests

T01–T07/T11/T12: corrupt/truncated fonts and images, wrong-face/fstype/no-subset
fixtures, missing notices and conflicting per-target rights; parser timeout/memory
and worker output limits; unapproved CSP/network/file requests; exact glyph/semantic
inventories; role-font/ornament goldens; actual EPUB resource and PDF embedded-face
inspection; private-content canaries; stale render/import, atomic failure/restart,
snapshot/backup restore offline and Community-only build.

## Manual acceptance tests

Keyboard import/edit/fallback/cancel with approved redistributable test fonts and
artwork; inspect several EPUB readers and actual PDF proofs on supported platforms.
Record unsupported scripts/reader CSS and real resource-policy limitations. Verify
rights/notices for each test resource without making a product licensing decision.

## Dependencies and exclusions

Dependencies: merged #133, CT1 (#232), CT2 (#233); existing #113/#122/#126/#129/#130/#136 pipelines.
Exclude premium asset acquisition, final asset/commercial licences, font downloads/
system install, arbitrary SVG/CSS/HTML, executable plugins, narrative full bleed,
cover workflow, cloud and Pro infrastructure. Related to #133 and #203.
