// #133 documentation conformance ONLY. Not a production schema, importer or API.
import { z } from "zod";

const finite = (min: number, max: number) =>
  z.number().finite().min(min).max(max);
const text = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[^\p{Cc}<>\uD800-\uDFFF]*$/u);
const slug = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const family = z.enum(["traditional-serif", "humanist-sans", "literary-serif"]);
const alignment = z.enum(["left", "center", "right"]);
const ornamentFields = {
  spacingEm: finite(0, 4),
  widthPercent: finite(10, 100),
  ink: z.string().regex(/^#[0-9a-f]{6}$/),
};
const ornament = z.union([
  z.strictObject({
    variant: z.enum(["none", "space", "rule", "diamond"]),
    ...ornamentFields,
  }),
  z.strictObject({
    variant: z.literal("asset"),
    ...ornamentFields,
    assetId: slug,
    fallback: z.enum(["rule", "diamond"]),
  }),
]);
const scale = finite(1, 3);
const groups = z.strictObject({
  body: z.strictObject({
    fontSet: slug,
    sizeRem: finite(0.875, 1.5),
    lineHeight: finite(1.2, 2.5),
    alignment: z.enum(["left", "justify"]),
    indentEm: finite(0, 3),
    spacingEm: finite(0, 2),
  }),
  headings: z.strictObject({
    fontSet: slug,
    weight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
    scale: z.tuple([scale, scale, scale, scale, scale, scale]),
    spaceBeforeEm: finite(0, 4),
    spaceAfterEm: finite(0, 3),
  }),
  chapterOpening: z.strictObject({
    fontSet: slug,
    titleSizeEm: finite(1.2, 4),
    alignment,
    spaceBeforeEm: finite(0, 8),
    spaceAfterEm: finite(0, 6),
    firstParagraph: z.enum(["normal", "flush-first"]),
    ornamentPosition: z.enum(["above", "below"]),
    ornament,
  }),
  sceneBreak: ornament,
  quote: z.strictObject({
    fontSet: slug,
    indentEm: finite(0, 4),
    spacingEm: finite(0, 3),
    fontStyle: z.enum(["normal", "italic"]),
  }),
  epigraph: z.strictObject({
    fontSet: slug,
    alignment,
    widthPercent: finite(50, 100),
    spacingEm: finite(0, 4),
    fontStyle: z.enum(["normal", "italic"]),
    attributionSizeEm: finite(0.75, 1.25),
  }),
});
const faceSet = z.strictObject({
  regular: slug,
  italic: slug,
  bold: slug,
  boldItalic: slug,
});
const fontSet = z.union([
  z.strictObject({ id: slug, kind: z.literal("builtin"), family }),
  z.strictObject({
    id: slug,
    kind: z.literal("assets"),
    faces: faceSet,
    fallback: family,
  }),
]);
const assetFields = { id: slug, sha256: hash, licenseId: slug };
const asset = z.union([
  z.strictObject({
    ...assetFields,
    kind: z.literal("font"),
    path: z.string().regex(/^assets\/[a-z][a-z0-9-]{0,31}\.(ttf|otf)$/),
    mediaType: z.enum(["font/ttf", "font/otf"]),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 ** 2),
  }),
  z.strictObject({
    ...assetFields,
    kind: z.literal("ornament"),
    path: z.string().regex(/^assets\/[a-z][a-z0-9-]{0,31}\.(png|jpg)$/),
    mediaType: z.enum(["image/png", "image/jpeg"]),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(4 * 1024 ** 2),
  }),
]);
const license = z.strictObject({
  id: slug,
  path: z.string().regex(/^licenses\/[a-z][a-z0-9-]{0,31}\.txt$/),
  sha256: hash,
  bytes: z.number().int().min(1).max(65536),
  identifier: text(80),
  copyright: text(500),
  permissions: z.strictObject({
    copyToProject: z.boolean(),
    redistributePackage: z.boolean(),
    embedEpub: z.boolean(),
    embedPdf: z.boolean(),
    subsetFont: z.boolean(),
  }),
});
export const ThemePackageManifestV1 = z.strictObject({
  format: z.literal("drelwick-theme"),
  formatVersion: z.literal(1),
  schemaVersion: z.literal(1),
  theme: z.strictObject({
    id: uuid,
    version: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/),
    name: text(160).min(1),
    creator: text(160),
    description: text(1000),
    rights: z.enum(["author-declared", "unverified"]),
  }),
  compatibility: z.strictObject({
    renderer: z.strictObject({
      min: z.number().int().min(2).max(999),
      maxExclusive: z.number().int().min(3).max(1000),
    }),
    presentation: z.literal(2),
    print: z.literal(3),
    requires: z
      .array(z.enum(["style-v2", "ornament-raster-v1", "font-static-sfnt-v1"]))
      .min(1)
      .max(3),
  }),
  style: z.strictObject({
    schemaVersion: z.literal(2),
    base: groups,
    epub: groups.partial(),
    print: z.strictObject({
      bodySizePt: finite(9, 32),
      overrides: groups.partial(),
    }),
  }),
  fontSets: z.array(fontSet).min(1).max(8),
  assets: z.array(asset).max(32),
  licenses: z.array(license).max(16),
});
export const manifestJsonSchema = z.toJSONSchema(ThemePackageManifestV1, {
  target: "draft-2020-12",
  reused: "ref",
});
export type ExampleManifest = z.infer<typeof ThemePackageManifestV1>;

/** Extra graph/policy rules cannot be proved by JSON Schema alone. Test-only. */
export function checkExampleManifest(
  input: unknown,
  operation: "install" | "package-export" | "epub" | "pdf" = "install",
  capabilities = ["style-v2", "ornament-raster-v1", "font-static-sfnt-v1"],
): string | null {
  const result = ThemePackageManifestV1.safeParse(input);
  if (!result.success) return "THEME_MANIFEST_INVALID";
  const m = result.data;
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (
    !m.theme.name.trim() ||
    m.compatibility.renderer.min >= m.compatibility.renderer.maxExclusive
  )
    return "THEME_MANIFEST_INVALID";
  if (
    !unique(m.assets.map((a) => a.id)) ||
    !unique(m.fontSets.map((f) => f.id)) ||
    !unique(m.licenses.map((l) => l.id))
  )
    return "THEME_REFERENCE_INVALID";
  if (
    !unique([...m.assets.map((a) => a.path), ...m.licenses.map((l) => l.path)])
  )
    return "THEME_REFERENCE_INVALID";
  const allGroups = [m.style.base, m.style.epub, m.style.print.overrides];
  if (
    [...m.assets, ...m.licenses].some((item) =>
      /(^|\/)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item.path),
    )
  )
    return "THEME_MANIFEST_INVALID";
  for (const style of allGroups)
    for (const [key, group] of Object.entries(style)) {
      if (!group) return "THEME_MANIFEST_INVALID";
      if ("fontSet" in group && !m.fontSets.some((f) => f.id === group.fontSet))
        return "THEME_REFERENCE_INVALID";
      const decoration =
        key === "sceneBreak"
          ? style.sceneBreak
          : key === "chapterOpening"
            ? style.chapterOpening?.ornament
            : null;
      if (
        decoration?.variant === "asset" &&
        !m.assets.some(
          (a) => a.id === decoration.assetId && a.kind === "ornament",
        )
      )
        return "THEME_REFERENCE_INVALID";
    }
  for (const set of m.fontSets)
    if (set.kind === "assets") {
      const faces = Object.values(set.faces);
      if (
        !unique(faces) ||
        faces.some(
          (id) => !m.assets.some((a) => a.id === id && a.kind === "font"),
        )
      )
        return "THEME_REFERENCE_INVALID";
    }
  let fontBytes = 0,
    imageBytes = 0;
  for (const entry of m.assets) {
    const notice = m.licenses.find((l) => l.id === entry.licenseId);
    if (!notice) return "THEME_REFERENCE_INVALID";
    if (
      (entry.path.endsWith(".png") && entry.mediaType !== "image/png") ||
      (entry.path.endsWith(".jpg") && entry.mediaType !== "image/jpeg") ||
      (entry.path.endsWith(".ttf") && entry.mediaType !== "font/ttf") ||
      (entry.path.endsWith(".otf") && entry.mediaType !== "font/otf")
    )
      return "THEME_MANIFEST_INVALID";
    if (
      !notice.permissions.copyToProject ||
      (operation === "package-export" &&
        !notice.permissions.redistributePackage)
    )
      return "THEME_RIGHTS_UNRESOLVED";
    if (entry.kind === "font") fontBytes += entry.bytes;
    else imageBytes += entry.bytes;
  }
  if (
    fontBytes > 32 * 1024 ** 2 ||
    imageBytes > 16 * 1024 ** 2 ||
    m.assets.filter((a) => a.kind === "font").length > 16 ||
    m.assets.filter((a) => a.kind === "ornament").length > 16
  )
    return "THEME_LIMIT";
  const required = [
    "style-v2",
    ...(m.assets.some((a) => a.kind === "font") ? ["font-static-sfnt-v1"] : []),
    ...(m.assets.some((a) => a.kind === "ornament")
      ? ["ornament-raster-v1"]
      : []),
  ].sort();
  if (
    !unique(m.compatibility.requires) ||
    JSON.stringify(m.compatibility.requires) !== JSON.stringify(required)
  )
    return "THEME_CAPABILITY_INVALID";
  if (
    m.compatibility.renderer.min > 2 ||
    m.compatibility.renderer.maxExclusive <= 2 ||
    required.some((c) => !capabilities.includes(c))
  )
    return "THEME_UNSUPPORTED";
  const selected = {
    ...m.style.base,
    ...(operation === "epub"
      ? m.style.epub
      : operation === "pdf"
        ? m.style.print.overrides
        : {}),
  };
  const targetAssets = new Set<string>();
  for (const [key, group] of Object.entries(selected)) {
    if (!group) return "THEME_MANIFEST_INVALID";
    if ("fontSet" in group) {
      const set = m.fontSets.find((f) => f.id === group.fontSet);
      if (set?.kind === "assets")
        Object.values(set.faces).forEach((id) => targetAssets.add(id));
    }
    const ornament =
      key === "sceneBreak"
        ? selected.sceneBreak
        : key === "chapterOpening"
          ? selected.chapterOpening?.ornament
          : null;
    if (ornament?.variant === "asset") targetAssets.add(ornament.assetId);
  }
  for (const entry of m.assets.filter((asset) => targetAssets.has(asset.id))) {
    const permission = m.licenses.find(
      (l) => l.id === entry.licenseId,
    )!.permissions;
    if (
      (operation === "epub" && !permission.embedEpub) ||
      (operation === "pdf" &&
        (!permission.embedPdf ||
          (entry.kind === "font" && !permission.subsetFont)))
    )
      return "THEME_RIGHTS_UNRESOLVED";
  }
  return null;
}
