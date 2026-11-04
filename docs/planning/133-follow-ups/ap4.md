# Add advanced local publisher-profile checks and privacy-safe reports

<!-- DRELWICK-133-AP4 -->

Tracking: [#238](https://github.com/DarrenPratt/Drelwick/issues/238); design owner #133.

## Objective and scope

Implement bounded read-only checks and reports over AP1 (#235)'s pinned publisher profiles
and exact captured PDF/print measurements. Extend existing Community findings;
never suppress or make basic publishing depend on this optional advanced review.

## Classification and readiness

**Undecided — owner review after #203** (`product:undecided`). Existing CORE
geometry/resource/overflow/font-embedding/basic preflight remains unchanged.
Backlog until #133/AP1 (#235) are merged, actual inspection APIs verified and technical
scope approved. #203 evaluates approved implementation/deferrals before allocation;
there is no Pro prerequisite, reverse dependency or automatic certification claim.

## Acceptance criteria

- Finite supported checks over exact profile inputs/measurements: trim, page counts,
  margins/safe areas, effective image PPI, embedded face/program facts and declared
  rights status. Add colour/bleed observations only where an independently reviewed
  inspector can establish them; no fabricated measurement or inferred permission.
- Missing inputs, unknown/expired profiles and unsupported inspectors return
  not-verified/not-applicable, never Pass. Mandatory unknowns prevent an advanced
  profile-pass claim, without globally disabling ordinary Community export.
- Bind findings/acknowledgements to source generation/output hash, target/edition,
  profile ID/version/hash and inspector/tool versions. Changed data invalidates
  results; deterministic ordering and complete bounded cancellation are required.
- Reports contain fixed codes, severity, safe page/chapter/asset locators, units,
  actual/expected values and remediation. Exclude private editorial/reference/theme
  claims and prose by default; explicitly review any optional excerpt export.
- Existing Community errors cannot be hidden by profile/theme/paid capability.
  No automatic manuscript repair, font substitution, box relabelling, colour
  conversion or silent source/output rewrite.
- Accessible findings navigation/review/export uses the existing captured PDF and
  native atomic destination flow, preserving prior files on failure/cancel.
- No PDF/X/UA, licence-compliance or publisher-upload guarantee without separately
  approved independent conformance validation and evidence.

## Expected components

AP1 (#235) schemas/measurement contracts; core pure check orchestration and report identity;
main bounded PDF/resource inspectors; shared findings/report DTOs; desktop review/
navigation and explicit report export; existing atomic output and preflight APIs.

## Security and persistence

No remote profile updates, executable rule engine, arbitrary regex/CSS/selectors,
filesystem grants or cloud service. Authorize native input/output and frame/session
tokens; bound parser/time/memory/output. Preserve source/previous reports and
existing writer/recovery architecture. Keep Electron isolation/sandbox/Node
restrictions, privacy-safe fixed diagnostics and Community-only dependency direction.

## Automated acceptance tests

T01/T04/T05/T07/T08/T10/T11/T12: synthetic profile failures, exact measurements and
unknown results; embedded/no-embedding/no-subset fonts, crop-aware PPI, unverified
rights, malformed/encrypted PDFs, absent inspector capabilities, stale profiles/
source/output, deterministic findings, timeout/worker termination, private-content
canaries, atomic report failures and ordinary offline publishing with no profile.

## Manual acceptance tests

Inspect real PDF proofs with a source-verified profile and independently review the
reported measurements. Keyboard navigation, warning review and private excerpt/
report export must be explicit. Record Windows/macOS/Linux tool limits and
publisher-specific unknowns; a green local report is not acceptance by a publisher.

## Dependencies and exclusions

Dependencies: merged #133/AP1 (#235) and implemented #129/#130. AP2 (#236)'s reviewed geometry
capability is required **only** before claiming its bleed/spread checks; otherwise
report unsupported. No reverse AP2 (#236)/AP3 (#237) or custom-theme dependency. Exclude formal
conformance certification, colour conversion, uploads, licence/Pro decisions,
marketplace/runtime and content modification. Related to #133 and #203.
