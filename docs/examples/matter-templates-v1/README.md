# Matter template v1 design fixtures

These synthetic, offline JSON examples describe the proposed
[#134 contract](../../planning/local-matter-templates.md), not an installed library.
`examples.drelwick-matter.json` contains five individual pages and an ordered
collection: title, copyright, dedication, acknowledgements, about the author.
It includes two deliberately selected export profiles, Robin Vale and Alex Reed.
Real exports exclude identities unless explicitly selected.

`document` is existing semantic JSON. `bindings` target whole text leaves by
`content` indexes; they are not executable expressions or text-search tokens.
For example `[1,0]` means `document.content[1].content[0]`. Title resolves to the
captured publication title and selected pen name. Copyright requires explicit
`input.copyrightYear` and `input.rightsHolder`. About the author resolves the
selected profile’s name and biography. Dedication/acknowledgements are literal.

The conformance test declares the portable shape in strict test-only Zod,
validates semantic documents and binding references, resolves both identities,
and checks results against the unchanged production `PublicationSchema` v1.
It checks exact order and expected text plus invalid versions, properties, IDs,
paths, keys, image references and unsafe semantic content. These checks prove
fixture conformance, not a safe runtime importer or persistence implementation.
The specification additionally requires bounded strict JSON decoding, timestamp
ordering, traversal limits and transactional/security tests in the follow-ups.

Run after a workspace build:

```sh
pnpm exec vitest run packages/project-model/test/matter-template-design-examples.test.ts
```

No HTML, JavaScript, CSS, expression evaluator, assets, real personal data or
third-party boilerplate is included. Copyright text demonstrates substitutions;
it does not establish legal rights or replace an author’s review.
