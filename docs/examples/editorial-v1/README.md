# Synthetic proposed editorial files

These are #169 **design examples**, not files the current application can open.
Project schema 3, descriptor schema 2 and chapter schema 2 are intentionally
unsupported by the runtime until #170. All names/content/IDs are synthetic.

- `project/` is a complete minimal proposed project: accepted `red fox`, proposed
  `red quick fox`, one pending insertion and one comment whose fox range maps from
  `[5,8)` to `[11,14)` using real ProseMirror positions.
- `before/` holds exact generation-6 before images for the three changed files;
  the example project is generation 7. Unchanged book/descriptor files are shared.
- `snapshot.json` inventories `project/` as the snapshot's `files/` images.
  `transaction.json` pairs `before/` and `project/` as retained before/after images.
  `draft.json` references the same proposed images and the exact base inventory.
  These manifests illustrate independent managed destinations described by the
  [format contract](../../editorial-format.md); do not place them in a live v2 project.
- `restore-conflict.json` retains a different historical version of the same
  discussion rather than silently overwriting it.
- `revision-groups.json` gives independent deletion, replacement and formatting
  examples against the same accepted base; these three overlapping alternatives
  are **not** one valid pending list.
- `cases.json` records all 35 required scenario contracts and four concrete map
  goldens. The [matrix](../../planning/169-editorial-delivery.md) identifies future
  runtime/failure-injection obligations separately from executable design checks.

The project-model test validates proposed strict schemas, cross-file identities,
hashes, inventory bytes, rejection by today's version gate and scenario coverage.
The desktop test applies slices/maps with the existing pinned TipTap/ProseMirror
schema and exercises existing split/merge functions. Neither test implements
production editorial features, filesystem transactions, a diff engine or exporters.

After `pnpm build`, run:

```sh
pnpm exec vitest run packages/project-model/test/editorial-design-examples.test.ts apps/desktop/test/editorial-design-examples.test.ts
```

Formatting a source JSON changes its **file** hash. Recompute manifest sizes/hashes
and the draft's canonical base-inventory hash after any such edit; document/slice
hashes use canonical-json-v1 and therefore ignore key-order/indentation differences.
The examples deliberately contain private canaries for future export exclusion
tests, not real editorial data.
