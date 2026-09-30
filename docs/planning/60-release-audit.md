# Public-release preparation audit

**Related to #60; release blocked. Repository visibility remains private.**
Technical reviewer: Codex, refreshed 30 September 2026, against main `bc441cb` and this
preparation change. Accountable owner: Darren Pratt. Technical inspection is not
professional legal review, owner signoff or publication authority. The
[release register](public-release-checklist.md) remains the primary gate.

## Dependencies and implemented scope

Reviewed live issue bodies/comments and corresponding repository evidence rather
than treating checkbox state or closure as implementation proof.

| Issue                  | Live status            | Repository evidence and release consequence                                                                                                                                                                          |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #52 feature boundary   | Open                   | Design/addendum/local-publishing plan reserve ordinary authoring/import/export/EPUB/basic PDF/backup for CORE. Broader feature review and unimplemented exports remain open.                                         |
| #53 Community licence  | Open                   | Owner selected AGPL-3.0-only. This change prepares the verbatim GNU text, central copyright notice and seven manifest licence fields. Legal review/final approval remain pending.                                    |
| #54 contributor rights | Open                   | CONTRIBUTING, strategy and draft CLA requirements exist. Final individual/corporate terms, acceptance implementation and legal review are absent. External contributions stay closed.                                |
| #55 package boundary   | Closed; PR #196 merged | Six-workspace inventory, negative architecture tests and graph scan enforce the one-way dependency. Community standalone checks pass without Pro.                                                                    |
| #56 classification     | Closed                 | Four product labels, implementation form and development definitions exist. All inspected existing feature issues have exactly one product label. Maintainers classify incoming requests during triage.              |
| #57 extensions         | Closed; design only    | Architecture/review define Community-owned contracts, scoped capabilities and version negotiation. SDK/host/runtime are deferred; no executable plugin support or private Pro hook is advertised.                    |
| #58 project format     | Closed; PR #198 merged | Public specification, synthetic `public-example`, production-schema/archive/migration tests and independent recovery helper exist. Reference data is reserved, not an invented implemented schema.                   |
| #59 branding           | Closed; PR #199 merged | Policy/review distinguish source rights, names/artwork, truthful compatibility and official builds. Closure provides no legal-review evidence: PR #199 explicitly records review and artwork permissions as pending. |
| #51 reliability        | Open                   | Windows source-runtime checklist and current E2E evidence exist. Owner no-known-data-loss signoff and standalone/platform evidence remain open.                                                                      |
| #107 packaging         | Open                   | No Electron Builder dependency/configuration, package script, installer or release artifact. `pnpm build` produces development output only.                                                                          |
| #127 local publishing  | Open                   | Import/edit/preview/backup exist. #125 manuscript DOCX export and #126 EPUB generation/validation are absent; no complete offline publishing candidate can be certified.                                             |

The licensing milestone remains open (five closed and four open issues at
inspection). #61 Pro integration awaits executable Community interfaces and
applicable legal gates; no Pro is required to build or operate Community.
#139 optional backup research and #131 later print validation remain outside the
EPUB candidate gate. Planned basic PDF remains Community work.

## Licensing, conduct and contacts

[LICENSE](../../LICENSE) preserves the text downloaded from
[GNU](https://www.gnu.org/licenses/agpl-3.0.txt). [COPYRIGHT.md](../../COPYRIGHT.md)
records the exact owner-selected `-only` designation, collective notice and
third-party/branding distinctions. Root and six workspace manifests match and
remain private. Current README, AGENTS and design wording are reconciled; dated
candidate-language in planning/audit records remains historical evidence.

**Legal review: pending** for Community/Pro, dual licensing, individual/employee/
corporate CLA rights, plugin implications, ownership, branding, artwork and
uncertain redistribution obligations. No approved agreement or proprietary
relicensing permission is inferred from these notices or owner-authored commits.

[CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) uses Contributor Covenant **v2.1**
from the upstream CC BY 4.0 revision identified in its attribution. The pledge,
standards, scope and four enforcement levels are retained; the enforcement section
describes the sole maintainer and absence of an independent internal team.
No tested public conduct mailbox or standing independent reviewer is evidenced.
[SECURITY.md](../../SECURITY.md) states latest-supported-release, best-effort/no-SLA
support and private handoff instructions. No supported public release exists yet.

General, security and conduct mailboxes must be configured and tested before being
advertised; no addresses are guessed. A tested security mailbox is the practical
pre-publication route while GitHub reporting is unavailable. Policy files alone
do not satisfy the operational gates.

## GitHub configuration and hosted evidence

- Metadata confirms **private** visibility and admin access. Visibility was not
  changed. No tags, Releases or Actions artifacts were returned; there was no
  release binary to inspect.
- Private Vulnerability Reporting GET and PUT both returned **HTTP 404**. GitHub's
  [guidance](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
  documents public-repository availability. Enablement and reporter/notification
  tests remain pending. Do not change visibility as a workaround; after a separate
  owner publication action, verify this route before advertising it.
- Dependabot alerts were disabled. Enabled them through the repository API.
  After processing, the baseline contained **82 open reports** (one critical,
  25 high, 44 medium, 12 low), including duplicate manifest/lockfile reports.
  The initial empty response was provisional, not a clean result. No automatic
  merge or dependency-update service was introduced; see dependency triage below.
- Main protection requires **Quality checks**, strict/up-to-date status and
  enforcement for administrators; force pushes and deletions are disabled.
  No additional rulesets were returned. Existing controls are retained.
- CI pins actions, grants `contents: read`, disables persisted checkout credentials
  and runs frozen install/lint/format/typecheck/tests/build/workspace. Baseline
  [main CI 36608365122](https://github.com/DarrenPratt/Drelwick/actions/runs/36608365122)
  succeeded at `bc441cb`. This PR and the eventual candidate need independent CI.
- Bug/feature/task forms direct security reports to the policy, never an ordinary
  issue. Blank issues stay disabled. PR guidance preserves the contribution gate
  and separates DCO from CLA approval. Contacts and post-merge rendered forms still
  require owner verification.

## Secret and history review

Sensitive evidence is **outside the repository**, in the owner's local Codex
private-audit directory for `drelwick-60-2026-09-29`. Windows ACL inheritance was
removed; access is granted to the current owner account and SYSTEM. It contains
ref/object inventories, scan reports, Git identities/emails, URL/path findings,
configuration/issue snapshots and Actions logs. Do not attach it to a public PR.

Pre-change scan scope and findings:

- Non-shallow checkout; fetched branches/tags and all available PR heads.
  Inventoried **211 refs, 188 commit objects and 1,290 blobs**. Read every local
  commit/blob using `git cat-file --batch-all-objects`, including two unreachable
  blobs identified by `git fsck --full --no-reflogs --unreachable`. No history rewrite.
- Gitleaks **8.30.1**, obtained from its official release and checked against its
  published SHA-256 checksum, scanned the tracked tree, full-ref/reflog Git diff
  history and extracted blobs/commit metadata. Archive and recursive decoding
  depths were five; reports/logs were redacted and retained privately. The object
  scan supplements the diff scanner's merge/history traversal limitations.
- Three tree alerts and three diff-history alerts are fixed synthetic UUIDs in
  tests. All 63 object alerts are historical versions of those fixtures across
  four desktop test files; every flagged source line was checked. **No genuine
  credential was identified.** No rotation is claimed. Any future confirmed
  credential requires revocation/rotation even if removed from the latest tree.
- Downloaded/scanned **all 166 available Actions log archives**, with no secret
  alerts. Artifact/release inventories were empty. Future logs/artifacts and
  inaccessible/deleted remote objects require another candidate review; this
  local inventory cannot cover remote backups or other people's clones.
- Exported available issue/PR bodies, issue comments and PR review comments to
  private records and scanned them with no secret alerts. Their privacy/publication
  review remains an owner action; secret scanning alone does not approve personal
  information or historical private links. The final prepared tree was scanned
  again and contains only the same three synthetic UUID alerts.
- The private inventory records **three author/committer email identities**, plus
  source/notice/tool-attribution email matches. Raw addresses are not reproduced
  here. Aliases include `jynx_Protocol` and `unknown`; #54 identity/rights confirmation
  remains outstanding. Name-publication permission does not approve emails.
- Current private project-board hyperlinks were replaced with explanatory text in
  development, tracking and the historical audit. Earlier occurrences remain in
  history and the private inventory. Remaining example paths, localhost URLs and
  `.invalid` domains are synthetic/development documentation, not credentials.
  Historical product names and permitted commercial planning remain visible.

Scans do not establish absence of every possible secret or consent to publish
personal data. Repeat against the exact final candidate refs/tree, review hosted
issue/PR/discussion content and new logs, and obtain owner decisions on the private
inventory. Any history remediation requires separate explicit approval.

## Artwork and provenance

Inspected the complete logo PNG structure and recursively parsed the **23,654-byte
C2PA/JUMBF payload**, including CBOR action/claim/signature records. The private
inventory records ChatGPT/OpenAI generation/conversion/watermark events, timestamps,
opaque instance identifiers, provider icon and signature/certificate material.
Decoded nested COSE headers and CMS timestamp structure; the five parsed X.509
certificates identify OpenAI/SSL.com public signing/timestamp chains, not private
keys. No certificate trust or signature-validity assertion is made.
No live credential or personal email was identified. Standards/certificate-service
references are not private Drelwick services. This is structural/privacy inspection,
**not cryptographic validation or artwork legal clearance**. Remaining opaque
signature/timestamp bytes and identifiers need owner review before privacy signoff.
No provenance or branding binary was removed or altered.

Visually reviewed the ten documentation screenshots as a contact sheet: they show
demo/fixture content rather than apparent personal manuscripts or credentials.
This does not establish copyright/reuse permission. #59 artwork and trademark
review remains open.

## Dependencies and distribution

Updated development tooling within existing major versions: Vite **7.3.6** and
concurrently **9.2.4**, with the committed lockfile resolving esbuild **0.28.2**
and shell-quote **1.9.0**. No dependency override is required. The concurrently
two-process smoke check passes. These updates remove the affected older tooling
versions; they do not clear the runtime security gate.

The 29 September `pnpm audit --json` exited **1** with **35 advisories**.
The refreshed 30 September query on the same lockfile exits **1** with **46**:
38 for Electron, two for extract-zip and six for brace-expansion (18 high,
22 moderate, six low, zero critical). These are audit advisory records, not unique
vulnerabilities or the duplicate GitHub report count. The changed result reflects
the current advisory feed; it is not evidence of a dependency change on resumption.
Electron remains **39.1.2**; upstream identifies
[39.x as end of life](https://releases.electronjs.org/release/v39.8.10).
A supported-major migration requires dedicated runtime, platform and packaged
validation. The extract-zip installer dependency has no patched version identified
in the reported advisories. Assess removal/replacement or documented mitigation.
The brace-expansion records identify fixes in 1.1.21 and 5.0.12 for the affected
version ranges; review the transitive dependency chains and validate remediation
in a focused dependency update. Do not dismiss tooling findings solely because
they are development dependencies.
**Unresolved dependency vulnerabilities block release**; no alert was dismissed.

`pnpm licenses list --json` inventoried **530 installed records**, including **78
production records** in the production-only query. This is the installed Windows
graph, not every platform's optional binaries. Actual top-level licence/notice
files were inventoried with names, byte sizes and hashes: 518 records have notices;
12 require deeper/upstream review, including toolchain/platform wrappers. Recognised
package metadata is not a legal compatibility finding.

Installed Windows Electron **39.1.2** has `LICENSE` (1,096 bytes) and
`LICENSES.chromium.html` (15,102,119 bytes). Chromium notices contain LGPL material;
the runtime includes FFmpeg and graphics/native libraries. `sharp` 0.35.4's Windows
package declares Apache-2.0 AND LGPL-3.0-or-later and ships libvips DLLs; its top-level
LICENSE contains Apache text and does not alone establish complete libvips notices
or obligations. Trace the actual shipped binaries to upstream notices and any
applicable corresponding-source/relinking requirements.

Existing [spelling notices](../attributions/spelling/README.md) cover nspell and
US/UK dictionary resources. The existing image documentation flags sharp/libvips
review; no completed packaged-distribution audit was found. Themes use generic/local
font families. Logo/screenshots and synthetic assets need applicable rights review;
Contributor Covenant retains its own attribution/licence rather than an AGPL label.

Darren Pratt owns the initial redistribution review. #107 must provide actual
portable/NSIS and later platform artifacts, followed by checks for required runtime
files/notices/source materials and absence of development files/secrets. Uncertain
compatibility or obligations require professional advice. **No packaged artifact,
notice completeness, LGPL compliance or legal compatibility is certified here.**

## Technical validation and release claims

Community independently installed/built/tested in an isolated temporary checkout
without Pro during the preceding #61 readiness audit at `929d46c`, whose tree
matches this main base. Frozen install, lint, formatting, typecheck, 938 tests,
build and workspace/architecture checks passed. This proves baseline independence,
not Pro integration.

For this change, `pnpm test:e2e` passed **15 Windows source-runtime tests**, covering
DOCX/text import, offline spelling/themes/preview, authoring/autosave, forced-exit
recovery, organisation and chapter history. The older preview E2E failure recorded
in #196 did not reproduce. This is not installer/cross-platform verification or
the absent EPUB/DOCX export pipeline required by #127.

Final local frozen install, lint, format check, strict typecheck, **938 tests in
80 files**, build and workspace smoke all passed with Node **24.18.0** and pnpm
**10.34.5**. Workspace validation includes the **20 architecture regression tests**
and actual six-workspace scan. The unit suite includes project-format/example,
independent recovery, migration, archive, DOCX/text import and rendering tests.
All **344 local Markdown links/anchors** checked resolve; issue-form YAML parses;
seven manifest licences match; GNU licence bytes and Covenant non-enforcement
sections match the downloaded upstream texts (ignoring Markdown formatting for
the Covenant). `git diff --check` passes. No runtime source, schema or branding
binaries changed. Tooling and lockfile updates are described above. Vite chunk-size warnings
are non-failing. Packaging/export checks are unavailable for the reasons above;
Coverage was additionally collected on 30 September: all 938 tests passed,
with 69.10% statements, 60.72% branches, 71.37% functions and 71.27% lines.

This PR's required hosted CI results are recorded in the PR.
The checklist must not call candidate CI complete merely because baseline CI
passed. Before publication repeat checks on the exact candidate, validate packaged
artifacts, complete #51/#107/#127 and obtain owner release signoff.

## Resumption verification — 30 September 2026

The interrupted preparation was still uncommitted on
`chore/60-public-release-readiness`, based on `bc441cb`. Its 28 staged files,
two subsequent documentation edits and private audit evidence were inspected and
preserved. No #60 PR existed. Licence/policy/template preparation, tooling updates,
privacy inventories and the original validation logs were already complete;
they were not recreated. No runtime source, persistence or branding change was
needed to resume. The existing rename was independently confirmed as merged
PR #181; the local remote now uses the verified Drelwick repository location.

Live dependency bodies/comments were re-read. #52, #53, #54, #51, #107, #125,
#126 and #127 remain open; #55, #56, #57 and #58 remain closed with the implementation
or design evidence described above. #59 is closed following PR #199, but neither
the issue nor that PR supplies professional review or artwork approval. Its PR
explicitly says that legal review remains pending. R11 therefore remains blocked;
an issue closure is not substitute evidence. No settled owner decision was changed.

The repository was re-confirmed private. Main still requires strict **Quality
checks**, including administrators, and prohibits force pushes/deletion.
Dependabot alerts remain enabled. The reporting GET still returns HTTP 404;
no visibility change or new enablement attempt was made. Releases and Actions
artifacts remain empty. The licensing milestone remains open with four open
issues; #60 remains open.

The original audit directory and redacted reports remain available with protected
ACLs. New evidence is in its private `resume-2026-09-30` subdirectory. After fetching
branches, tags and available PR heads, inventory and scanning covered **211 refs,
188 commits and 1,318 blobs**, including all local objects rather than only reachable
history. The 28 additional blobs are local preparation objects; the commit inventory
is unchanged. Gitleaks 8.30.1 was rerun on full-ref/reflog history, extracted objects
and the working tree with redaction and archive/decode depth five. Findings remain
**3 tree, 3 history and 63 object alerts**, at the same previously reviewed synthetic
fixture locations; no new credential finding was identified.

All **166** hosted Actions runs still match the previously downloaded/scanned log
inventory, so those archives were not downloaded again. Refreshed hosted snapshots
contain the same 200 issue/PR records, two issue comments and no review comments;
their repeat secret scan has zero findings. These checks preserve the stated scope
limitations: owner review of historical emails, private links, hosted material and
logo identifiers remains outstanding. No history rewrite or personal-data
publication approval is inferred. Re-scan new commits and CI logs before release.

Reliable validation from the immediately preceding 30 September rename audit was
retained: frozen install, lint, format, strict typecheck, 938 unit/integration tests,
build, workspace smoke/20 architecture tests, 15 Windows Electron tests and coverage
all completed successfully on the same runtime, manifests and lockfile. This includes
the public-format fixture, independent recovery, archive, migration, import and
rendering checks. The desktop output was rebuilt cleanly; prior ignored output was
preserved outside the checkout. Fresh lint and formatting checks pass after the documentation changes, as do
all 345 local links/anchors, issue-form YAML, seven manifest licences, GNU licence
bytes and Covenant section comparisons. The refreshed 530-record licence inventory
(78 production records) is unchanged. The final prepared-tree scan retains only
the same three synthetic UUID alerts. The PR receives its own hosted CI. No standalone
packaging or DOCX/EPUB export test can run before those implementations exist.

## Remaining decisions and handoff

Owner actions: configure/test general, security and conduct domain contacts;
review private identity/URL/metadata inventories and authorise any remediation
separately; approve contributor recipient/custody/process; review actual dependency
distribution and packaged artifacts; resolve remaining dependency vulnerabilities
and the supported Electron migration; complete reliability/feature decisions;
approve reviewed artwork terms and official channels. Missing features remain
with #107/#125/#126/#127 and later Community work.

Professional review: #53 Community-Pro/plugin/dual-licensing compatibility;
#54 individual/employee/corporate ownership and final CLA/acceptance;
#59 name/artwork rights and trademark policy; uncertain redistribution obligations.
Record real reviewer, scope, date, revision and approval evidence.

No closing keyword for #60 is appropriate. Even after every gate is satisfied,
publication remains a separate explicit owner action.
