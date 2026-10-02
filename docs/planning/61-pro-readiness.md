# Pro integration readiness for #61

**Blocked; Related to #61. No Pro repository or integration created.**
Classification: PRO. Reviewed by Codex on 30 September 2026 against Community
main `01850d1`, the live #61/#55/#57 requirements and the implementation below.
This is a readiness assessment, not completion of the commercial skeleton.

## Readiness decision

#61's instruction to defer integration remains applicable. #55 and #57 are
closed, but #57 completed an architectural design. Its
[opening qualification](../extension-architecture.md) explicitly says contract
names/signatures are design notation, not importable exports. Its
[implementation gates](../extension-architecture.md#consumption-and-implementation-gates)
require a first Community SDK, external consumer fixture and host capability
before Pro integration. No subsequent implementation was found in the current
package inventory or exports. The design is useful and sufficiently detailed for
a focused Community implementation; it is not a stable released extension API.

| Readiness requirement                  | Current evidence                                                                                                                                                                                                                               | Result                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Community must not depend on Pro       | `scripts/check-community-boundary.mjs`, its 20 regression tests and `scripts/community-packages.json` cover package dependencies, imports, configuration, workspace discovery and executable references; `check:workspace` invokes them in CI. | Implemented; preserved unchanged.                        |
| Community builds/tests without Pro     | Isolated verification described below uses only this Community source, its lockfile and registry dependencies.                                                                                                                                 | Verified for the implemented Community; see scope below. |
| Public extension architecture defined  | #57 design covers contracts, trust, capabilities, version negotiation, failure and absence; its review explicitly defers executable implementation.                                                                                            | Design complete; consumption readiness blocked.          |
| Approved consumable extension contract | Six Community workspaces exist; no `packages/plugin-sdk`, exported `ThemeContribution`/`Validator`/`PublishingProfileContribution`, host registration or API negotiation implementation exists.                                                | Missing. No claimed SDK version.                         |
| Integration avoids internals           | Existing package exports support built-in workflows, not the proposed external contribution boundary. Importing filesystem services or desktop internals would not prove #57 integration.                                                      | Cannot demonstrate yet.                                  |

The apparent theme shortcut is unsuitable. `BuiltinThemeIdSchema` in
`packages/shared/src/theme-contracts.ts` permits only `classic`, `modern` and
`literary`; `BookThemeSchema` uses that enum. The renderer catalogue and desktop
selection consume those built-in identities. A Pro theme cannot claim another
publisher's identity, cast around validation or add a private registration hook.
External identity, negotiation and absence/fallback support remain in #57's
[deferred implementation register](57-extension-review.md#deferred-implementation-register).
Calling a built-in renderer function would prove ordinary package resolution,
not the requested extension integration.

## Repository and legal status

Authenticated GitHub identity was the intended owner, DarrenPratt. The exact
`DarrenPratt/Drelwick-Pro` metadata lookup returned not found, and the owner's
repository listing contained no matching repository. No local sibling checkout
was present. Thus no existing Pro visibility or contents could be verified; no
repository was created or overwritten. Repeat the lookup before eventual creation.
The user's conditional creation authority is not exercised while readiness fails;
creation permissions were not tested through a write operation.

#53 and #54 remain open. The owner-selected Community licence is AGPL-3.0-only;
legal review of Community/Pro, plugins and commercial relicensing is pending.
Contributors retain copyright; the intended CLA plus DCO process is not an
approved agreement or implemented acceptance mechanism. Consuming a package does
not itself settle proprietary-combination obligations. Do not copy Community code
into differently licensed source or infer a plugin exception. See the
[contributor strategy](../contributor-copyright-strategy.md) and
[public-release gate](public-release-checklist.md). Neither repository's visibility
is changed by this assessment.

## Smallest future implementation

First deliver the Community-owned capability in a separately reviewed Community
change, following #57's existing design rather than inventing a Pro-only API:

1. Export the smallest needed DTO-only SDK and validated manifest/category schema,
   with a real version and documented package exports. Include it in #55's reviewed
   inventory without weakening the prohibition on Pro dependencies.
2. Provide one host boundary with implemented capability discovery, compatibility
   rejection and bounded input/result validation. Use an independent Community
   consumer fixture that represents either Pro or a third party equally.
3. Prove compatible and deliberately incompatible API/category/payload cases;
   missing required capabilities reject before execution, and absent optional
   contributions preserve Community operation. For a declarative theme, also
   prove namespaced identity, controlled rendering and absent-theme fallback.
4. Review applicable licensing/rights questions, then reassess #61 and create the
   separate repository private from its first creation if still authorised.

The proposed `advanced-print`, `kdp-preflight`, `premium-themes`, `licensing` and
`tests` structure remains appropriate as a future skeleton. Select just one
non-production consumer after the first public capability exists. A declarative
theme is a candidate, not a commitment to implement theme infrastructure here.
KDP may later consume public validator/profile contracts. Advanced print and
entitlements remain empty boundaries; no server, account, payment or signing-key
implementation is needed. None of these directories is added to Community.

## Reproducible consumption and compatibility plan

No SDK is published and current workspaces are private at version `0.0.0`.
Therefore the initial proposed source for future integration CI is an explicitly
reviewed, full Community commit SHA, not a moving branch or a developer's sibling
checkout. CI should fetch that revision into a job-owned directory, use its pinned
toolchain and frozen lockfile, build the public SDK and pack its required Community
package closure. Pro then installs those versioned artifacts through a locked,
documented mechanism. Verify hashes/provenance and exported package contents;
reject unresolved workspace links or dependencies on files outside the artifacts.
The SDK implementation must establish this packaging proof before it is relied on.
Published immutable SDK packages can replace source acquisition when available.
Local links remain optional conveniences, never the only CI input.

Align future Pro tooling with Community's current Node 24.x, pnpm 10.34.5,
TypeScript 5.9.3, strict ESM and workspace conventions. Pin actual versions and
maintain Pro's own lockfile; do not copy Community-only package inventory rules.
The future private workflow needs read-only repository permissions, pinned actions,
non-persisted checkout credentials, frozen installation, lint/format, typecheck,
build, tests and positive/negative API compatibility checks. While Community is
private, the Pro repository token alone must not be assumed to grant access:
use an owner-configured read-only GitHub App installation token or equivalent
scoped repository secret. Never commit its value or add credentials to package
URLs. There is no Pro workflow or hosted Pro CI result today.

Use the [#57 version policy](../extension-architecture.md#version-policy), not
application-version equality. A source SHA makes a build reproducible; the SDK API
range and negotiated category/data/capability versions determine compatibility.
No actual range can be advertised before the first SDK exists. Experimental 0.x
consumers pin the supported minor line and immutable build; stable APIs allow
documented compatible ranges, with breaking changes requiring a new major.
Required unsupported versions/capabilities fail clearly; optional capabilities
are explicitly absent. Unreleased development uses a reviewed SHA/artifact and
must not claim stable support. Coordinated releases need a tested host/SDK/Pro
matrix, supported-version policy and upgrade notes before removing support.

## Project integrity and standalone verification

The [public project format](../project-format-specification.md) remains authoritative.
No proprietary format or optional extension metadata is introduced. Future metadata
needs its own Community-owned schema, absence, recovery and migration proof.
Ordinary manuscript content must remain readable, editable and recoverable without
Pro. Basic DOCX interchange, EPUB, basic PDF and backup/restore remain Community
capabilities; pending exports are not claimed implemented. No Pro checkout,
account, backend, provider or network service may become a local-authoring or
publishing prerequisite.

On 30 September, an isolated detached worktree of `01850d1` plus this readiness
document and index link passed `pnpm install --frozen-lockfile`, `pnpm lint`,
`pnpm format:check`, `pnpm typecheck`, `pnpm test` (**938 tests in 80 files**),
`pnpm build` and `pnpm check:workspace` (including **20 architecture tests**, the
six-workspace graph scan and the separate package-consumer smoke check). The
unique temporary parent contained only the Community checkout, with no Pro
checkout or sibling source dependency. Node was **24.18.0**, pnpm **10.34.5**.
The existing boundary scripts, manifests, lockfile, application and project format
are unchanged. Final documentation formatting and all 353 local Markdown links/anchors also
passed; hosted Community PR CI is reported on the PR.

No new Electron E2E, coverage or packaging run is claimed for this documentation
change: no runtime behavior changed, and a Community build does not prove Pro
integration or unimplemented publishing/packaging features.
Pro private-repository, integration-build, compatibility and hosted-CI acceptance
criteria remain unverified because their prerequisites are absent. No artificial
tests of copied design types are substituted for that evidence. Keep #61 open.
