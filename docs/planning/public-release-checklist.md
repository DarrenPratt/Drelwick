# Public Community release gate

Status: **not completed**. Repository stays private. The v0.3 Community candidate is a review target, not permission to publish. Record reviewer, date and evidence for every item; creating an issue does not satisfy a legal or security gate.

Contributor preparation for #54: the [proposed strategy](../contributor-copyright-strategy.md),
[CLA requirements](../contributor-cla-requirements.md) and
[contribution guide](../../CONTRIBUTING.md) record the owner's intended retained
copyright + CLA + DCO 1.1 model. #53 records the intended `AGPL-3.0-only` selection;
legal review and final licensing approval remain pending. These documents do not
complete the agreement process or clear any checklist item below. External
contributions remain blocked until #54 and the Licensing & Commercial Architecture
milestone are complete.

Branding preparation for #59: the [proposed policy](../branding-distribution-policy.md)
and [asset/decision review](59-branding-review.md) separate source rights, artwork
permissions and official status. **Legal review: pending.** The branding gate is
documentationally prepared, awaiting professional review and owner approval of
unresolved permissions, including exact-artifact mirroring. Record the reviewer,
date, scope, final artwork terms and owner approval before clearing the gate.
Review the original logo's full C2PA metadata for sensitive information; the limited
inventory inspection is not privacy signoff. Preserve tool-origin provenance
unless a separately reviewed privacy/security concern requires remediation.

- [ ] Scan full Git history, branches and tags for secrets; also review current files, release assets and relevant Actions artifacts/logs.
- [ ] Review credentials and tokens; revoke/rotate any exposed credential and assess history remediation before release.
- [ ] Review private URLs, personal information and private/internal documentation, including example content and audit artifacts.
- [ ] Review Community licence with appropriate legal advice; intended `AGPL-3.0-only` selection still requires final approval under #53.
- [ ] Prepare the approved LICENSE and accurate README licensing statement.
- [ ] Audit dependency, bundled asset/font/theme and redistributed binary licences.
- [ ] Approve contributor/copyright/dual-licensing strategy and any required agreements before external contributions.
- [ ] Prepare and review CONTRIBUTING.md against that approved strategy.
- [ ] Prepare and review CODE_OF_CONDUCT.md and its enforcement/contact process.
- [ ] Prepare and review SECURITY.md with a working private vulnerability-reporting route and support policy.
- [ ] Approve trademark, fork branding and official-build/distribution policy.
- [ ] Complete Community/Pro feature and package boundary review; verify Community builds/tests without Pro.
- [ ] Publishable project-format specification includes UTF-8, schemas, versions, ordering, migration, assets and independent recovery examples.
- [ ] Review extension API security/versioning and ensure optional extensions cannot hold manuscripts hostage.
- [ ] Complete v0.1 reliability validation (#51), standalone packaging (#107), and the offline DOCX-to-EPUB publishing gate before advertising the v0.3 publishing candidate; record platform limitations. Optional provider backup and later print delivery are not prerequisites for this EPUB candidate.
- [ ] Verify CI is green and appropriate merge checks are enforced.
- [ ] Verify issue/PR templates, contribution settings, README and release documentation are ready.
- [ ] Complete the Licensing & Commercial Architecture milestone and public-release preparation issue, with evidence.
- [ ] Obtain an explicit release decision before changing visibility or publishing artifacts.

Deleting a secret from the current working tree does not remove it from Git history. This checklist is preparation, not a claim that a scan, legal review or release approval has occurred.
