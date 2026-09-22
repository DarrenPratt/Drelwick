# Local manuscript images

Issue #113 is CORE. Images are local project data; no account, network service,
Pro package or original source path is needed after import. Publishing renderers
are separate work; `readImageAsset` supplies validated local originals to future
renderers.

## Supported input and limits

Import accepts static PNG (`.png`) and JPEG (`.jpg`, `.jpeg`). Both the signature
and decoded content must match the extension. GIF, WebP, animated PNG, SVG, HTML,
executable and other formats are rejected. No SVG parser is invoked.

`IMAGE_LIMITS` in project-model centrally defines a maximum of 20 MiB compressed
file data, 24 million pixels and 12,000 pixels per side. These permit ordinary
book illustrations while bounding memory use. Core reads at most the validated
file size plus one byte, checks PNG chunk bounds/CRCs/end and JPEG end markers,
and performs a full decode with strict warnings, pixel and channel limits. It
rejects malformed/truncated inputs rather than accepting their headers alone.
Decoder errors returned to UI are fixed messages, not paths or payloads.

Core uses pinned `sharp` 0.35.4 for decoding rather than implementing image codecs.
Its [security policy](https://sharp.pixelplumbing.com/security/) maintains the
latest release; [constructor options](https://sharp.pixelplumbing.com/api-constructor/)
provide strict decoding and resource limits. Sharp declares Apache-2.0; the
prebuilt libvips bundle declares LGPL-3.0-or-later. These are open-source
dependencies with no proprietary service requirement. This does not select the
project's licence or complete its release legal review. Preserve notices and
applicable native-library source/relinking obligations when packaging.
[Prebuilt binaries](https://sharp.pixelplumbing.com/install/) support Windows,
macOS and Linux; optional dependencies must be installed. There are no runtime
downloads or hosted conversion calls. Native packaging validation on all supported
platforms remains part of release validation.

## Authoritative storage

The existing `assets/` project root contains:

```text
assets/images/<uuid-v4>/asset.json
assets/images/<uuid-v4>/original.png    (or original.jpg)
```

IDs are generated lowercase UUID v4 values. Original filenames are bounded,
control-free metadata, never path components. Version-1 `asset.json` records
`id`, `mediaType`, `originalFilename`, `width`, `height`, `byteSize` and `sha256`.
Dimensions come from decoded content. The managed location is derived from the
validated ID and media type; no arbitrary persisted path is accepted.

Imported originals are byte-identical to the validated source buffer. Import
does not resize, recompress, crop, recolour or convert them. The editor displays
the local original with CSS; decoded validation buffers are temporary data.
Checksum, size, type and dimensions are checked again on resolution. Copying the
entire project, ZIP backup/restore and complete migration backups include these
files. The source image can be removed without breaking the project.

## Manuscript semantics and controls

An image is a selectable block atom:

```json
{
  "type": "image",
  "attrs": {
    "assetId": "00000000-0000-4000-8000-000000000001",
    "alt": "Synthetic blue illustration",
    "size": "medium"
  }
}
```

`alt` is plain Unicode text, up to 4,000 UTF-16 code units. Empty text is allowed
for decorative images. Insert an image, select it and edit Alternative text or
Image size. Insert, Replace and Remove are native keyboard-operable buttons;
text and size use labelled input/select controls. Selecting an image with the
editor's keyboard navigation exposes the same controls. These changes participate
in undo, dirty tracking, autosave and chapter recovery.

Sizes are `small`, `medium`, `large`, `full`. They describe relative publication
intent, not pixels, margins or print dimensions. The editor uses illustrative
25/50/75/100 percent widths; publishing themes will determine output treatment.
Original pixel dimensions remain in asset metadata. Alt text belongs to each
manuscript occurrence, allowing a shared asset to have different descriptions.

## Privileged boundary and remote content

The restricted preload `dialog.selectImage({ projectId, chapterId })` invokes a
native picker in main. Only main receives its selected path. Main authorizes the
trusted window/main frame/URL, current project identity and chapter membership;
the renderer cannot submit a source or destination path. `images.read` accepts
only current project identity and a strict asset ID and returns validated PNG or
JPEG data, never a filesystem capability. Concurrent requests are bounded by the
existing main operation gate; ordinary editor reads are queued. No Electron
security settings are relaxed.

Core checks every existing ancestor before resolution, rejecting symbolic links,
junctions, non-regular files, hard-linked files, UNC paths, traversal components,
alternate stream syntax and control characters. Destinations use only fixed
names and validated generated IDs inside the approved project. These checks and
the project lock coordinate cooperating application operations; they do not
promise protection against a hostile process concurrently replacing directories.

Manuscript image nodes have no `src`, URL or filesystem path. External HTML image
elements are never parsed as image nodes. Paste is parsed in an inert template
before sanitization, preventing image requests during parsing. Remote images
become an explicit omission notice including their alt text; surrounding visible
prose remains. External HTML drops follow the same sanitizer. File drops request
use of Insert image. No automatic fetch/import occurs.

## Recovery and references

The desktop first flushes pending chapter edits before opening the picker; a
failed save blocks import and keeps the edits available. The core import sequence is:

1. Read and validate the selected local source within the limits.
2. Acquire the existing project operation lock.
3. Exclusively create `assets/images/.import-<uuid>/`; write and flush the
   original and versioned record.
4. Re-read/verify bytes and metadata, then flush the staging directory where
   supported.
5. Publish the complete directory by rename and flush its parent where supported.
6. Return the asset ID. Only then does the editor insert or replace a reference.
7. Existing revision tracking and the atomic chapter writer persist the edit.

Failure before document update leaves the document unchanged. Interrupted staging
is retained and never treated as an asset. Failures after asset publication may
leave a complete unreferenced asset; it is safe to retain. A failed manuscript
save retains dirty editor content and the previous valid file using the existing
autosave/recovery protocol. Retry saving or undo the edit. Replacement never
deletes the old asset, including after a successful save. Undo and history can
therefore still resolve it. Filesystem durability has the same Windows directory
fsync/power-loss limits documented in [project format](project-format.md).

A process crash may retain the existing `.chapter-create.lock`. As with chapter
operations, preserve staging and inspect that lock before retrying writes; this
issue does not automatically reclaim another process's lock. Opening the saved
manuscript does not depend on completing or deleting an interrupted image import.

Remove deletes only the selected document reference. There is no asset deletion
or garbage collection in this issue. `findImageReferences` scans all current
manifest chapters and preserves duplicate occurrences. It is useful for future
publishing input discovery but is deliberately not a deletion authority: history,
unreferenced recovery documents and future cover/reference data may also need an
asset. Retaining all imported assets protects these references.

A missing/damaged asset produces `IMAGE_UNAVAILABLE` and an editor placeholder
with Retry and replacement guidance. Loading/saving the chapter preserves its
node, alt text, size and ID; it never rewrites the manuscript to remove a missing
reference. Restore the complete asset directory or replace the selected image.
Project/chapter opening remains usable. No image bytes, prose, alt text, source
paths or raw error payloads are logged by the image operations.

## Schema compatibility

This adds an image node to the deliberately extensible version-1 ProseMirror
document vocabulary, retaining every previously accepted document unchanged.
The new optional asset records have their own explicit `schemaVersion: 1`.
Project version 2, format descriptor version 1 and chapter component version 1
remain unchanged; no existing manifest/book/chapter is rewritten for assets.
Older editors reject the unsupported image document without silently dropping it.
The existing #111 V1-to-V2 migration remains unchanged and copies image records
and originals through its complete verified backup. Tests migrate a version-1
project containing images and compare the surviving references/bytes. Future
incompatible changes require component versioning and recoverable migration.

## Evidence

- `packages/core/test/image-assets.test.ts`: permitted formats, malformed input,
  limits, paths, seven deterministic import interruptions, failed replacement
  document writes, shared references, missing assets and offline project moves.
- `apps/desktop/test/image-assets-ipc.test.ts`: trusted frame, project/chapter
  authorization, strict payloads, cancellation and content-free errors.
- `apps/desktop/test/image-editor.test.ts`: semantic round trip, editor controls,
  Unicode alt text, size, failed replacement and missing-image preservation.
- `tests/e2e/desktop.spec.ts`: real Electron import, keyboard insertion, semantic
  editing, failed replacement, no pasted-image network requests, and moving and
  reopening the project offline without its source image.

The tiny PNG/JPEG fixtures in `tests/fixtures/synthetic-images.json` are base64
encoded synthetic solid-colour rasters, shared through the fixture helper. They
contain no personal images, external artwork or manuscript content.
