# Branding and distribution review for #59

Reviewed 29 September 2026 against Community main `4b514a7` and current GitHub
issue/PR records. Classification: CORE. This is evidence for the
[proposed policy](../branding-distribution-policy.md), not legal approval.

**Legal review: pending.** #59 must remain open. #60's branding gate is
documentationally prepared, awaiting professional review and owner approval of
unresolved permissions. No source licence, repository visibility, artwork,
application identity, signing setup or packaging implementation changes here.

## Decisions and dependencies checked

| Record                                                                                                                   | Current evidence and consequence                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#59](https://github.com/DarrenPratt/Drelwick/issues/59)                                                                 | Open; no original prerequisite specified. Requires strategy, fork expectations, official-build definition and appropriate legal review. Documentation can proceed; closure cannot.                                                                                       |
| [#53](https://github.com/DarrenPratt/Drelwick/issues/53)                                                                 | Open; owner selected AGPL-3.0-only, with final approval/legal review pending. No root LICENSE exists in the reviewed tree. Branding does not amend or grant a source licence.                                                                                            |
| [#55](https://github.com/DarrenPratt/Drelwick/issues/55) / [PR #196](https://github.com/DarrenPratt/Drelwick/pull/196)   | Issue now closed; PR merged. Its original PR description retained an unresolved #52 prerequisite at that time. Current issue state takes precedence. Actual Community boundary is enforced; no Pro dependency is introduced here.                                        |
| [#58](https://github.com/DarrenPratt/Drelwick/issues/58) / [PR #198](https://github.com/DarrenPratt/Drelwick/pull/198)   | Closed/merged; implemented public format, versions and recovery documented. Compatibility wording must remain available to independent tools.                                                                                                                            |
| [#57](https://github.com/DarrenPratt/Drelwick/issues/57)                                                                 | Closed design issue. Extension architecture exists; public SDK/runtime implementation does not. Compatibility statements must not advertise an unavailable API.                                                                                                          |
| [#60](https://github.com/DarrenPratt/Drelwick/issues/60)                                                                 | Open. Owner decisions dated 28 September distinguish intended licence, branding, artwork review, contacts, metadata/privacy review and explicit publication authority. No formal trademark/artwork review has occurred.                                                  |
| [#51](https://github.com/DarrenPratt/Drelwick/issues/51)                                                                 | Open. Existing Windows source-launch evidence is not installer validation; owner release signoff and packaged-platform evidence remain separate.                                                                                                                         |
| [#107](https://github.com/DarrenPratt/Drelwick/issues/107)                                                               | Open. Owns Electron Builder, explicit app ID/product/version/output configuration, Windows portable/NSIS, macOS DMG and Linux AppImage/deb, packaging documentation and artifact validation. It deliberately defers official-brand/signing/publication decisions to #59. |
| [#175](https://github.com/DarrenPratt/Drelwick/issues/175) / [PR #176](https://github.com/DarrenPratt/Drelwick/pull/176) | Historical closed/merged BookEditor-to-SAREL rename. Later Drelwick rename supersedes its compatibility identity choices; it is not current naming guidance. Preserve the historical record.                                                                             |

Read the repository instructions, README, documentation index, design, technical
specification, development workflow, v0.1 build plan, commercial addendum,
repository audit, tracking register, release checklist, release-validation guide,
public format and extension architecture alongside these records. Planning task
58 maps to actual issue #59; planning task 59 maps to actual issue #60.

## Asset inventory

| Tracked asset                                                                                  | Observed role                                                                                                                                                                                                  | Licence/reuse status                                                                                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`apps/desktop/assets/branding/app-logo.png`](../../apps/desktop/assets/branding/app-logo.png) | Original supplied 1254 × 1254 PNG; blue book/quill-style logo, source of the official project visual identity.                                                                                                 | No asset-specific grant or root repository licence found. Artwork ownership, clearance and reuse permissions pending. |
| [`apps/desktop/assets/icons/app.png`](../../apps/desktop/assets/icons/app.png)                 | Generated 512 × 512 desktop icon; running window/Dock use according to the assets guide.                                                                                                                       | Derived branding asset; generation does not establish new reuse permissions. Same pending review.                     |
| [`apps/desktop/assets/icons/app.ico`](../../apps/desktop/assets/icons/app.ico)                 | Generated Windows icon with 16, 24, 32, 48, 64, 128 and 256 pixel PNG frames. Running application identity; intended later executable/installer asset.                                                         | Derived branding asset; same pending review.                                                                          |
| `docs/screenshots/*.png` (ten files)                                                           | Product documentation screenshots: authoring workspace, book preview, three themes, chapter history, three ebook layouts and offline spelling. May depict application identity; not independent logo variants. | No separate screenshot reuse grant established. Include in #60's bundled-artwork/public-documentation review.         |

The tracked synthetic image under `tests/fixtures/public-example/assets/images/`
is manuscript/example content, not official product branding. No separate website
logo, favicon, vector logo, Pro/Community logo variant or macOS ICNS is present in
the tracked image inventory. A provider icon embedded inside provenance metadata
is not Drelwick branding. No external website asset inventory is claimed.

[`scripts/generate-app-icons.cjs`](../../scripts/generate-app-icons.cjs) uses the
pinned Electron image tooling to derive the PNG and ICO without cropping the
design. [`apps/desktop/assets/README.md`](../../apps/desktop/assets/README.md)
documents runtime use and deferred installer packaging. The supplied source was
added by commit `1bba310`; this change preserves all three binary files exactly.
Descriptions of “official branding” identify project usage, not proven legal
title or permission for unrestricted reuse.

## Provenance and #60 privacy handoff

The source PNG contains a 23,654-byte `caBX` chunk with C2PA provenance. A limited
PNG-chunk and readable-string inspection found ChatGPT/gpt-image and OpenAI Media
Service identifiers, creation/conversion/watermark records, timestamps, instance
identifiers and public certificate/timestamp material. Readable URL references
were to standards or public certificate infrastructure (W3C, IPTC and SSL.com),
not a configured Drelwick download channel. This content signature is not
Drelwick application code signing or evidence of artwork ownership/clearance.

That limited inspection found no obvious email address, private URL or credential.
It is **not** a complete C2PA decode, cryptographic validation, secret scan or
privacy signoff. #60 must verify the full payload, identifiers and certificates
for sensitive information before public release, together with history and other
assets. Any discovered sensitive value should be handled privately, without
copying it into public documentation. Do not remove metadata merely because it
identifies ChatGPT. The generated PNG has only IHDR/IDAT/IEND chunks; no change
to the icon-generation process or provenance is made here.

## Current names and historical references

The root package is `drelwick`. The six Community workspace packages are
`@drelwick/desktop`, `@drelwick/core`, `@drelwick/project-model`,
`@drelwick/renderer`, `@drelwick/shared` and `@drelwick/workspace-smoke`.
The desktop manifest's `productName` and Electron `setName` are `Drelwick`;
the default profile is `appData/@drelwick/desktop`, with an explicit
`--user-data-dir` override. These are current Community application identities,
not evidence of a Pro package or an official binary release. Packaging app ID
and target configuration remain #107 work.

Tracked source/docs searches for BookEditor, book-editor and SAREL found no
incorrect current application branding. `docs/chapter-history.md` and
`docs/planning/issue-118-acceptance.md` retain legitimate rename/issue history.
The tracking register records the 24 September Drelwick rename; commit `5afad70`
and current code supersede the earlier SAREL settings/identifier decisions.
Do not restore legacy names or rewrite old GitHub discussions/Git history.

Earlier “candidate licence” wording remains in AGENTS.md, the design and dated
planning/audit documents. README and technical-spec section 3.1 already clarify
the owner's newer AGPL-3.0-only selection with legal approval pending. This policy
uses the newer decision; #53/#60 own central licensing reconciliation. No current
registered-trademark assertion, unrestricted artwork grant or implemented release
signing claim was found. The assets guide previously explained use without
explaining rights; its new policy link addresses that omission.

## Distribution evidence and responsibility

GitHub Releases and the repository tags API returned empty lists at review time.
The tracked CI workflow runs quality checks on PRs and main; it does not package,
sign or publish releases. Desktop scripts build/launch Electron and generate
icons, with no Electron Builder dependency or package command. No approved
website download endpoint, store listing, signing identity, release checksum
manifest, attestation or reproducible-binary verification is established by the
reviewed repository. This is a repository finding, not a claim about every
external owner account or credential.

The proposed initial channel is owner-designated releases in the existing GitHub
repository after separate release approval. Future website/store channels need
recorded owner control or authorisation. #107 owns packaging implementation;
#51 owns packaged release validation; #60 owns publication readiness, actual
dependency redistribution review, configured contacts and the separate owner
release decision. No packaging mismatch requires a runtime change for #59.

## Acceptance and remaining blockers

- Documented the proposed trademark strategy without registration or clearance
  claims; domain/brand control and incomplete UK registration are owner reports.
- Documented fork, commercial fork and independent-rebuild expectations without
  restricting source-licence rights or removing required attribution.
- Defined official source/binary/development releases, mirrors, authorised
  distributors, signing and publication channels separately.
- Reviewed all eight [distribution scenarios](../branding-distribution-policy.md#scenario-review),
  including project-format tools, future plugins, Pro and unauthorised store listings.
- Preserved artwork/provenance, Community independence and #107's scope.
- **Outstanding #59 closure criterion:** appropriate professional legal review,
  resulting wording corrections and recorded final owner approval. No evidence
  of that review exists. Do not close #59 when this draft merges.
- **Owner decisions needed:** reviewed artwork rights/reuse terms, including
  exact mirrors; final branding exceptions/permissions and trademark strategy.
  No registration filing or symbol adoption is presumed.
- **Before public distribution under #60:** record cleared artwork and legal
  gates, configured contacts/channels and actual signing/release evidence as
  applicable. Passing technical checks cannot clear these decisions.

## Verification

Local verification on 29 September 2026 used Windows, Node 24.20.0 and pnpm
10.34.5 with the existing dependency installation:

- Passed lint, format check, typecheck, unit tests (80 files, 938 tests), build
  and workspace smoke check. The workspace check also passed all 20 architecture
  regression tests and the actual Community dependency scan.
- All 96 local file links across the seven changed documents resolve.
- The three branding binaries are byte-identical to HEAD; the policy contains
  no registered-trademark symbol. Tracked diff whitespace check passed.
- Frozen-lockfile install was attempted but did not complete: the environment
  could not fetch registry metadata, and pnpm aborted proposed modules-directory
  replacement without a TTY. An offline attempt also aborted. Existing modules
  remained usable; this is not evidence of a fresh reproducible install.
- The existing Vite renderer chunk-size advisory remains. No runtime, packaging
  or source changes were made; new tests, E2E, coverage and installer/platform
  validation are not applicable to this documentation change and were not run.

Final legal/owner review, fresh-install verification and hosted CI remain separate
from these local results. Passing checks does not complete #59 or #60.
