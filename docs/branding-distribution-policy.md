# Drelwick branding and official distribution policy

**Status: proposed policy for owner and professional review.**\
**Legal review: pending**\
**Classification: CORE.** Prepared for [#59](https://github.com/DarrenPratt/Drelwick/issues/59)
on 29 September 2026. This draft records the owner's direction; it does not grant
an artwork licence, establish trademark registration or authorise public release.
The [repository review](planning/59-branding-review.md) records evidence, current
assets and unresolved gates for #60.

## Purpose and scope

Prevent confusion about who publishes and supports a product while supporting
legitimate open-source forks, commercial use and redistribution. This policy
addresses product names, logos, application identity, release descriptions,
websites, store listings and claims of endorsement. It applies independently of
whether the software is Community or Pro.

## Source-code rights and branding rights

> The Drelwick Community source licence governs rights in the source code.

> The Drelwick branding/trademark policy governs use of Drelwick names, logos and
> representations of official status.

These are separate questions. This policy does not amend the Community source
licence or add conditions to exercising its rights. A person may fork, modify,
redistribute or commercially use source to the extent its applicable licence
permits, even when the resulting product must use distinct branding. Conversely,
source rights do not automatically confer permission to suggest Drelwick
endorsement or official status.

Keep truthful attribution and required copyright, licence and source notices.
Rebranding does not require erasing upstream history, removing required notices
or changing interoperable file-format identifiers. Nothing here purports to
restrict descriptive use allowed by applicable law. Final wording and its
interaction with the source licence require legal review.

The owner selected **AGPL-3.0-only** as the intended Community licence in
[#53](https://github.com/DarrenPratt/Drelwick/issues/53) and
[#60](https://github.com/DarrenPratt/Drelwick/issues/60). Final licensing approval
and legal review remain pending, and the reviewed tree has no root LICENSE.
This document is not itself a source-code licence grant. References below to
licensed redistribution describe the intended public model, subject to the
licence actually applying to the material, including dependencies.

## Names and proposed trademark strategy

| Name               | Intended relationship                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Drelwick           | Umbrella project and product identity; also the current desktop display name.                          |
| Drelwick Community | The open-source Community product, intended to use AGPL-3.0-only after the outstanding licensing gate. |
| Drelwick Pro       | The intended proprietary/commercial product line, separately licensed and developed.                   |

The proposed strategy is to retain these names for project-controlled products,
use distinct primary branding for third-party distributions, and allow truthful
references to origin and compatibility. Seek professional advice on name
clearance, protectability, the proper rights holder, relevant territories and
goods/services, and whether to pursue UK registration of the name, product-line
names and/or logo. No filing is authorised or performed by this document.

The owner reports owning/controlling the Drelwick domain and brand. That report
does not establish legal exclusivity or clearance. The owner reports that the UK
IPO registration process **has not been completed**. No registration evidence,
application number or confirmed filing stage is recorded here; do not describe
an application as filed or pending examination without evidence. Do not describe
Drelwick as a registered trademark or use the registered-trademark symbol.

This draft uses plain names. It does not propose adding a trademark symbol to
the application. Any future use of the unregistered trademark symbol would be
an assertion of a claim, not registration evidence; its appropriateness needs
professional review. The [UK IPO registration guidance](https://www.gov.uk/how-to-register-a-trade-mark)
describes the registration process; it is not evidence of a Drelwick registration.

## Logos and visual identity

The current project branding is the supplied blue book/quill-style Drelwick
logo and its generated desktop icons. The exact files, uses and metadata are
listed in the [asset inventory](planning/59-branding-review.md#asset-inventory).
No separate website artwork, Community/Pro logo variants or macOS bundle icon
were found in the reviewed tree. Documentation screenshots depict the product;
they are not a separate library of licensed branding assets.

The owner reports that the logo was generated using ChatGPT, consistent with
its embedded provenance metadata. Tool origin does not establish copyright
ownership, trademark clearance or reuse permissions. No repository-wide artwork
licence or asset-specific reuse grant is established in the reviewed tree.
**Artwork rights and reuse permissions: pending.** Do not infer unrestricted
logo use from a future AGPL source licence or from access to the files.

The intended artwork permission should be reviewed separately, including use
inside authentic mirrored artifacts and truthful identification of the original
project. Until settled, this draft does not grant those artwork permissions.
This uncertainty is an artwork/public-release gate, not a prohibition on
exercising rights already granted in source code. Preserve the original asset
and provenance; #60 must assess any sensitive metadata separately.

## Truthful descriptive use

The proposed policy permits truthful references such as:

- “Based on Drelwick.”
- “Forked from Drelwick Community.”
- “Compatible with the Drelwick project format.”
- “An independently developed plugin for Drelwick Community.”

Use these as explanatory statements alongside the third party's own identity.
Identify the actual publisher and avoid implying endorsement, certification,
official support or project ownership. Do not use the logo as a third party's
application identity. No individual branding approval should be needed for
ordinary truthful text references meeting these principles; this proposed
permission remains subject to final legal wording and does not narrow lawful
descriptive/nominative use.

## Forks, modifications and independent rebuilds

A materially modified distribution or fork should normally use a distinct
product name and distinct primary visual branding. It must not call itself an
official Drelwick release or use the Drelwick logo as its own application identity.
Where Drelwick is referenced, clearly state the relationship and publisher, for
example: “Example Writer, a fork of Drelwick Community, independently maintained
by Example Publisher. Not an official Drelwick release.”

This applies equally to commercial and noncommercial forks. Charging for a
lawfully distributed fork is not prohibited by this branding policy. Source and
dependency licence obligations remain separate and must still be met.

An independently compiled binary is a **third-party rebuild**, even if it uses
an unchanged official source tag. For public distribution, the proposed default
is the rebuilder's distinct primary product identity and icon, with a description
such as “Independent Community build from Drelwick source at commit …, built
and distributed by …; not an official Drelwick build.” Retaining Drelwick as its
primary binary identity would require a separately settled branding permission;
matching source alone is insufficient. Branding-only adaptations do not turn
the artifact into an exact mirror. Private local builds need not be renamed
merely to run them; they must not be presented to others as official artifacts.

Change application-facing names, icons and publisher metadata where necessary
to avoid confusion, while preserving required attribution and compatibility.
Do not rename persistent format keys just because they contain “drelwick”.
Independent publishers should also avoid colliding with official application
identifiers, update channels and user-data locations; platform-specific packaging
guidance belongs to #107, not a new source-licence condition here.

## Exact, unmodified redistribution

The proposed policy permits an exact, authentic official Community artifact to
retain its original embedded product identification when mirrored, subject to
settling the artwork permission before public release and complying with the
applicable source/dependency licences. Do not alter bytes, signatures or embedded
notices, or add an installer wrapper and describe it as the same artifact.

Identify the service as an **independent mirror** and link to the original
project release, version and published integrity information. For example:
“Independent mirror of the unchanged official Drelwick Community release …;
originally published by Drelwick. This mirror is operated by … and is not an
official Drelwick distribution channel.” Verify the artifact against the
project's published checksum/signature when available; do not claim a check
occurred when it did not. If authenticity cannot be established, do not claim
to mirror an authentic official artifact.

The artifact's origin can remain official without the mirror or its operator
becoming official or endorsed. Repackaging, patching, rebuilding or signing the
binary again changes the artifact and follows the third-party rules above.
Mirroring does not waive corresponding-source or notice obligations under the
applicable licence.

## Official build and release definition

**An official Drelwick build is an artifact published by the Drelwick project
owner through an approved Drelwick distribution channel, or an artifact explicitly
authorised by the project owner as official.** The current project owner and
publication authority is Darren Pratt. Mere access to a repository, a successful
build, a matching hash of source, or possession of a signing certificate is not
such authorisation.

| Term                         | Meaning                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official source release      | A specific source revision/archive deliberately designated and published by the owner as a source release. Ordinary branches, commits and automatically available source archives are not all releases. |
| Official binary              | The exact executable/package artifact meeting the official-build definition, with its platform, version and release status recorded.                                                                    |
| Third-party rebuild          | Independently produced artifact from upstream source; not automatically official, even if reproducibly identical. Explicit owner authorisation can establish official status.                           |
| Fork                         | A separately maintained/modified product using source under its applicable licence; distinct branding and truthful attribution.                                                                         |
| Development/nightly artifact | A development build, not a stable production release. It may be designated an official development build only by the same owner-authorisation rule, with its limitations clearly labelled.              |
| Authorised distributor       | A possible future operator with explicit recorded owner authorisation for specified artifacts/channels. No such appointment is established here. A mirror is not automatically one.                     |

Authorisation should identify the artifact or bounded release process, publisher,
channel and status, so users can verify the claim. An official designation is
not a guarantee of stability, security, legal clearance or completed validation.
Production release approval must also satisfy #51 and #60.

## Release channels

The intended initial official channel is the owner's existing
[Drelwick GitHub repository](https://github.com/DarrenPratt/Drelwick) and its
[GitHub Releases](https://github.com/DarrenPratt/Drelwick/releases), once public
release is separately authorised. The repository is currently private; the
review found no releases or tags. Creating this policy does not publish it.
Only owner-designated releases/artifacts qualify. PR builds and ordinary CI
artifacts are validation outputs, not automatically official public releases,
even when produced by workflows in this repository.

The owner's official Drelwick website/domain may later distribute owner-published
or explicitly authorised binaries, or link to official GitHub releases. Record
the actual approved domain/download location when configured; this policy does
not invent a deployed URL. A domain name containing Drelwick, or a link to source,
does not by itself make a download official.

## Packaging, signing and provenance

**Packaged**, **signed** and **official** are separate properties:

- Packaged means assembled into an application bundle, installer or portable
  executable. #107 owns Electron Builder implementation and platform targets.
- Signed means an artifact has a signature attributable to a signing identity
  under the applicable verification process. A third party's certificate does
  not establish Drelwick authorisation.
- Official means owner publication/authorisation under the definition above.
  Signing alone cannot confer it, and policy alone cannot produce a signature.

The future expectation is to sign official production binaries using credentials
controlled by the Drelwick project, with platform verification/notarisation where
required. The owner must approve the signing/publisher identities, secure release
access and platform requirements before production publication. Any unsigned
exception needs an explicit owner decision and clear disclosure; local unsigned
packaging and validation remain possible. No certificates, identities, secrets,
signing infrastructure or notarisation results are established by this policy.

Release work should link each artifact to its version, edition, source commit
and tag, build workflow/toolchain, platform, publisher, approval and release notes.
Publish cryptographic checksums through the approved channel; add signature
verification instructions and build provenance/attestations as implemented.
Protect tags and release publication authority. Reproducible builds are desirable
where practical and can support independent comparison; they are not proof of
owner authorisation. A checksum without a trusted publication path is not proof
of an official source.

The repository currently has pinned build tools and quality-check CI, not a
release/signing pipeline. No release checksum manifests, attestations or
reproducible-binary guarantee were found. #107 implements packaging; #51 validates
the resulting artifacts; #60 retains public-release approval and dependency
redistribution review. Later release work must implement and verify these
mechanisms rather than describe planned controls as operational. Never commit
private keys, signing certificates, store/domain credentials or release tokens.

## App stores and package repositories

An official Microsoft Store listing, macOS distribution/App Store listing if
later supported, or Linux repository/package-store listing must be controlled
by Drelwick or explicitly authorised by the project owner. Record the exact
listing, publisher account and permitted scope of authorisation in release
guidance when established. No store accounts, listings or authorised distributors
are created or claimed here.

An independently uploaded rebuild or fork is not the official Drelwick app.
Store acceptance, third-party signing, charging a price and matching upstream
source do not change that. Its name, icon, publisher and description must avoid
implying Drelwick control or endorsement. Even a byte-identical mirror does not
make the store listing official; embedded artifact identification is distinct
from permission to present the listing itself as Drelwick's storefront.

## Community, Pro, extensions and project-format compatibility

| Product            | Code/licensing relationship                                             | Branding relationship                                                                            |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Drelwick Community | Open-source product under the intended Community licence once approved. | Official branding on project distributions, subject to settled artwork rights and release gates. |
| Drelwick Pro       | Intended separate proprietary/commercial product.                       | Same official-status test; Pro branding does not change Community rights.                        |
| Third-party fork   | Source rights and obligations follow the applicable Community licence.  | Distinct primary branding, truthful attribution, no implied official status.                     |

Pro ownership or purchase is never a prerequisite to using Community. Preserve
the [Community/Pro boundary](technical-spec.md#31-community--pro-dependency-boundary):
Pro may depend on Community; Community must operate independently of Pro. This
policy adds no Pro capability, plugin licensing exception or proprietary
relicensing permission.

Third-party plugins may truthfully describe compatibility and their independent
publisher, without presenting themselves as “official Drelwick plugins”. An
official-plugin designation requires explicit project authorisation. The
[#57 extension architecture](extension-architecture.md) is a design; no available
SDK/runtime or certification programme should be inferred. Claims must identify
the actually supported API/version when implementation exists. Plugin source
licensing remains subject to #53's separate review.

A third-party tool may truthfully say “Compatible with the Drelwick project
format”, stating supported versions, operations and limitations. Reading/writing
the [public format](project-format-specification.md) must not depend on obtaining
official branding or certification. Compatibility does not make an application
Drelwick, imply endorsement or grant logo rights. Preserve required format
identifiers and truthful attribution; reasonable trademark/attribution wording
remains subject to legal review, not an interoperability permission gate.

## Scenario review

These are proposed outcomes, not a claim that artwork/legal gates are cleared.

| Scenario                                           | Outcome and suitable presentation                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Exact official Community installer mirror       | Retain embedded identity once the mirror/artwork permission is settled. Verify unchanged bytes against published evidence, preserve licence obligations, identify the independent mirror and original release. Artifact origin is official; mirror status is not. |
| 2. Independent build of unchanged Community source | Permitted by the applicable source licence. Identify the rebuilder and source revision, use distinct primary public-distribution identity by default, and state “not an official Drelwick build”. No automatic logo permission.                                   |
| 3. Modified Community fork                         | Distribute under the applicable source licence with distinct name/icon, preserve required notices, and say “forked from Drelwick Community” if useful. Do not imply official status.                                                                              |
| 4. Commercial fork                                 | Same branding treatment as a noncommercial fork. Commercial source use is not prohibited by this policy; satisfy the applicable licence.                                                                                                                          |
| 5. Compatible third-party tool                     | Use its own name and “Compatible with the Drelwick project format”, qualified by tested versions/operations. No endorsement, certification or logo grant implied.                                                                                                 |
| 6. Third-party plugin                              | Use its own name/publisher and truthful supported-API compatibility wording once that API exists. Neither an “official plugin” nor automatically exempt from source-licence obligations.                                                                          |
| 7. Drelwick Pro                                    | Project-authorised Pro uses official product-line branding after applicable rights/release review; its commercial licence does not curtail Community rights or make Pro required.                                                                                 |
| 8. Unauthorised store listing                      | A fork/rebuild cannot use official presentation merely because a store accepts it. Use distinct product identity and publisher disclosure; obtain explicit owner authorisation before claiming an official listing.                                               |

## Contact and proportionate handling of concerns

For non-sensitive questions, proposed branding exceptions or confusing listings,
contact the maintainer through the existing repository's issue channel where
access is available. Identify the distribution and the wording at issue. Darren
Pratt is the current decision maker; repository access is private at this stage.
#60 must configure and test a public Drelwick-domain contact route before public
launch. No working brand/legal mailbox or private reporting channel is claimed
here; do not post credentials or private personal information in an issue.

Prefer clarification and an opportunity to correct confusing naming, artwork
or official-status claims. Obtain appropriate advice before legal enforcement
or store complaints. Do not assert unverified registrations, ownership or
exclusivity, and do not use branding concerns to deny lawful source-code rights.
Record any granted exception's scope; it must not silently imply wider approval.

## Legal review and release gate

**Legal review: pending.** No professional trademark/artwork approval evidence
was found; #60 explicitly records that none has occurred. Required review covers
name clearance/protectability, Community/Pro naming, rights holder and trademark
strategy, logo/artwork ownership and permissions, descriptive/nominative use,
fork and rebuild branding, exact mirroring, official-status claims, app-store
treatment, interaction with AGPL/source rights and jurisdiction-specific wording.

The owner must settle the artwork permission (including authentic mirrors),
approve final policy wording after review, decide any registration/symbol strategy,
and record advice/approval evidence with date, scope and reviewer. Later channel,
contact and signing choices need concrete verification before those channels
launch. Registration itself is not made a prerequisite to drafting this policy.

For #60 the status is **documentationally prepared, awaiting legal review and
owner approval of unresolved permissions**. #59 remains open because its legal
review acceptance criterion is unsatisfied. Passing checks or merging this draft
does not clear that gate, approve distribution or change repository visibility.
See the [public-release checklist](planning/public-release-checklist.md).

## Revision history

| Date       | Revision                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-29 | Initial #59 draft based on main `4b514a7`, current issue decisions and owner-supplied brand/registration facts. Professional review and final permissions pending. |
