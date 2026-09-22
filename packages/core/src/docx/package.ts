import { Inflate } from "fflate";
import sax from "sax";
import { DOCX_LIMITS as L, fail } from "./limits.js";

export interface Xml {
  name: string;
  attrs: Record<string, string>;
  children: Xml[];
  text: string;
}
export const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
  dc: "http://purl.org/dc/elements/1.1/",
  cp: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
} as const;
function qualified(uri: string, local: string) {
  const prefix = Object.entries(NS).find(([, value]) => value === uri)?.[0];
  return uri ? `${prefix ?? uri}:${local}` : local;
}
export const child = (n: Xml | undefined, name: string) =>
  n?.children.find((c) => c.name === name);
export const all = (n: Xml | undefined, name: string): Xml[] =>
  n?.children.flatMap((c) => (c.name === name ? [c] : all(c, name))) ?? [];
export const val = (n: Xml | undefined) => n?.attrs["w:val"];
export function hasControls(value: string) {
  for (const c of value) {
    const cp = c.codePointAt(0)!;
    if (cp <= 32 || cp === 127) return true;
  }
  return false;
}
function invalidXmlCharacters(value: string) {
  for (const c of value) {
    const cp = c.codePointAt(0)!;
    if (
      (cp < 32 && ![9, 10, 13].includes(cp)) ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      cp === 0xfffe ||
      cp === 0xffff
    )
      return true;
  }
  return false;
}

/** Fatal UTF-8 decoding, also supports BOM-marked UTF-16 XML. No normalization. */
export function decode(bytes: Uint8Array): string {
  if (
    (bytes[0] === 255 && bytes[1] === 254) ||
    (bytes[0] === 254 && bytes[1] === 255)
  ) {
    if (bytes.length % 2) fail("DOCX_XML");
    const little = bytes[0] === 255;
    let s = "";
    for (let i = 2; i < bytes.length; i += 2)
      s += String.fromCharCode(
        little
          ? bytes[i]! | (bytes[i + 1]! << 8)
          : (bytes[i]! << 8) | bytes[i + 1]!,
      );
    if (/[\uD800-\uDFFF]/u.test(s)) fail("DOCX_XML");
    return s;
  }
  // decodeURIComponent rejects overlong sequences, surrogate encodings and truncation.
  try {
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length;) {
      let end = Math.min(i + 4096, bytes.length);
      while (end < bytes.length && end > i && (bytes[end]! & 0xc0) === 0x80)
        end--;
      if (end === i) fail("DOCX_XML");
      const escaped = Array.from(
        bytes.subarray(i, end),
        (b) => `%${b.toString(16).padStart(2, "0")}`,
      ).join("");
      chunks.push(decodeURIComponent(escaped));
      i = end;
    }
    return chunks.join("").replace(/^\uFEFF/, "");
  } catch {
    return fail("DOCX_XML");
  }
}
export function xml(bytes: Uint8Array, budget = { nodes: 0 }): Xml {
  if (bytes.length > L.xmlBytes) fail("DOCX_LIMIT");
  const source = decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(source) || invalidXmlCharacters(source))
    fail("DOCX_XML");
  const options = {
    xmlns: true,
    strictEntities: true,
    trim: false,
    normalize: false,
  };
  const parser = sax.parser(true, options);
  const stack: Xml[] = [];
  let root: Xml | undefined;
  const attributes = new Set<string>();
  parser.onopentagstart = () => {
    attributes.clear();
  };
  parser.onattribute = (raw) => {
    const a = raw as sax.QualifiedAttribute;
    const key = qualified(a.uri, a.local);
    if (attributes.has(key) || invalidXmlCharacters(a.value)) fail("DOCX_XML");
    attributes.add(key);
  };
  parser.onerror = () => fail("DOCX_XML");
  parser.ondoctype = parser.onsgmldeclaration = () => fail("DOCX_XML");
  parser.onprocessinginstruction = (p) => {
    if (
      p.name !== "xml" ||
      root !== undefined ||
      !/^version=["']1\.0["'](?:\s+encoding=["'](?:UTF-8|UTF-16|utf-8|utf-16)["'])?(?:\s+standalone=["'](?:yes|no)["'])?\s*$/.test(
        p.body,
      )
    )
      fail("DOCX_XML");
  };
  parser.onopentag = (tag) => {
    if (++budget.nodes > L.xmlNodes || stack.length >= L.xmlDepth)
      fail("DOCX_LIMIT");
    const t = tag as sax.QualifiedTag;
    const node: Xml = {
      name: qualified(t.uri, t.local),
      attrs: Object.create(null) as Record<string, string>,
      children: [],
      text: "",
    };
    for (const a of Object.values(t.attributes)) {
      const key = qualified(a.uri, a.local);
      if (key in node.attrs) fail("DOCX_XML");
      node.attrs[key] = a.value;
    }
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    else {
      if (root) fail("DOCX_XML");
      root = node;
    }
    stack.push(node);
  };
  parser.onclosetag = () => {
    stack.pop();
  };
  parser.ontext = parser.oncdata = (text) => {
    if (invalidXmlCharacters(text)) fail("DOCX_XML");
    if (stack.length) stack[stack.length - 1]!.text += text;
    else if (text.trim()) fail("DOCX_XML");
  };
  for (let i = 0; i < source.length;) {
    let end = Math.min(i + 4096, source.length);
    if (
      end < source.length &&
      source.charCodeAt(end - 1) >= 0xd800 &&
      source.charCodeAt(end - 1) <= 0xdbff
    )
      end--;
    parser.write(source.slice(i, end));
    i = end;
  }
  parser.close();
  if (!root || stack.length) fail("DOCX_XML");
  return root;
}

export function safePath(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 240 &&
    !/[\\:%?#]/u.test(name) &&
    !hasControls(name) &&
    !name.startsWith("/") &&
    name.split("/").every((p) => p !== ".." && p !== "." && p !== "")
  );
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Preflight central AND local headers; never extract paths to the filesystem. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22 || bytes.length > 64 * 1024 * 1024) fail("DOCX_ZIP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => {
    if (p < 0 || p + 2 > bytes.length) fail("DOCX_ZIP");
    return view.getUint16(p, true);
  };
  const u32 = (p: number) => {
    if (p < 0 || p + 4 > bytes.length) fail("DOCX_ZIP");
    return view.getUint32(p, true);
  };
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50)
    end--;
  if (
    end < 0 ||
    u32(end) !== 0x06054b50 ||
    end + 22 + u16(end + 20) !== bytes.length ||
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== u16(end + 10)
  )
    fail("DOCX_ZIP");
  const count = u16(end + 10),
    start = u32(end + 16),
    size = u32(end + 12);
  if (count > L.entries) fail("DOCX_LIMIT");
  if (!count || start + size !== end) fail("DOCX_ZIP");
  let p = start,
    total = 0;
  const entries: {
    name: string;
    offset: number;
    size: number;
    compressed: number;
    method: number;
    crc: number;
    end: number;
    dataEnd: number;
  }[] = [];
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) fail("DOCX_ZIP");
    const flags = u16(p + 8),
      method = u16(p + 10),
      compressed = u32(p + 20),
      size = u32(p + 24),
      nl = u16(p + 28),
      extra = u16(p + 30),
      comment = u16(p + 32),
      offset = u32(p + 42);
    if (
      flags & ~0x080e ||
      ![0, 8].includes(method) ||
      u16(p + 34) ||
      ((u32(p + 38) >>> 16) & 0xf000) === 0xa000
    )
      fail("DOCX_ZIP");
    if (p + 46 + nl + extra + comment > end) fail("DOCX_ZIP");
    const name = decode(bytes.subarray(p + 46, p + 46 + nl));
    const directory = name.endsWith("/");
    if (
      !safePath(directory ? name.slice(0, -1) : name) ||
      names.has(name.toLowerCase())
    )
      fail("DOCX_ZIP");
    names.add(name.toLowerCase());
    total += size;
    if (
      size > L.entryBytes ||
      compressed > L.entryBytes ||
      total > L.expandedBytes ||
      size > Math.max(1, compressed) * L.ratio
    )
      fail("DOCX_LIMIT");
    if (
      u32(offset) !== 0x04034b50 ||
      u16(offset + 6) !== flags ||
      u16(offset + 8) !== method ||
      u16(offset + 26) !== nl ||
      decode(bytes.subarray(offset + 30, offset + 30 + nl)) !== name
    )
      fail("DOCX_ZIP");
    const data = offset + 30 + nl + u16(offset + 28);
    if (
      data + compressed > start ||
      (!(flags & 8) &&
        (u32(offset + 18) !== compressed ||
          u32(offset + 22) !== size ||
          u32(offset + 14) !== u32(p + 16)))
    )
      fail("DOCX_ZIP");
    if (directory && size) fail("DOCX_ZIP");
    let dataEnd = data + compressed;
    if (flags & 8) {
      if (u32(dataEnd) === 0x08074b50) dataEnd += 4;
      if (
        u32(dataEnd) !== u32(p + 16) ||
        u32(dataEnd + 4) !== compressed ||
        u32(dataEnd + 8) !== size
      )
        fail("DOCX_ZIP");
      dataEnd += 12;
    }
    if (dataEnd > start) fail("DOCX_ZIP");
    entries.push({
      name,
      offset: data,
      size,
      compressed,
      method,
      crc: u32(p + 16),
      end: offset,
      dataEnd,
    });
    p += 46 + nl + extra + comment;
  }
  if (p !== end) fail("DOCX_ZIP");
  const ordered = [...entries].sort((a, b) => a.end - b.end);
  if (
    ordered[0]?.end !== 0 ||
    ordered.some((e, i) => i > 0 && e.end !== ordered[i - 1]!.dataEnd)
  )
    fail("DOCX_ZIP");
  if (ordered[ordered.length - 1]!.dataEnd !== start) fail("DOCX_ZIP");
  const result = new Map<string, Uint8Array>();
  for (const e of entries) {
    const output = new Uint8Array(e.size);
    let written = 0;
    if (e.method === 0) {
      if (e.size !== e.compressed) fail("DOCX_ZIP");
      output.set(bytes.subarray(e.offset, e.offset + e.compressed));
      written = e.size;
    } else {
      const inflate = new Inflate((chunk) => {
        if (written + chunk.length > e.size) fail("DOCX_LIMIT");
        output.set(chunk, written);
        written += chunk.length;
      });
      for (let i = 0; i < e.compressed; i += 1024)
        inflate.push(
          bytes.subarray(
            e.offset + i,
            e.offset + Math.min(i + 1024, e.compressed),
          ),
          i + 1024 >= e.compressed,
        );
    }
    if (written !== e.size || crc32(output) !== e.crc) fail("DOCX_ZIP");
    if (!e.name.endsWith("/")) result.set(e.name, output);
  }
  return result;
}
