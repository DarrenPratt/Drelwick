# Contributor agreement and copyright strategy

Status on 29 September 2026: **proposed strategy; legal review: pending**.
CORE (`product:core`). Related to [#54](https://github.com/DarrenPratt/Drelwick/issues/54).

**DO NOT ACCEPT EXTERNAL CONTRIBUTIONS until #54 is complete.** The broader
Licensing & Commercial Architecture milestone gate in [development](development.md)
also remains. Documentation preparation does not establish an approved agreement
or open either gate.

## Purpose and readiness

Preserve the ability to accept contributions without unintentionally losing the
intended future commercial/dual-licensing capability. This record separates owner
intent from rights actually obtained and professional legal approval.

The first framework was delivered by [PR #195](https://github.com/DarrenPratt/Drelwick/pull/195).
At the follow-up base `fdaf5d500e9a43dc07adee749aaeb06a04d3cb18`, CONTRIBUTING.md
and the CLA requirements brief exist; a root LICENSE, approved CLA and operational
acceptance mechanism do not. Live [#53](https://github.com/DarrenPratt/Drelwick/issues/53),
rechecked on 29 September 2026, records **AGPL-3.0-only as the owner's intended
selection**, with legal review and final licensing approval pending; it is open.
No evidence of professional review was found in the reviewed repository or issues.
This work is expressly authorised preparation despite that unresolved dependency,
not a declaration that #54 is ready for final approval.

## Owner/project decisions

- Use **contributors retain copyright + CLA + DCO 1.1 sign-off**. Copyright
  assignment is not the preferred model. Authors cannot grant rights belonging
  to an employer, joint owner or other third party without authority.
- The intended central notice is **Copyright © 2026 Darren Pratt and Drelwick
  contributors.** This collective notice does not transfer ownership. Prefer
  repository-level notices, with SPDX identifiers where appropriate; do not require
  full boilerplate headers in every file or replace third-party notices.
- Community's intended licence is `AGPL-3.0-only`, without automatic adoption of
  later AGPL versions. Pro is separately developed proprietary/commercial
  functionality. Preserve the documented `Pro -> Community` dependency direction,
  independent Community builds and existing feature boundaries.
- Seek sufficient additional rights through reviewed CLA terms to use, modify,
  distribute and, where legally appropriate, commercially relicense accepted
  contributions. Submission, a sign-off or a maintainer merge is not evidence of
  those additional rights.
- Keep external acceptance closed pending legal approval and implementation.
  Public release remains a separate owner decision under #60.

These are project intentions, not contractual grants or findings about applicable law.

Copyright assignment is not selected because the intended model preserves each
contributor's ownership while seeking the necessary additional permissions through
a CLA. Transfer of ownership is not the project's objective. Whether the final
grant is sufficient for the intended uses requires legal review; if advice identifies
a gap, resolve it explicitly before accepting work rather than silently switching
to assignment. The owner decisions in [#60](https://github.com/DarrenPratt/Drelwick/issues/60)
confirm retained copyright and CLA plus sign-off, not an approved contract.

## Individual, employee and corporate contributors

| Scenario                                 | Proposed treatment                                                                                                                                        | Evidence needed before acceptance                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Individual owns original work            | Individual retains copyright; accept only under approved CLA plus per-commit DCO certification.                                                           | Identity linked to accepted terms/version and contribution commits; authority and provenance reviewed.                                                                |
| Employee-created work                    | Employment may affect ownership or authority. Do not determine employment law from authorship, device used or whether work occurred outside office hours. | Contributor confirms authority; employer approval or other evidence required by counsel's process. Hold if uncertain.                                                 |
| Company owns work                        | Company retains its rights; an individual sign-off cannot substitute for an authorised company grant.                                                     | Corporate CLA or explicit authorised-contributor mechanism, authorised signatory and covered employee/commit scope. Mechanism selection remains pending legal review. |
| Joint authors or copied work             | Every required right must be accounted for; a submitter cannot license another author's work beyond their authority.                                      | Attribution, upstream licence and provenance plus grants from relevant rights holders where necessary.                                                                |
| Contributor cannot grant required rights | Do not accept, merge or cherry-pick the submission under the proposed process.                                                                            | Resolve authority or decline; no informal AGPL-only exception that defeats the approved model. Any alternative needs separately reviewed policy.                      |
| Work predates this process               | No retrospective CLA or sign-off is presumed.                                                                                                             | Verify existing rights and obtain any required explicit grants; keep unresolved material out of proprietary relicensing.                                              |

Contributors should not upload employment agreements or private identity documents
to public PRs. The owner must establish a reviewed private evidence route first.
An employed contributor is responsible for obtaining any required employer
permission before submission and confirming authority under the approved process.
Maintainers must not decide who owns particular employment-related work; uncertainty
requires appropriate advice and a hold on acceptance.

For company-owned work, the proposed starting point for counsel is a corporate CLA
signed by an authorised representative, with a maintained list of authorised
contributors and covered submissions. A reviewed alternative may be suitable,
but must explicitly obtain the company's necessary rights and establish the
submitter's authority. Each submitter still provides their own DCO certification.
Neither employment nor an individual CLA automatically binds the organisation.
Final corporate terms, signatory checks, roster changes and coverage of former
employees remain pending legal review.

## CLA and DCO roles

The [CLA review brief](contributor-cla-requirements.md) specifies required grants,
patent questions, authority, corporate scope, acceptance and retention requirements.
It contains no final contractual wording and cannot be accepted as an agreement.
Counsel must confirm the rights needed for the proposed commercial model and how
to obtain them; Drelwick must then implement the approved acceptance mechanism.

Use the established [Developer Certificate of Origin 1.1](https://developercertificate.org/)
for truthful per-commit certification of contribution provenance and submission
rights. The [contribution guide](../CONTRIBUTING.md#ownership-cla-and-sign-off)
documents `git commit -s` and `Signed-off-by: Name <email>`. DCO certification and
CLA assent are separate checks. DCO alone is not treated as permission for
proprietary relicensing. Its public-record provisions require explicit attention
to sign-off identity disclosure; do not manufacture historical certifications.

## Community, commercial licensing, Pro, plugins and forks

The outbound Community licence and an inbound CLA perform different roles. The
intended AGPL-3.0-only distribution licence does not itself give Drelwick additional
rights to relicense another contributor's work as proprietary. Owner-owned code
may potentially be offered on alternative terms where the necessary rights are
held; existing third-party content, patents and dependency obligations still need
review. Additional grants must be traceable to the actual rights holder and scope.

No file becomes simultaneously Community and proprietary solely because the same
project develops both products. Pro use or combined distribution requires the
rights and boundary review in #53/#55. A contributor CLA cannot resolve every
licence obligation of the whole distribution.

No general proprietary-plugin exception is declared. #53/#57 must review plugin
interactions and whether an exception or other permission is required. The same
provenance and rights checks apply to contributed extension/API code; do not
promise proprietary plugins are allowed before approval.

Issues #55 and #57 are closed for their technical boundary/design work as of
29 September 2026. Their completion does not establish legal compatibility;
the corresponding Pro/plugin legal conclusions remain part of #53's pending review.

The project intends to respect Community source-licence rights for commercial
use, modification and forks, without adding restrictions prohibiting them.
Contributor acceptance rules are not extra restrictions on recipients' source
licence rights. Drelwick name/logo permissions and official-build claims belong
to #59; a right to fork does not make a fork official. See the intended
[AGPL version 3 text](https://www.gnu.org/licenses/agpl-3.0.html); interpretation
and compatibility remain within #53's legal-review scope.

## Existing contribution evidence

Technical identity/provenance audit refreshed on 29 September 2026, before this change:

- Non-shallow history; fetched origin branches and available PR heads into
  `refs/audit/pull/*/head`. `git log --all` covered 186 commits across 208 refs,
  including local-only history. Main at `fdaf5d5` contains 185 commits:
  111 authored as Darren Pratt, 63 as `jynx_Protocol`, 11 as `unknown`.
- Compared author/committer names and email identity overlap privately, and
  inspected commit-message co-author/sign-off trailers. Both alias groups share
  email metadata with Darren Pratt. This supports, but does not prove, common
  identity or ownership. Owner confirmation of aliases is pending. No raw email
  addresses are reproduced here.
- All 84 GitHub PRs returned by the all-state inventory were opened by
  `DarrenPratt`; there is no apparent separate human PR submitter in that inventory.
  GitHub merge-committer metadata is not an additional code contributor.
- 27 commits contain Copilot co-author trailers; none of the inspected historical
  messages contains a `Signed-off-by` trailer. Tool attribution is not a CLA,
  ownership proof or confirmation of third-party clearance. Review provenance and
  applicable tool terms before relying on exclusive ownership/relicensing.
- Existing [spelling attributions](attributions/spelling/README.md) identify
  third-party code/data notices. Dependencies and imported material retain their
  licences even when an owner-authored commit added them. Those are not deemed
  covered by an owner or future contributor CLA.

Reproduce the identity audit with `git log --all` author/committer metadata and
commit bodies, `git rev-list --count origin/main`, `git for-each-ref`, and
`gh pr list --state all --limit 300 --json number,author,state`. Review raw metadata
privately, not in public logs. Inspect each non-owner/unknown group and co-author
trailer, not just GitHub's contributor summary. These results do not cover
unreachable/deleted objects, off-repository submissions, undisclosed copied work or
the legal ownership of apparently owner-authored code.

No separate human external contributor is established by this evidence, but the
aliases and source provenance still require verification. The owner must confirm
identity mappings, employer/contractor obligations and any off-platform inputs.
If third-party contributions are identified, record commit/path scope and actual
licence/permission evidence privately, seek any additional necessary grants and
exclude unresolved material from commercial relicensing. No retroactive assent,
backdated approval or Git history rewrite is authorised by this audit.

## Acceptance workflow and record keeping

This is the **proposed post-approval workflow**, not an active acceptance service:

1. Owner records #53 legal outcome, final contributor terms and advice, verifies
   existing-source rights, and implements/tests the approved acceptance process.
   Complete #54 and the broader milestone before enabling external intake.
2. Contributor reads the approved terms and DCO, identifies ownership and any
   employer/third-party constraints, and accepts the required agreement through
   the approved mechanism before the maintainer accepts code.
3. Maintainer matches identity and authority to the agreement version and covered
   commits, reviews provenance/licences, and checks each commit's sign-off.
   Missing or unverifiable agreement, authority or sign-off blocks acceptance.
4. Review technical scope, tests, security and contribution conduct separately.
   Recheck rights coverage and sign-offs after new commits, rebases or squash
   preparation; preserve original attribution and commit mapping in the record.
5. Accept only when both rights/process and technical reviews pass. Record the
   maintainer decision and final merge SHA. The project need not accept/use a
   submission merely because terms were accepted.

Darren Pratt is the initial process owner. Before activation, choose private
record storage with access controls, backup and an approved retention/privacy
policy. Retain the exact accepted terms/version/hash, acceptance timestamp and
method, verifiable identity/account linkage, contribution/PR/commit scope,
organisational authorisation and reviewer decision/reference. Track exceptions
and unresolved claims. Public PRs should contain only minimal verification status
and a non-sensitive reference, not private agreements or unnecessary personal data.
No CLA service, signature collection, retention schedule or legal recipient has
been approved by this document.

### Acceptance mechanism options and implementation gate

For the present project size, prefer evaluating a maintainer-verified process
using GitHub PR identifiers plus private agreement records before adding a hosted
CLA service. This is a proposal for review, not an enabled mechanism:

| Option                                                        | Intended evidence                                                                                                                                        | Review needed before selection                                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Private acceptance of a versioned agreement, linked to GitHub | Exact accepted document, affirmative acceptance and timestamp, verified account/identity link, contribution scope and maintainer verification reference. | Counsel approves acceptance method; owner establishes private custody, backup and an identity-verification procedure. Corporate authority stays private.                 |
| Explicit assent from a GitHub account against immutable terms | Account identifier, terms revision/hash, timestamp, captured assent event and covered PR/commits, with an independently retained evidence copy.          | Counsel confirms enforceability and identity requirements; review edited/deleted comments, account changes and public disclosure. A generic PR checkbox is insufficient. |
| CLA application/service                                       | Equivalent exportable agreement/version/identity/scope records and status checks.                                                                        | Assess permissions, privacy, retention, cost and continuity if the service disappears. No service is currently selected or required.                                     |

Whichever option is approved must link **who**, **which terms/version**, **when**
and **which contributions**. Record whether the approved agreement covers one
submission or future work; never infer broader coverage. Preserve the original
assent evidence separately from a mutable PR status. Changes to terms or corporate
authority must trigger the reviewed coverage/reacceptance procedure. The owner
must implement and test the selected mechanism before #54 can close.

### DCO verification feasibility

The current `.github/workflows/ci.yml` runs repository quality checks but has no
DCO or CLA verification. A small future GitHub Actions check can inspect the
actual proposed commit range using Git's trailer parser and require correctly
formed `Signed-off-by` trailers under the approved identity/forwarding policy.
It should read commit metadata with minimal permissions, never execute submission
code to verify certification, and avoid printing personal email addresses.

Test missing/malformed trailers, multiple authors or forwarded work, new commits,
and rebased/squashed revisions; recheck the exact revision proposed for merge.
Define merge-commit and bot treatment explicitly before enforcement, without
fabricating anyone's sign-off or retrospectively applying it to existing history.
Configure the verified check as a merge requirement when intake is activated.
Syntax checks cannot prove authority, ownership or CLA assent; those remain
separate maintainer checks. Implementation and required-check configuration are
pending the approved process, and no DCO bot or external infrastructure is added
by this documentation.

### Withdrawal and disputed rights

For a withdrawal request before acceptance, stop processing the submission and
record the request using the approved privacy process. For accepted/distributed
work, do not promise removal, revocation or survival of rights: counsel must define
the actual terms and advise on the request. Hold disputed material from new
commercial reuse pending review. Preserve required evidence under the reviewed
retention policy; do not silently erase attribution or rewrite shared history.

## Professional legal review and unresolved owner decisions

**Legal review: pending. #54 cannot close on this documentation alone.**

Counsel must review individual, employee and corporate scenarios; copyright
ownership and existing-source rights; the actual CLA grants and any patent terms;
DCO interaction and disclosure; AGPL-3.0-only source/binary distribution; Community/
Pro separation; dual/commercial relicensing; plugins; third-party material and
dependency redistribution; acceptance enforceability, withdrawal/termination and
record privacy/retention. Record actual review scope, date, revision and evidence
reference, including unresolved qualifications, without publishing privileged advice.

Owner decisions still needed after advice: legal grant recipient, final CLA and
corporate mechanism, acceptance/identity verification and private custody system,
retention/privacy arrangements, historical identity/provenance confirmations,
and explicit approval to activate the process after all applicable gates clear.

[#60](https://github.com/DarrenPratt/Drelwick/issues/60) owns public-release readiness,
conduct and security contacts and publication authority; #53 owns final licensing
approval; #55/#57 own architecture and plugin review; #59 owns brand policy.
This change implements none of those separately owned features or permissions.

| #54 acceptance criterion               | Prepared here                                         | Still blocking completion                                                        |
| -------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Ownership model selected               | Owner intent recorded: retain copyright, CLA and DCO. | Professional review and final terms.                                             |
| External process documented            | Proposed workflow and closed-gate guide.              | Approved, implemented and verified acceptance mechanism.                         |
| Commercial implications understood     | Rights distinctions, scenarios and risks documented.  | Appropriate advice, #53 outcome and existing-source rights verification.         |
| CONTRIBUTING.md created                | Practical guide with sign-off and gate.               | Final alignment with approved terms and operational routes.                      |
| Required agreement process established | Requirements brief only.                              | Final CLA, corporate mechanism, recipient, custody and tested acceptance checks. |

Use **Related to #54**, not a closing keyword, while these blockers remain.
