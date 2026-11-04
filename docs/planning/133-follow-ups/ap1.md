# Implement versioned local publisher-profile data and provenance contracts

<!-- DRELWICK-133-AP1 -->

Tracking: [#235](https://github.com/DarrenPratt/Drelwick/issues/235); design owner #133.

## Objective and scope

Provide one strict passive publisher-profile/measurement contract for the #133
hardcover and advanced preflight candidates, avoiding separate incompatible rule
models. Use synthetic profiles first; provider-specific instructions need recorded
source/version verification. This issue does not certify any publisher.

## Classification and readiness

**Undecided — owner review after #203** (`product:undecided`). Current Community
print configuration and basic preflight remain CORE. Backlog until #133 is merged,
technical scope approved and actual foundations verified. This is a private-app
candidate for #203 scope/deferral review, not a Pro allocation or automatic v1.0
requirement. Final allocation follows #203; #203 is not a reverse dependency.

## Acceptance criteria

- Strict independently versioned profile UUID/version/hash, provider/product/binding/
  stock identifiers, exact units, declared inputs, source provenance/date and review/
  expiry policy. Names/URLs are untrusted display data, never paths or auto-fetches.
- Finite declarative rule vocabulary over known measurements (trim/margins/gutter,
  page count, optional bleed/PPI/font/colour facts). Reject unknown executable
  expressions, arbitrary regex/selectors, scripts and unsupported capabilities.
- Distinguish pass/fail/not-verified/not-applicable. Missing inputs/unsupported
  measurement capabilities cannot produce Pass or guessed stock/binding values.
- Deterministic normalization and comparison without modifying print settings,
  manuscript or output. Existing Community findings cannot be suppressed.
- Pinned local profile persistence/import/restore uses schema/identity limits,
  authorization, expected hashes, shared lock and atomic writes; future/corrupt data
  remains recoverable. No external rule download or provider account is required.
- Document API dependencies for AP2 (#236)/AP3 (#237)/AP4 (#238) and explicit platform/profile limitations.

## Expected components

Project-model profile schema; shared unitful measurement/result DTOs; core pure
validation, hashes and safe local profile persistence; narrow main/preload adapters
only where user-selected import requires them. No new workspace or plugin SDK.

## Security and persistence

All profiles are untrusted passive JSON, bounded before decoding; no code, network,
filesystem grants or dynamic rule runtime. Reuse existing atomic/transaction gates,
stale handling and backup principles. Strict privileged frame/session/path checks;
context isolation/sandbox/disabled Node integration and no private payload logging.
No Pro dependency or legal/publisher-compliance guarantee.

## Automated acceptance tests

T04/T05/T06/T09/T10/T11/T12: schema/version/units/boundaries, invalid/missing inputs,
unknown capability results, deterministic rule order, duplicate identity/hash
conflicts, future fields, traversal/active expressions, cancellation, stale tokens,
fault/restart/backup, exact source-byte preservation and offline Community build.

## Manual acceptance tests

Review two independently specified synthetic publisher/binding/stock profiles and
unknown/expired cases; verify provenance is inspectable but not fetched. Have the
owner approve any later real provider's exact document/version before claiming its
coverage. Confirm manual Community printing still works with no profile installed.

## Dependencies and exclusions

Dependencies: merged #133 and actual #128/#130/#136 configuration/measurement APIs.
AP2 (#236)/AP3 (#237)/AP4 (#238) depend on this contract; it does not depend on those consumers or CT1 (#232)–CT3 (#234).
Exclude reports UI, geometry rendering, hardcover assistant, formal PDF conformance,
provider uploads, automatic updates, licensing changes and Pro. Related to #133/#203.
