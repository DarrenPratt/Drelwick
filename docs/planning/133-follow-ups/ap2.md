# Prototype full-bleed and spread image composition with verified PDF geometry

<!-- DRELWICK-133-AP2 -->

Tracking: [#236](https://github.com/DarrenPratt/Drelwick/issues/236); design owner #133.

## Objective and scope

Implement a bounded synthetic prototype through the existing production print/PDF
pipeline to prove or reject #133's full-bleed/facing-page approach. Record a reviewed
go/no-go and the stable image-occurrence/geometry contract needed before shipping.
This prototype is not a production manuscript-format migration or new baseline.

## Classification and readiness

**Undecided — owner review after #203** (`product:undecided`). Existing manual
Community image/print output remains CORE. Backlog until #133/AP1 (#235) and actual image/
print foundations are verified and prototype scope approved. #203 evaluates its
evidence and any explicit deferral before final allocation; no Pro dependency or
reverse #203 dependency. A go result does not automatically authorize shipping.

## Acceptance criteria

- Capture synthetic original images and explicit unitful geometry; compose actual
  painting/clipping into separately verified MediaBox/TrimBox/BleedBox/CropBox.
  Merely changing PDF box metadata cannot pass.
- Demonstrate one full-bleed page and a single logical image split across two
  physical pages with correct recto/verso, seam/gutter, safe area and crop controls.
  Double-width sheets are a distinct profile, never an implicit spread.
- Preserve original pixels/alt text/reading order; calculate effective per-axis PPI
  after cropping/scaling, not from EXIF or upscaled dimensions.
- PDF-backed preview uses final composition bytes with trim/bleed inspection;
  export/stale validation remains the existing atomic source-bound workflow.
- Reflowable EPUB remains a single semantic image; do not silently create fixed
  layout or duplicate narrative text/alt text.
- Record the stable occurrence identity/migration decision for repeated asset uses
  and revision/chapter operations. No offset/title/asset-ID guessing is permitted.
- Record measured go/no-go, limitations and required production follow-up scope.
  If bounds/geometry cannot be proved, retain the prototype evidence and keep the
  feature unavailable; do not weaken current inspection to close the issue.

## Expected components

Core synthetic capture/placement planning and profile inputs; shared geometry DTOs;
renderer/desktop existing print surface/composition/inspection; test-only fixtures,
PDF artifacts and a feasibility report. No alternative semantic renderer.

## Security and persistence

Bound image dimensions/bytes/pages/time; reuse image validation and isolated offline
print sessions. Use temporary owned inputs and existing atomic output validation;
never mutate an author's project as a prototype. Preserve previous output on faults.
Keep restricted IPC, sandbox/isolation/disabled Node integration, no remote resources,
private-content logging, new journals or Pro dependency.

## Automated acceptance tests

T03/T04/T05/T08/T11/T12: single/spread/blank/recto cases, nonzero box origins and
containment, actual clipping/pixel seam, repeated occurrences, low PPI, transparency/
rotation/missing originals, maximum-resource failures, cancellation/stale capture,
all page boxes, exact preview/export bytes and unchanged EPUB semantics. Inspect
artifacts independently; mocks alone do not establish bleed correctness.

## Manual acceptance tests

Inspect facing/single-page trim and bleed overlays, print/crop and physical bound
proofs on supported platforms. Verify a reflowable reader's one-image/alt-text
behaviour. Record provider-specific requirements and unknowns without an acceptance
guarantee. Review the go/no-go and occurrence identity with the owner.

## Dependencies and exclusions

Dependencies: merged #133/AP1 (#235), implemented #113/#112/#129/#130; #170/#171 mapping/
snapshot requirements inform any later production design. No CT1 (#232)–CT3 (#234) dependency.
Exclude shipping migration/enablement, imposition, fixed-layout EPUB, cover generation,
CMYK/PDF-X conversion, cloud, licensing or Pro. Related to #133 and #203.
