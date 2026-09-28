// Optional read-only example of ordinary JSON recovery. No Drelwick imports,
// dependencies, application startup, migration, writes or network access.
// This extracts readable text, not a lossless replacement for the original JSON.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.argv[2];
if (!root)
  throw new Error("Usage: node recover-project-text.mjs <copied-project>");
const directory = resolve(root);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checkedId = (value) => {
  if (typeof value !== "string" || !uuid.test(value))
    throw new Error("Unsupported file identity; inspect the original JSON.");
  return value;
};
async function bytes(parts) {
  let file = directory;
  for (const part of ["", ...parts]) {
    file = join(file, part);
    const info = await lstat(file);
    if (info.isSymbolicLink())
      throw new Error("Use a copy without linked paths.");
  }
  const info = await lstat(file);
  if (!info.isFile() || info.size > 64 * 1024 * 1024)
    throw new Error("Unsupported recovery input size or file type.");
  return readFile(file);
}
async function json(parts) {
  // Fatal decoding detects damaged UTF-8 instead of silently replacing bytes.
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await bytes(parts),
    ),
  );
}
async function optionalJson(name) {
  try {
    return await json([name]);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}
const blockTypes = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "epigraph",
  "listItem",
  "bulletList",
  "orderedList",
  "codeBlock",
]);
function recoverDocument(document) {
  const assets = new Set();
  const links = new Set();
  function visit(node, depth = 0) {
    if (depth > 64) throw new Error("Inspect deeply nested content manually.");
    for (const mark of node.marks ?? [])
      if (mark.type === "link") links.add(mark.attrs.href);
    if (node.type === "text") return node.text;
    if (node.type === "hardBreak") return "\n";
    if (node.type === "image") {
      assets.add(checkedId(node.attrs.assetId));
      return `[Image: ${node.attrs.alt}]\n`;
    }
    if (node.type === "sceneBreak") return "[Scene break]\n";
    if (node.type === "horizontalRule") return "[Horizontal rule]\n";
    if (node.type !== "doc" && !blockTypes.has(node.type))
      throw new Error(
        "Unsupported node; retain and inspect the original JSON.",
      );
    let value = (node.content ?? [])
      .map((child) => visit(child, depth + 1))
      .join("");
    if (node.type === "epigraph" && node.attrs?.attribution)
      value += `${node.attrs.attribution}\n`;
    if (blockTypes.has(node.type) && !value.endsWith("\n")) value += "\n";
    return value;
  }
  return { text: visit(document), assetIds: [...assets], links: [...links] };
}
const project = await json(["project.json"]);
if (![1, 2].includes(project.schemaVersion) || project.bookFile !== "book.json")
  throw new Error("Unsupported project; consult its format specification.");
if (project.schemaVersion === 2) {
  const format = await json(["format.json"]);
  if (
    project.formatFile !== "format.json" ||
    format.schemaVersion !== 1 ||
    format.projectId !== project.projectId ||
    format.bookSchemaVersion !== 1 ||
    format.chapterSchemaVersion !== 1
  )
    throw new Error("Unsupported component versions or mismatched identity.");
}
const book = await json(["book.json"]);
const publication = await optionalJson("publication.json");
if (
  book.schemaVersion !== 1 ||
  (publication &&
    (publication.schemaVersion !== 1 ||
      publication.projectId !== project.projectId))
)
  throw new Error("Unsupported metadata or mismatched identity.");
const documents = [];
const addMatter = (placement) => {
  for (const page of publication?.pages ?? [])
    if (page.placement === placement)
      documents.push({
        section: placement,
        id: page.id,
        title: page.title,
        inclusion: page.inclusion,
        ...recoverDocument(page.document),
      });
};
addMatter("front");
for (const id of project.manuscript.order) {
  const chapter = await json(["manuscript", `${checkedId(id)}.json`]);
  if (chapter.schemaVersion !== 1 || chapter.id !== id)
    throw new Error("Unsupported chapter or mismatched identity.");
  documents.push({
    section: "body",
    id,
    title: chapter.title,
    ...recoverDocument(chapter.content),
  });
}
addMatter("back");
const assetIds = new Set(documents.flatMap((document) => document.assetIds));
if (publication?.coverAssetId)
  assetIds.add(checkedId(publication.coverAssetId));
const assets = [];
for (const id of assetIds) {
  const parts = ["assets", "images", id];
  const asset = await json([...parts, "asset.json"]);
  const suffix = { "image/png": "png", "image/jpeg": "jpg" }[asset.mediaType];
  if (asset.schemaVersion !== 1 || asset.id !== id || !suffix)
    throw new Error("Unsupported image record or mismatched identity.");
  const original = [...parts, `original.${suffix}`];
  const data = await bytes(original);
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (data.length !== asset.byteSize || sha256 !== asset.sha256)
    throw new Error(
      "Image checksum/size mismatch; preserve the original files.",
    );
  assets.push({
    id,
    path: original.join("/"),
    originalFilename: asset.originalFilename,
    byteSize: data.length,
    sha256,
  });
}
// Output is deliberately requested manuscript recovery, not application logging.
process.stdout.write(
  `${JSON.stringify(
    {
      projectId: project.projectId,
      book,
      publicationMetadata: publication?.metadata,
      documents,
      assets,
    },
    null,
    2,
  )}\n`,
);
