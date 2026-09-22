# Manuscript semantic elements

Issue #112 makes the publishing vocabulary an explicit contract shared by the
project model, editor and paste conversion. Manuscript JSON records meaning;
editor and publication themes decide appearance.

Issue #113 adds a block `image` node with strict `assetId`, `alt` and `size`
attributes. It resolves only project-managed PNG/JPEG originals. Size is one of
`small`, `medium`, `large`, `full`; alt text is Unicode manuscript content. See
[local images](local-image-assets.md) for controls, missing-asset recovery,
portable storage and the additive schema compatibility decision.

## Supported document vocabulary

The existing paragraph, block quote, scene break, horizontal rule, hard break
and code-block structures remain supported. Existing bold, italic, underline,
strike and code marks also remain supported. The publishing elements added to
the visible authoring workflow are:

| Element       | Persisted meaning                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Heading       | A `heading` block with integer `level` 1 through 6. It is not a chapter title and contains inline manuscript content.                  |
| Bullet list   | A `bulletList` containing one or more `listItem` nodes.                                                                                |
| Numbered list | An `orderedList` containing one or more `listItem` nodes and an optional integer start value.                                          |
| Nested list   | A list within a list item after that item's required leading paragraph. Bullet and numbered lists may be mixed at any supported depth. |
| Link          | A `link` mark on text with a validated semantic destination.                                                                           |
| Epigraph      | An `epigraph` block containing one or more paragraphs, with an optional plain-text `attribution` attribute.                            |

An epigraph does not store alignment, font, ornament, spacing or other visual
properties. Its editor treatment is only a writing aid. Future book renderers
and themes are responsible for publication styling.

## Link policy

Links may use absolute `http:` or `https:` URLs, `mailto:` addresses, or a
non-empty `#fragment` within a publication. Leading/trailing whitespace,
control characters, relative and protocol-relative URLs, local-file targets
and executable/data schemes are rejected. The same
`isSupportedManuscriptLink` policy is used by project-model validation, editor
commands and HTML paste handling.

The editor does not navigate links while they are being authored. Link display
attributes emitted by TipTap are retained for compatibility, but no manuscript
mark stores typography or theme styling.

## Paste and unsupported input

HTML paste keeps supported headings, paragraphs, inline marks, block quotes,
lists (including nesting and ordered starts), safe links and BookEditor
epigraphs. Presentation styles, event handlers and unrelated attributes are
removed. Unsupported wrappers are unwrapped so their text and supported child
content remain available rather than disappearing. Unsafe links are converted
to their visible prose. Executable or embedded elements such as scripts,
styles, frames and objects are removed as untrusted content.

The sanitized HTML is parsed through the same TipTap schema whose JSON output
is accepted by `ManuscriptDocumentSchema`. Core load, save and history services
then validate that contract again before reading or writing authoritative data.
Unknown JSON nodes, marks, attributes and invalid nesting fail explicitly; the
existing file remains untouched.

## Format and migration compatibility

This work does not change the chapter envelope or rewrite project files. Version
1 chapter files already store a ProseMirror document, while project format v2's
`format.json` independently records `chapterSchemaVersion: 1`. The deliberate
contract retains every node, mark and nesting form used by the existing
canonical fixtures and editor tests, including empty documents, code blocks and
horizontal rules. Epigraph is an additive node within that existing document
envelope, so no project or chapter migration is required.

Future changes that cannot read an existing accepted document unchanged must
introduce a new chapter component version and a recoverable migration through
the versioned migration framework. They must not redefine chapter schema 1 or
silently normalize manuscript content.
