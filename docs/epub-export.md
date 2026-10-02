# Local EPUB export

Drelwick Community exports a reflowable **EPUB 3.3** package entirely on the
local machine. Export begins by flushing the editor and capturing one locked,
path-free manuscript revision with `assembleBook`; the generated EPUB is never
written back into the project and is not an authoritative manuscript source.

The package contains semantic XHTML from the shared book renderer, the selected
local theme as deterministic CSS, the authoritative front/body/back reading
order, publication metadata and language, the selected managed cover image,
and only managed images referenced by the included content. Image IDs become
safe package paths and stored alt text remains in the semantic XHTML. System
font preferences are represented by generic CSS fallback stacks; Community
does not embed fonts because the current theme and asset model does not
establish redistribution rights.

The exporter performs an offline structural EPUB validation before atomic
publication. It checks the required container, package, navigation and
resource entries, safe paths, asset integrity, and generated internal
references. The implementation does not download or require a network EPUB
validator at export time; full EPUBCheck integration remains a release-tooling
follow-up. EPUB output is therefore limited to the EPUB 3.3 constructs emitted
by Drelwick's supported semantic model.

The native save dialog only permits `.epub` destinations outside project
folders. Existing files require explicit confirmation. Packaging occurs in a
temporary sibling file and is published only after validation, preserving a
previous valid destination on failure or cancellation. No remote resources,
scripts, plugin runtime, account, backend, or Pro package is required.
