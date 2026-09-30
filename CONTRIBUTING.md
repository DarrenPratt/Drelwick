# Contributing to Drelwick

**External contribution gate: CLOSED. Do not submit or accept external code,
documentation or asset contributions until [#54](https://github.com/DarrenPratt/Drelwick/issues/54)
is complete and the Licensing & Commercial Architecture milestone is complete.**
Legal review and the approved CLA and acceptance mechanism are pending. A signed-off
commit, PR checkbox or this guide does not satisfy that gate. Maintainers must not
merge or cherry-pick external submissions while it remains closed.

The [contributor and copyright decision](docs/contributor-copyright-strategy.md)
records the proposed process. The instructions below support current owner
development and describe the intended external process after approval; they are
not an invitation to contribute or a contract available for acceptance.

## Prepare a change

Read [AGENTS.md](AGENTS.md), the [development workflow](docs/development.md), the
complete issue and its dependencies, and relevant [documentation](docs/README.md).
Agree scope through an issue before implementation. Keep one focused issue per PR,
use the documented branch names and product classification, and preserve security,
persistence and Community/Pro boundaries. CORE must build without Pro.

Use the versions and setup in [README](README.md#development-setup), including
`pnpm install --frozen-lockfile`. Run `pnpm lint`, `pnpm format:check`,
`pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm check:workspace` before review.
See [test conventions](tests/README.md) for relevant regression, coverage and
Electron checks. Report actual results and explain unavailable/inapplicable checks.
Use the PR template; use `Related to #<issue>` for incomplete work and
`Closes #<issue>` only when all requirements, including legal gates, are satisfied.

## Ownership, CLA and sign-off

The proposed model is **contributors retain copyright + Contributor Licence
Agreement (CLA) + Developer Certificate of Origin (DCO) 1.1 sign-off**. You must
have authority to submit the work and grant the rights required by the approved
CLA. Work created through employment or on behalf of a company may belong to that
organisation. Obtain the necessary authorisation; personal sign-off alone cannot
establish the employer's permission. The corporate agreement/authorised-contributor
mechanism awaits legal review.

If you are employed, you are responsible for obtaining any necessary employer
authority before submission. Do not ask maintainers to decide ownership under
your employment arrangements. For company-owned work, the proposed corporate
process requires an authorised organisation grant and confirmation that you and
your submissions are covered; an individual CLA does not substitute for it.

Before any future external contribution is accepted, the maintainer must verify
acceptance of the approved CLA version, contributor identity, organisational
authority where needed, and the submitted commits. There is **no approved CLA to
sign yet**. [CLA requirements](docs/contributor-cla-requirements.md) are a review
brief, not legal terms. If the CLA is missing, incomplete, unverifiable or cannot
be granted, the contribution must not be accepted. Do not paste signatures,
employment documents or private identity evidence into public PRs.

The [acceptance-mechanism proposal](docs/contributor-copyright-strategy.md#acceptance-mechanism-options-and-implementation-gate)
requires a retained record of who accepted which agreement version, when, and
which contributions it covers. Its selection and implementation remain pending;
do not attempt to accept the draft by commenting on a PR. Agreement acceptance
does not oblige Drelwick to accept or use a contribution.

Read the complete [Developer Certificate of Origin 1.1](https://developercertificate.org/)
before signing off. Under the proposed external process, each contribution commit
must carry the submitter's truthful certification in this form:

```text
Signed-off-by: Name <email>
```

For a new commit, use [`git commit -s`](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt--s)
with your own configured name and email.
The `-s` flag adds a trailer; it does not cryptographically sign the commit or
complete a CLA. Never sign for another person. Preserve attribution and valid
trailers when integrating work, and recheck all commits after changes. Do not
rewrite shared history or add retrospective certifications on someone's behalf.

The DCO includes public, indefinitely retained contribution records. Names and
emails in commits/sign-offs can become public; select an appropriate verifiable
address before submission and review that disclosure. The repository is currently
private; these instructions do not authorise publication of historical emails.
DCO certification does **not** replace the CLA or establish proprietary relicensing
rights. Existing owner commits are not retrospectively certified by this guide.
CI does not currently verify DCO or CLA compliance. A future sign-off check will
assist review but cannot establish your authority or replace CLA verification.

## Licensing of accepted contributions

The intended Community licence is **AGPL-3.0-only**, with final approval pending
legal review in [#53](https://github.com/DarrenPratt/Drelwick/issues/53). Once the
process is approved, accepted original Community contributions are intended to be
distributed under that licence, with additional rights granted through the approved
CLA for the intended separate commercial/proprietary licensing model. Contributors
retain copyright; submission alone grants no assumed commercial relicensing rights.

Identify third-party code, assets and their licences and provenance before review.
You cannot grant rights you do not hold. Keep upstream notices; a CLA for your own
changes does not relicense upstream material. Unresolved rights prevent acceptance.
Pro remains separately licensed; no proprietary plugin exception is promised.

## Conduct and private security reports

Follow the [Code of Conduct](CODE_OF_CONDUCT.md), adapted from Contributor Covenant
v2.1 with sole-maintainer enforcement. A tested public conduct contact remains
[#60](https://github.com/DarrenPratt/Drelwick/issues/60) work; no operational
conduct mailbox is claimed here.

**Do not report vulnerabilities in public issues, PRs or discussions.** Follow
[SECURITY.md](SECURITY.md) for current private reporting instructions and support
policy. GitHub Private Vulnerability Reporting is the intended preferred route,
but query/enable requests returned HTTP 404 while the repository remains private.
No Drelwick-domain security mailbox has been verified. Authorised collaborators
should arrange a secure handoff through their existing private project channel;
otherwise withhold details until a verified route is provided. Do not guess an
email address or use a public issue as a fallback.
