# #58 public format review

This CORE change documents the implementation at base `5cad768` (including the
merged #57 extension design) without changing a schema, writer, package graph or
application behavior. The [public specification](../project-format-specification.md)
is the portable contract; source references here record how it was checked.

## Dependencies and evidence

#11 and #12 are closed: their project-model/persistence work supplies the format
being documented. #110 (local archives), #111 (migration), #113 (managed images)
and #123 (publication metadata/matter) are also closed and implemented. #55 is
closed and PR #196 merged; the existing Community/Pro check remains unchanged.
No proprietary package, plugin runtime or Pro data mechanism is introduced.
Reference/story-bible schemas and provider protocols are not implemented by #58.

| Subject                   | Implementation cross-check                                                                                                                                             | Conclusion reflected in the specification                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema/type envelopes     | `packages/project-model/src/versions/v1.ts`, `versions/v2.ts`, `index.ts`; `packages/shared/src/index.ts`                                                              | Current manifest v2; explicit descriptor v1; book/chapter v1; UUID/date fields, statuses, cache/history/archive envelopes. Types derive from the same runtime schemas.                 |
| Creation/open/save/order  | `packages/core/src/index.ts`, project-loading and persistence tests                                                                                                    | Fixed filenames, manifest array order, chapter identity checks, optional cache, recoverable single-file writes. Current project open is not exhaustive component validation.           |
| Semantic content          | `packages/project-model/src/manuscript-document.ts`, semantic tests; editor node implementations under `apps/desktop/src/renderer/`                                    | Strict supported node/mark vocabulary, safe link forms, broad historical envelope versus strict editor load/save. No rendered HTML as master.                                          |
| Migration                 | `packages/project-model/src/migration.ts`, `packages/core/src/project-migration.ts`, `migration-state.ts`, `project-snapshot.ts`, migration tests                      | Fixed v1→v2 transition, descriptor-before-manifest commit, byte preservation, verified copies, interruption checks, unsupported-newer rejection and no downgrade.                      |
| Archives                  | `packages/core/src/project-archive.ts`, `ProjectArchiveManifestSchema`, archive tests                                                                                  | Standard ZIP, exact inventory/size/SHA-256 verification, filtered inclusion, optional history, separate new restore destination.                                                       |
| Images                    | `packages/project-model/src/image-assets.ts`, `packages/core/src/image-assets.ts`, image tests                                                                         | Managed UUID directories, original PNG/JPEG, checked metadata/bytes/dimensions, no remote authoritative resource.                                                                      |
| Publication               | `packages/shared/src/publication-contracts.ts`, `packages/project-model/src/publication.ts`, `packages/core/src/publication.ts`, `book-assembly.ts`, publication tests | Metadata and semantic matter inside `publication.json`; placement-filtered page order plus manifest body order; overrides never reorder chapters; independent flags and managed cover. |
| Presentation              | `packages/project-model/src/book-theme.ts`, `packages/core/src/book-presentation.ts`, theme tests                                                                      | Selection-only `presentation.json`, built-in fallback, no custom CSS/font files implied by reserved directory.                                                                         |
| History/recovery          | `packages/core/src/history.ts`, `recovery.ts`, `manuscript-replacement.ts`, existing recovery/history tests                                                            | Content-only snapshots, deleted chapter envelopes, temporaries and journals are auxiliary recovery material; no complete backup or synchronization guarantee.                          |
| Portability and ownership | `docs/technical-spec.md`, #55 / PR #196, `scripts/check-community-boundary.mjs`                                                                                        | Community-owned persistent schemas and local assets; no Pro, backend, account, credential or decryption dependency.                                                                    |

These links are an audit trail, not additional fields readers need to implement.
The original deterministic v1 fixtures remain migration regression inputs. The new
fixture uses v2 directly and exercises components added since those fixtures.

## Corrections to older documentation

- The technical specification's prospective snippets are architecture examples,
  not the public persistent schema. Its introduction and Community boundary now
  point to the normative implemented-format document.
- The v2 transition did not itself add assets/themes/matter; those additive v1
  components have since landed. The older migration document now says so rather
  than implying that all remain future work.
- `frontmatter/` and `backmatter/` are reserved directories. Actual current matter
  pages live in `publication.json`; reference data and custom styles have no
  implemented schema. The example does not invent files for these directories.
- The backup guide omitted the implemented `publication.json` allowlist entry and
  claimed ZIP CRC verification. It now states the actual explicit uncompressed
  length and SHA-256 checks, without promising independent CRC verification.
- Complete migration snapshots exclude both schema and publication migration
  workspaces and the operation lock, not only the schema migration workspace.
- Unknown-field acceptance is not lossless preservation. A focused test demonstrates
  that a content save retains an unknown chapter-envelope field while a rename
  drops it; strict semantic/component schemas reject unknown structures.
- UTF-8 is explicit, with no BOM, no normalization guarantee and no mandatory LF
  input requirement. The current decoder can replace malformed UTF-8 bytes; the
  example helper detects such damage using fatal decoding. No runtime encoding
  behavior is changed in this documentation issue.

## Synthetic example and recovery exercise

`tests/fixtures/public-example/` contains nine JSON files and a 96-byte synthetic
PNG: project/descriptor/book, two chapters, publication, presentation, one image
record and one manual history snapshot. UUIDs and dates are deterministic; credits
are fictional. It covers every currently supported semantic node and mark, mixed
scripts, emoji and decomposed combining Unicode. Manifest order is `…902, …901`;
publication body overrides use the reverse sequence, while the back page appears
before front pages in its storage array. The shared image is an inline image and
the selected cover. A hidden dedication is intentionally still recoverable.

On 2026-09-28, a disposable copy/archive exercise on Windows used:

1. Production archive creation from the canonical fixture (read-only source).
2. PowerShell `Expand-Archive` into a fresh directory, without Drelwick restore.
3. `Get-Content -Raw -Encoding utf8 | ConvertFrom-Json` for archive/project JSON;
   `Get-Item` and `Get-FileHash -Algorithm SHA256` for every payload inventory entry.
4. Manifest-array iteration to open the chapter JSON files using ordinary tools.
5. A copy of `recover-project-text.mjs` in the temporary directory, using Node's
   standard library only, to extract all matter/body prose and locate the image.

Result: **10 payload files** matched their recorded lengths and hashes. The v2
manifest resolved `…902` before `…901`. **Five semantic documents** were recovered
(front title, hidden dedication, two chapters, back author), including multilingual
text and the exact decomposed combining sequence. **One 96-byte PNG** resolved and
matched its asset hash. The extracted archive envelope was inspectable as ordinary
JSON. No Drelwick application, restore API, network, account, Pro or proprietary
software was used for extraction/inspection/recovery. The optional helper is not
mandatory; the public specification explains manual tree traversal and asset paths.

`packages/core/test/public-project-format.test.ts` makes this repeatable with five
focused tests. It validates production schemas/loader/assembly, every referenced
chapter and asset, exact recovery text, an isolated helper, ordinary ZIP extraction,
checksum/byte equality, production restore, archives without history, actual
save/reopen, Unicode/newline/BOM behavior and the unknown-data limits. No duplicate
schema or second editor is introduced.

## Acceptance review

| #58 requirement                                 | Evidence                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation-independent public specification | Complete file/field/node/mark definitions, paths, references and ordinary-tool instructions in `docs/project-format-specification.md`; source audit is separate here.              |
| UTF-8                                           | Explicit no-BOM rule and writer/reader distinction; synthetic multilingual/combining text; byte round-trip and BOM/newline tests.                                                  |
| Versions and migration                          | Manifest/component version matrix, current transition, backups/staging, failure behavior, no downgrade or speculative compatibility. Existing migration regression suite retained. |
| Chapters and authoritative ordering             | Exact semantic vocabulary and tree recovery; manifest order differs from filenames and publication overrides; production loading/assembly and golden recovery assertions.          |
| Assets/publication/reference reality            | Managed original plus matching metadata and shared references; implemented matter and independent metadata; reserved reference/style directories explicitly lack schemas.          |
| Recovery without Drelwick                       | Documented manual procedure, actual PowerShell ZIP/JSON/hash exercise, standalone read-only helper executed outside the repository.                                                |
| Local history/archive/provider distinctions     | Content snapshots versus filtered checksummed ZIP versus complete migration recovery copies; explicit provider non-authority and explicit-restore invariant. No provider protocol. |
| Synthetic valid example                         | Production schemas and loader validate all components; actual writer and archive round-trips; excluded drafts remain recoverable.                                                  |
| Community independence                          | No dependency or runtime changes. Existing #55 architecture tests and workspace check cover all Community packages without Pro present.                                            |

## Checks executed

On Windows with the repository's Node 24 / pnpm 10 toolchain:

- `pnpm install --frozen-lockfile` passed.
- `pnpm lint`, `pnpm format:check` and `pnpm typecheck` passed.
- `pnpm test` passed: 80 files, 938 tests, including the five new format tests
  and the existing migration, archive, persistence and recovery suites.
- `pnpm build` passed. Vite emitted its existing non-failing bundle-size advisory.
- `pnpm check:workspace` passed, including all 20 architecture tests, the six
  Community workspace inventory check and the built workspace smoke test.
- `git diff --check` passed. Package manifests, lockfile, application/runtime
  sources and the package graph are unchanged.

Electron/Playwright E2E and coverage collection were not run: this change adds
documentation, fixtures and a standalone recovery example, with no application UI
or runtime behavior change. The required CI quality scripts above were all run.

## Deferred work

This change introduces no persistent schema or app behavior. Future reference,
custom theme/font, print/publishing, Pro metadata or provider data structures must
update the specification when implemented, with their own migration/preservation
policy. General unknown-field round-trip preservation and stricter malformed UTF-8
handling would be separate compatibility work, not guarantees added by prose here.
The helper deliberately does not repair corrupt JSON, replay journals, edit
projects, recover every auxiliary file automatically or reproduce formatting in a
second editor. Full raw copies remain important for damaged/interrupted projects.
