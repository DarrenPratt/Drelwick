# Security policy

## Supported versions

Security fixes target the **latest supported Drelwick Community release only**.
No public supported release or standalone release artifact exists as of
29 September 2026. Current private development builds are not a support promise
for a published version. Update this policy with the supported release when one
is authorised; older releases do not receive guaranteed backports.

## Reporting a vulnerability privately

**Do not report vulnerabilities through public issues, pull requests or
discussions. Do not attach credentials or real manuscript content.**

The preferred future route is GitHub Private Vulnerability Reporting, through
**Security → Advisories → Report a vulnerability** when enabled. It is **not
currently verified available**: both query and enable requests returned HTTP 404
for this private repository on 29 September 2026. GitHub's
[configuration guidance](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
describes this feature for public repositories. Visibility must not be changed
to activate it during release preparation.

A Drelwick-domain security mailbox will provide an alternative only after it is
configured and tested. No operational address is published yet. Authorised
collaborators should use their existing private project channel to contact
**Darren Pratt** and arrange a secure handoff before sharing vulnerability details.
If you have no verified private route, withhold details until one is provided;
do not fall back to a public issue. Establishing a tested private route remains
a [release blocker](docs/planning/public-release-checklist.md).

Once a private route is established, include the affected version/revision,
platform, impact and minimal reproduction using synthetic data. Share only the
information needed to investigate; never send production secrets or an author's
manuscript. The sole maintainer currently handles security reports.

## Response and disclosure

Reports are handled on a **best-effort basis**. There is no guaranteed
acknowledgement or remediation deadline and no response SLA. We will attempt
coordinated disclosure with reporters where practical and avoid public disclosure
before a reasonable remediation opportunity where circumstances permit.

Please coordinate disclosure timing privately. A report does not authorise
access to other people's data or systems. No bounty, independent response team
or guaranteed fix is promised.
