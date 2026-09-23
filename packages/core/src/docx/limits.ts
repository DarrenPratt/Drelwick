/** Additional expansion limits inside the capability-free DOCX worker. */
export const DOCX_LIMITS = {
  entries: 2048,
  entryBytes: 20 * 1024 * 1024,
  expandedBytes: 96 * 1024 * 1024,
  ratio: 200,
  xmlBytes: 8 * 1024 * 1024,
  xmlDepth: 64,
  xmlNodes: 250_000,
  relationships: 4096,
  paragraphs: 50_000,
  assets: 256,
  assetBytes: 48 * 1024 * 1024,
  warnings: 1000,
} as const;

export const DOCX_ERRORS = {
  DOCX_ZIP:
    "The DOCX ZIP container is malformed, encrypted, or uses an unsupported ZIP feature.",
  DOCX_LIMIT:
    "The DOCX exceeds safe archive, XML, manuscript, image, or warning limits.",
  DOCX_XML:
    "A DOCX XML part is malformed or contains a prohibited declaration or entity.",
  DOCX_PACKAGE:
    "The file is not a supported Word DOCX package, or contains invalid relationships.",
  DOCX_UNSUPPORTED:
    "The DOCX contains macros, embedded objects, alternate content, or another structure that cannot be safely recovered. Convert these to ordinary text/images before importing.",
  DOCX_REVISIONS:
    "The Word document contains tracked changes. Accept or reject revisions in a copy before importing; no revision text was silently selected.",
  DOCX_IMAGE:
    "A DOCX image is missing, malformed, or unsupported. Only embedded static PNG/JPEG images can be imported.",
} as const;
export type DocxErrorCode = keyof typeof DOCX_ERRORS;
export const DOCX_LOCATIONS = [
  "DOCX package",
  "XML part",
  "Main document",
  "Supporting document part",
] as const;
let location: { label: (typeof DOCX_LOCATIONS)[number]; block: number } = {
  label: "DOCX package",
  block: 0,
};
export function locate(label: (typeof DOCX_LOCATIONS)[number], block = 0) {
  location = { label, block };
}
export function diagnosticLocation() {
  return location;
}
export function fail(code: DocxErrorCode): never {
  throw new Error(code);
}
