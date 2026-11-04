// #133 documentation conformance. Does not implement a production theme importer.
import { expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEditorialJson,
  BookThemeSchema,
  BookPresentationSchema,
} from "../src/index.js";
import {
  checkExampleManifest,
  manifestJsonSchema,
  ThemePackageManifestV1,
  type ExampleManifest,
} from "./design/theme-package-v1.js";

const root = new URL(
  "../../../docs/examples/theme-package-v1/",
  import.meta.url,
);
const bytes = (path: string) => readFile(new URL(path, root));
const read = async (path: string) => parseEditorialJson(await bytes(path));
const hash = (input: Uint8Array) =>
  createHash("sha256").update(input).digest("hex");

it("T01/T06 keeps the proposed schema separate from existing strict runtime contracts", async () => {
  expect(await read("manifest.schema.json")).toEqual(manifestJsonSchema);
  const example = await read("valid/minimal/manifest.json");
  expect(checkExampleManifest(example)).toBeNull();
  expect(BookThemeSchema.safeParse(example).success).toBe(false);
  expect(
    BookPresentationSchema.safeParse({
      schemaVersion: 2,
      projectId: "00000000-0000-4000-8000-000000000133",
      theme: { kind: "custom" },
    }).success,
  ).toBe(false);
});

it.each(["minimal", "ornament"])(
  "T02 validates %s manifest, resource closure and exact declared bytes offline",
  async (name) => {
    const folder = `valid/${name}/`,
      m = ThemePackageManifestV1.parse(await read(`${folder}manifest.json`));
    expect(checkExampleManifest(m)).toBeNull();
    const actual: string[] = [];
    for (const entry of await readdir(new URL(folder, root), {
      recursive: true,
      withFileTypes: true,
    }))
      if (entry.isFile()) {
        actual.push(
          relative(
            fileURLToPath(new URL(folder, root)),
            join(entry.parentPath, entry.name),
          ).replaceAll("\\", "/"),
        );
      }
    const expected = [
      "manifest.json",
      ...m.assets.map((a) => a.path),
      ...m.licenses.map((l) => l.path),
    ].sort();
    expect(actual.sort()).toEqual(expected);
    for (const item of [...m.assets, ...m.licenses]) {
      const data = await bytes(`${folder}${item.path}`);
      expect(data.length, item.path).toBe(item.bytes);
      expect(hash(data), item.path).toBe(item.sha256);
    }
    if (name === "ornament") {
      const image = await bytes(`${folder}assets/dot.png`);
      expect([...image.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([1, 1]);
    }
  },
);

it.each(["minimal", "ornament"])(
  "T02 verifies the known %s ZIP fixture is exactly its declared regular stored entries",
  async (name) => {
    const archive = await bytes(`packages/${name}.drelwick-theme`),
      m = ThemePackageManifestV1.parse(
        await read(`valid/${name}/manifest.json`),
      );
    const expected = new Map<string, Buffer>();
    for (const path of [
      "manifest.json",
      ...m.assets.map((a) => a.path),
      ...m.licenses.map((l) => l.path),
    ])
      expected.set(path, await bytes(`valid/${name}/${path}`));
    const seen = new Map<
      string,
      { offset: number; crc: number; size: number }
    >();
    let offset = 0;
    while (archive.readUInt32LE(offset) === 0x04034b50) {
      const start = offset,
        flags = archive.readUInt16LE(offset + 6),
        method = archive.readUInt16LE(offset + 8),
        crc = archive.readUInt32LE(offset + 14),
        compressed = archive.readUInt32LE(offset + 18),
        expanded = archive.readUInt32LE(offset + 22),
        length = archive.readUInt16LE(offset + 26),
        extra = archive.readUInt16LE(offset + 28);
      expect(flags).toBe(0);
      expect(method).toBe(0);
      expect(extra).toBe(0);
      expect(compressed).toBe(expanded);
      const path = archive
        .subarray(offset + 30, offset + 30 + length)
        .toString("utf8");
      offset += 30 + length;
      const content = archive.subarray(offset, offset + expanded);
      expect(seen.has(path)).toBe(false);
      expect(content).toEqual(expected.get(path));
      expect(crc32(content)).toBe(crc);
      seen.set(path, { offset: start, crc, size: expanded });
      offset += expanded;
    }
    const centralStart = offset;
    let count = 0;
    while (archive.readUInt32LE(offset) === 0x02014b50) {
      const length = archive.readUInt16LE(offset + 28),
        extra = archive.readUInt16LE(offset + 30),
        comment = archive.readUInt16LE(offset + 32),
        path = archive
          .subarray(offset + 46, offset + 46 + length)
          .toString("utf8"),
        local = seen.get(path)!;
      expect(local).toBeDefined();
      expect(extra).toBe(0);
      expect(comment).toBe(0);
      expect(archive.readUInt32LE(offset + 16)).toBe(local.crc);
      expect(archive.readUInt32LE(offset + 20)).toBe(local.size);
      expect(archive.readUInt32LE(offset + 24)).toBe(local.size);
      expect(archive.readUInt32LE(offset + 42)).toBe(local.offset);
      expect((archive.readUInt32LE(offset + 38) >>> 16) & 0xf000).toBe(0x8000);
      offset += 46 + length;
      count++;
    }
    expect(archive.readUInt32LE(offset)).toBe(0x06054b50);
    expect(archive.readUInt16LE(offset + 8)).toBe(count);
    expect(archive.readUInt16LE(offset + 10)).toBe(count);
    expect(archive.readUInt32LE(offset + 12)).toBe(offset - centralStart);
    expect(archive.readUInt32LE(offset + 16)).toBe(centralStart);
    expect(archive.readUInt16LE(offset + 20)).toBe(0);
    expect(offset + 22).toBe(archive.length);
    expect([...seen.keys()].sort()).toEqual([...expected.keys()].sort());
  },
);

it.each([
  ["active-css", "THEME_MANIFEST_INVALID"],
  ["traversal", "THEME_MANIFEST_INVALID"],
  ["future", "THEME_MANIFEST_INVALID"],
  ["missing-font", "THEME_REFERENCE_INVALID"],
  ["rights", "THEME_RIGHTS_UNRESOLVED"],
])("T03/T04 refuses the %s example without mutating it", async (name, code) => {
  const value = await read(`invalid/${name}.manifest.json`),
    before = JSON.stringify(value);
  expect(checkExampleManifest(value)).toBe(code);
  expect(JSON.stringify(value)).toBe(before);
});

it("T04 rejects duplicate JSON keys, invalid UTF-8/scalars and non-finite style numbers", async () => {
  const duplicate = await bytes("invalid/duplicate-key.manifest.json");
  expect(() => parseEditorialJson(duplicate)).toThrow();
  expect(() =>
    parseEditorialJson(new Uint8Array([0xff, 0xfe, 0x00])),
  ).toThrow();
  expect(() => parseEditorialJson('{"name":"\\ud800"}')).toThrow();
  const m = ThemePackageManifestV1.parse(
    await read("valid/minimal/manifest.json"),
  );
  m.style.base.body.lineHeight = Number.NaN;
  expect(checkExampleManifest(m)).toBe("THEME_MANIFEST_INVALID");
});

it("T03/T06 bounds values/capabilities and preserves names without Unicode normalization", async () => {
  const m = ThemePackageManifestV1.parse(
    await read("valid/minimal/manifest.json"),
  );
  m.theme.name = "Cafe\u0301 文庫";
  expect(checkExampleManifest(m)).toBeNull();
  expect(m.theme.name).toContain("e\u0301");
  expect(checkExampleManifest(m, "install", [])).toBe("THEME_UNSUPPORTED");
  m.style.print.bodySizePt = 1000;
  expect(checkExampleManifest(m)).toBe("THEME_MANIFEST_INVALID");
});

it("T07 separates project copying, package sharing, EPUB and PDF permissions", async () => {
  const m = ThemePackageManifestV1.parse(
      await read("valid/ornament/manifest.json"),
    ),
    p = m.licenses[0]!.permissions;
  p.redistributePackage = false;
  p.embedPdf = false;
  expect(checkExampleManifest(m)).toBeNull();
  expect(checkExampleManifest(m, "package-export")).toBe(
    "THEME_RIGHTS_UNRESOLVED",
  );
  expect(checkExampleManifest(m, "epub")).toBeNull();
  expect(checkExampleManifest(m, "pdf")).toBe("THEME_RIGHTS_UNRESOLVED");
  m.style.print.overrides.sceneBreak = {
    variant: "rule",
    spacingEm: 1,
    widthPercent: 25,
    ink: "#333333",
  };
  expect(checkExampleManifest(m, "pdf")).toBeNull();
});

it("T04 rejects dangling/duplicate role references, remote sources and unsupported capabilities", async () => {
  const original = ThemePackageManifestV1.parse(
    await read("valid/minimal/manifest.json"),
  );
  const mutate = (change: (m: ExampleManifest) => void) => {
    const m = structuredClone(original);
    change(m);
    return checkExampleManifest(m);
  };
  expect(mutate((m) => m.fontSets.push(m.fontSets[0]!))).toBe(
    "THEME_REFERENCE_INVALID",
  );
  expect(mutate((m) => (m.style.base.body.fontSet = "missing"))).toBe(
    "THEME_REFERENCE_INVALID",
  );
  expect(
    mutate((m) => m.compatibility.requires.push("font-static-sfnt-v1")),
  ).toBe("THEME_CAPABILITY_INVALID");
  expect(checkExampleManifest({ ...original, script: "remote-code" })).toBe(
    "THEME_MANIFEST_INVALID",
  );
});

it.each([
  "../dot.png",
  "/assets/dot.png",
  "C:/dot.png",
  "//server/share/dot.png",
  "assets\\dot.png",
  "assets/../dot.png",
  "assets/%2e%2e/dot.png",
  "assets/dot.png:stream",
  "assets/con.png",
  "assets/lpt1.png",
  "assets/dot.png.",
  "assets/dot .png",
  "assets/Dot.png",
  "assets/dot.svg",
  "assets/\u0000dot.png",
])("T04 rejects nonportable manifest path %j", async (path) => {
  const m = ThemePackageManifestV1.parse(
    await read("valid/ornament/manifest.json"),
  );
  m.assets[0]!.path = path;
  expect(checkExampleManifest(m)).toBe("THEME_MANIFEST_INVALID");
});

it("T07/T04 checks declared font subset permission and aggregate bytes without pretending to validate font binaries", async () => {
  const m = ThemePackageManifestV1.parse(
      await read("valid/minimal/manifest.json"),
    ),
    notice = ThemePackageManifestV1.parse(
      await read("valid/ornament/manifest.json"),
    ).licenses[0]!;
  m.licenses = [notice];
  const faces = {
    regular: "regular",
    italic: "italic",
    bold: "bold",
    boldItalic: "bold-italic",
  };
  m.fontSets = [
    { id: "body", kind: "assets", faces, fallback: "traditional-serif" },
  ];
  m.assets = Object.values(faces).map((id) => ({
    id,
    kind: "font" as const,
    path: `assets/${id}.ttf`,
    mediaType: "font/ttf" as const,
    bytes: 8 * 1024 ** 2,
    sha256: "0".repeat(64),
    licenseId: notice.id,
  }));
  m.compatibility.requires = ["font-static-sfnt-v1", "style-v2"];
  expect(checkExampleManifest(m)).toBeNull();
  expect(checkExampleManifest(m, "pdf")).toBe("THEME_RIGHTS_UNRESOLVED");
  expect(checkExampleManifest(m, "epub")).toBeNull();
  notice.permissions.subsetFont = true;
  expect(checkExampleManifest(m, "pdf")).toBeNull();
  m.assets.push({ ...m.assets[0]!, id: "extra", path: "assets/extra.ttf" });
  expect(checkExampleManifest(m)).toBe("THEME_LIMIT");
});
