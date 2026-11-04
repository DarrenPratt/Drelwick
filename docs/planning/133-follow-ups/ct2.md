# Implement secure local declarative theme package import and export

<!-- DRELWICK-133-CT2 -->

Tracking: [#233](https://github.com/DarrenPratt/Drelwick/issues/233); design owner #133.

## Objective and scope

Implement ThemePackageV1's bounded local archive gateway, identity/conflict handling,
quarantine, immutable installation and explicit atomic package export. Support
asset-free packages first; reject resource capabilities until CT3 (#234) is implemented.

## Classification and readiness

**Undecided — owner review after #203** (`product:undecided`). No existing CORE
publishing/backup functionality changes allocation. Backlog until #133 and CT1 (#232)
are merged and technical scope/readiness recorded. Private evaluation under #203
precedes final allocation; #203 is related, not a reverse dependency. No Pro or
commercial prerequisite is introduced for existing CORE functionality.

## Acceptance criteria

- Validate exact format/manifest/style/capability versions, canonical identity and
  complete references/inventory; future/unknown input survives refusal.
- Enforce source, entry, actual expansion, ratio, count, time and memory limits;
  reject traversal/encoded/drive/UNC/ADS/device/colliding paths, links, special files,
  bad records/flags/methods/CRC/length/hash, malformed UTF-8/JSON and hidden entries.
- Do not call extract-all. Never execute or auto-open package data, fetch resources,
  install a font system-wide, or apply a theme merely because import succeeded.
- Native-selected source and opaque candidate tokens bind frame/session, operation
  and exact source bytes. Recheck after dialogs and before publishing.
- Same ID/version/hash is idempotent; conflicting hash offers an explicit new-ID
  duplicate or cancel, preserving installed/source data and built-in definitions.
- Publish complete verified immutable data before reference selection using existing
  locked atomic protocols. Cancellation/failure cannot replace previous valid files.
- Export only captured theme/resources/notices after rights and destination review;
  preserve existing output on failure, exclude prose/private project/editorial data.
- Package/backup restore uses the same strict gateway and complete closure offline.
  Unsupported resource capabilities never produce a partially installed theme.

## Expected components

Model manifest/compatibility schemas; core bounded ZIP/JSON preflight, quarantine,
hash/inventory/rights policy, installation and atomic package output; shared DTOs;
desktop native dialogs, candidate preview/conflict/cancel; archive/restore adapters.
Reuse approved archive/parser patterns and atomic export primitives after audit.

## Security and persistence

Follow #133 ThemePackageV1's smaller ZIP profile and fixed diagnostic order/codes.
Use authorized regular files, owned staging, shared writer gate, stale hashes and
verified recovery; never overwrite known/unknown evidence. Preserve sandbox,
context isolation, disabled Node integration, restricted IPC and no manuscript/path
logging. No remote resources or arbitrary code/HTML/CSS. No Pro dependencies.

## Automated acceptance tests

T03–T07/T11/T12 with actual adversarial ZIP byte fixtures, not metadata-only mocks:
central/local conflicts, symlink/reparse flags, platform aliases, NUL/percent names,
duplicate keys, CRC/hash changes, encrypted/ZIP64/unknown methods, bombs and
understated DEFLATE output; deadlines/worker termination; stale/cross-frame tokens;
identity conflicts; every write failure/checkpoint; source/project/destination byte
canaries; deterministic export inventory; backup/restore without network or Pro.

## Manual acceptance tests

Offline keyboard import, inspect, install, explicitly apply, conflict/duplicate,
cancel and export/restore on supported OSs. Use a malicious archive, revoked file
access and a changed source; inspect that no files escape quarantine or replace
previous data. Explain fixed diagnostics without exposing private paths/content.

## Dependencies and exclusions

Dependencies: merged #133 and CT1 (#232); existing archive/atomic persistence and restricted
IPC. CT3 (#234) activates reviewed raster/font capabilities later; do not depend on CT3 (#234)
to safely reject them. Exclude resource parser/font runtime implementation, plugin
runtime, arbitrary CSS/HTML, marketplace/downloads/signing service, licensing or
visibility changes, Pro and advanced publishing. Related to #133 and #203.
