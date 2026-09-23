import type { ImporterResult } from "@sarel/project-model";
import {
  DOCX_ERRORS,
  DOCX_LIMITS as L,
  fail,
  locate,
  diagnosticLocation,
} from "./limits.js";
import {
  all,
  child,
  hasControls,
  NS,
  readZip,
  safePath,
  val,
  xml,
  type Xml,
} from "./package.js";

interface Node {
  [key: string]: unknown;
  type: string;
  text?: string;
  attrs?: Record<string, string | number>;
  marks?: Mark[];
  content?: Node[];
}
interface Mark {
  type: string;
  attrs?: { href: string };
}
interface Relationship {
  type: string;
  target: string;
  external: boolean;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function from64(s: string) {
  const out = new Uint8Array(
    (s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0),
  );
  let j = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (B64.indexOf(s[i]!) << 18) |
      (B64.indexOf(s[i + 1]!) << 12) |
      (Math.max(0, B64.indexOf(s[i + 2]!)) << 6) |
      Math.max(0, B64.indexOf(s[i + 3]!));
    if (j < out.length) out[j++] = n >>> 16;
    if (j < out.length) out[j++] = n >>> 8;
    if (j < out.length) out[j++] = n;
  }
  return out;
}
function to64(b: Uint8Array) {
  const chunks: string[] = [];
  const chars: string[] = [];
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    chars.push(
      B64[n >>> 18]!,
      B64[(n >>> 12) & 63]!,
      i + 1 < b.length ? B64[(n >>> 6) & 63]! : "=",
      i + 2 < b.length ? B64[n & 63]! : "=",
    );
    if (chars.length >= 16384) {
      chunks.push(chars.join(""));
      chars.length = 0;
    }
  }
  chunks.push(chars.join(""));
  return chunks.join("");
}
const plain = (nodes: Node[]): string =>
  nodes
    .map(
      (n) => n.text ?? (n.type === "hardBreak" ? "\n" : plain(n.content ?? [])),
    )
    .join("");
const textNode = (text: string, marks: Mark[] = []): Node => ({
  type: "text",
  text,
  ...(marks.length ? { marks } : {}),
});
const paragraph = (text: string): Node => ({
  type: "paragraph",
  content: text ? [textNode(text)] : [],
});
const toggle = (n: Xml | undefined): boolean | undefined =>
  n ? !["0", "false", "off"].includes(val(n) ?? "1") : undefined;

/** Synchronous, bundled into the existing isolated importer. No host capabilities. */
export function parse(base64: string): string {
  locate("DOCX package");
  try {
    return JSON.stringify(convert(readZip(from64(base64))));
  } catch (error) {
    const code =
      error instanceof Error && error.message in DOCX_ERRORS
        ? error.message
        : "DOCX_ZIP";
    return JSON.stringify({ docxError: code, location: diagnosticLocation() });
  }
}
function convert(files: Map<string, Uint8Array>): ImporterResult {
  const trees = new Map<string, Xml>();
  const xmlBudget = { nodes: 0 };
  for (const [name, bytes] of files) {
    if (/(?:vbaProject|activeX|embeddings)\b/i.test(name))
      fail("DOCX_UNSUPPORTED");
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      locate("XML part", trees.size + 1);
      trees.set(name, xml(bytes, xmlBudget));
    }
  }
  const types = trees.get("[Content_Types].xml");
  if (types?.name !== "ct:Types") fail("DOCX_PACKAGE");
  const contentTypes = new Map<string, string>();
  const defaults = new Map<string, string>();
  for (const c of types.children) {
    const type = c.attrs.ContentType;
    if (!type || /macroEnabled|vbaProject|oleObject|activeX/i.test(type))
      fail("DOCX_UNSUPPORTED");
    if (c.name === "ct:Override") {
      const name = c.attrs.PartName;
      if (
        !name?.startsWith("/") ||
        !safePath(name.slice(1)) ||
        !files.has(name.slice(1)) ||
        contentTypes.has(name.slice(1))
      )
        fail("DOCX_PACKAGE");
      contentTypes.set(name.slice(1), type);
    } else if (
      c.name === "ct:Default" &&
      c.attrs.Extension &&
      !defaults.has(c.attrs.Extension)
    )
      defaults.set(c.attrs.Extension, type);
    else fail("DOCX_PACKAGE");
  }
  const relations = new Map<string, Map<string, Relationship>>();
  let relationshipCount = 0;
  for (const [name, tree] of trees)
    if (name.endsWith(".rels")) {
      if (tree.name !== "rel:Relationships") fail("DOCX_PACKAGE");
      const source =
        name === "_rels/.rels"
          ? ""
          : name.replace(/(^|\/)_rels\/([^/]+)\.rels$/, "$1$2");
      if (source === name || (source && !files.has(source)))
        fail("DOCX_PACKAGE");
      const map = new Map<string, Relationship>();
      for (const r of tree.children) {
        if (++relationshipCount > L.relationships) fail("DOCX_LIMIT");
        const id = r.attrs.Id,
          target = r.attrs.Target,
          type = r.attrs.Type,
          mode = r.attrs.TargetMode;
        if (
          r.name !== "rel:Relationship" ||
          !id ||
          !target ||
          !type ||
          map.has(id) ||
          (mode && mode !== "Internal" && mode !== "External") ||
          hasControls(target)
        )
          fail("DOCX_PACKAGE");
        const external = mode === "External";
        let resolved = target;
        if (!external) {
          // OPC-relative parents are allowed only while they remain inside this in-memory package.
          if (/[\\:%?#]/.test(target) || target.startsWith("/"))
            fail("DOCX_PACKAGE");
          const parts = source.split("/").slice(0, -1);
          for (const component of target.split("/")) {
            if (component === "..") {
              if (!parts.length) fail("DOCX_PACKAGE");
              parts.pop();
            } else if (component && component !== ".") parts.push(component);
            else fail("DOCX_PACKAGE");
          }
          resolved = parts.join("/");
          if (!safePath(resolved) || !files.has(resolved)) fail("DOCX_PACKAGE");
        }
        map.set(id, { type, target: resolved, external });
      }
      relations.set(source, map);
    }
  const rootRelationships = [...(relations.get("")?.values() ?? [])];
  const office = rootRelationships.filter(
    (r) => r.type === `${NS.r}/officeDocument`,
  );
  if (office.length !== 1 || office[0]!.external) fail("DOCX_PACKAGE");
  const main = office[0]!.target;
  if (
    contentTypes.get(main) !==
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
  )
    fail("DOCX_PACKAGE");
  const document = trees.get(main),
    body = child(document, "w:body");
  if (
    document?.name !== "w:document" ||
    !body ||
    document.children.filter((c) => c.name === "w:body").length !== 1
  )
    fail("DOCX_PACKAGE");
  const result: ImporterResult = {
    metadata: {
      title: "Imported manuscript",
      author: "Unknown author",
      language: "und",
    },
    chapters: [],
    assets: [],
    warnings: [],
  };
  let blockIndex = 0;
  let currentPart = main;
  const warn = (code: string, message: string, structure: string) => {
    if (result.warnings.length >= L.warnings) fail("DOCX_LIMIT");
    // Fixed part categories, structure names and numbers; no archive paths or prose.
    const category =
      currentPart === main ? "Main document" : "Supporting document part";
    result.warnings.push({
      code,
      message,
      location: {
        block: blockIndex,
        label: `${category}, paragraph ${blockIndex}, ${structure}`,
      },
    });
  };
  const usedParts = new Set<string>();
  usedParts.add(main);
  usedParts.add("[Content_Types].xml");
  const partFor = (kind: string): string | undefined => {
    const found = [...(relations.get(main)?.values() ?? [])].filter(
      (r) => r.type === `${NS.r}/${kind}`,
    );
    if (found.length > 1 || found.some((r) => r.external)) fail("DOCX_PACKAGE");
    return found[0]?.target;
  };
  const stylesPart = partFor("styles"),
    numberingPart = partFor("numbering");
  const styles = new Map<string, Xml>();
  if (stylesPart) {
    usedParts.add(stylesPart);
    for (const s of trees.get(stylesPart)?.children ?? [])
      if (s.name === "w:style") {
        const id = s.attrs["w:styleId"];
        if (!id || styles.has(id)) fail("DOCX_PACKAGE");
        styles.set(id, s);
      }
  }
  function styleChain(id: string | undefined): Xml[] {
    const chain: Xml[] = [];
    const seen = new Set<string>();
    while (id) {
      if (seen.has(id) || chain.length > 32) fail("DOCX_PACKAGE");
      seen.add(id);
      const s = styles.get(id);
      if (!s) break;
      chain.unshift(s);
      id = val(child(s, "w:basedOn"));
    }
    return chain;
  }
  let paragraphStyles: Xml[] = [];
  function emphasis(properties: Xml[]): Mark[] {
    const state: { bold?: boolean; italic?: boolean } = {};
    for (const p of properties) {
      if (
        p.children.some((c) =>
          [
            "w:u",
            "w:strike",
            "w:dstrike",
            "w:vertAlign",
            "w:vanish",
            "w:smallCaps",
            "w:caps",
          ].includes(c.name),
        )
      )
        warn(
          "DOCX_RUN_FORMAT",
          "Additional run formatting was not retained; the underlying text remains unchanged and visible.",
          "run formatting",
        );
      const b = toggle(child(p, "w:b")),
        i = toggle(child(p, "w:i"));
      if (b !== undefined) state.bold = b;
      if (i !== undefined) state.italic = i;
    }
    return [
      ...(state.bold ? [{ type: "bold" }] : []),
      ...(state.italic ? [{ type: "italic" }] : []),
    ];
  }
  const numbering = numberingPart ? trees.get(numberingPart) : undefined;
  if (numberingPart) usedParts.add(numberingPart);
  const assetIds = new Map<string, string>();
  const consumedText = new Set<Xml>();
  const nodeLocations = new WeakMap<Node, number>();
  const chapterCandidates = new WeakSet<Node>();
  const listCounters = new Map<string, number>();
  let assetBytes = 0;
  function image(n: Xml, part: string): Node[] {
    const textboxes = all(n, "w:txbxContent");
    const blips = all(n, "a:blip");
    if (blips.length && (all(n, "w:t").length || all(n, "a:t").length))
      fail("DOCX_UNSUPPORTED");
    if (textboxes.length && blips.length) fail("DOCX_UNSUPPORTED");
    if (textboxes.length) {
      warn(
        "DOCX_TEXT_BOX",
        "Text box content recovered at its document anchor; visual positioning was not retained.",
        "text box",
      );
      const saved = paragraphStyles;
      const recovered = textboxes.flatMap((t) => blocks(t, part));
      paragraphStyles = saved;
      return recovered;
    }
    if (!blips.length) {
      if (all(n, "w:t").length || all(n, "a:t").length)
        fail("DOCX_UNSUPPORTED");
      warn(
        "DOCX_DRAWING",
        "A drawing/shape without recoverable text was omitted; inspect the original drawing.",
        "drawing",
      );
      return [];
    }
    warn(
      "DOCX_IMAGE_LAYOUT",
      "Images retain originals and alternative text; Word crop, wrapping and physical layout are not retained.",
      "image",
    );
    return blips.flatMap((b) => {
      const id = b.attrs["r:embed"] ?? b.attrs["r:link"];
      const rel = id ? relations.get(part)?.get(id) : undefined;
      if (!rel || rel.type !== `${NS.r}/image`) fail("DOCX_PACKAGE");
      const alt =
        all(n, "wp:docPr")[0]?.attrs.descr ??
        all(n, "wp:docPr")[0]?.attrs.title ??
        "";
      if (alt.length > 4000) fail("DOCX_LIMIT");
      if (rel.external) {
        warn(
          "DOCX_EXTERNAL_IMAGE",
          "An externally linked image was not fetched. Alternative text is retained as a placeholder.",
          "external image",
        );
        return [
          paragraph(
            alt ? `[External image: ${alt}]` : "[External image not imported]",
          ),
        ];
      }
      const bytes = files.get(rel.target);
      if (!bytes) fail("DOCX_IMAGE");
      const png =
        bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!png && !jpeg) fail("DOCX_IMAGE");
      usedParts.add(rel.target);
      let assetId = assetIds.get(rel.target);
      if (!assetId) {
        assetBytes += bytes.length;
        if (result.assets.length >= L.assets || assetBytes > L.assetBytes)
          fail("DOCX_LIMIT");
        assetId = `00000000-0000-4000-8000-${(result.assets.length + 1).toString(16).padStart(12, "0")}`;
        assetIds.set(rel.target, assetId);
        result.assets.push({
          id: assetId,
          mediaType: png ? "image/png" : "image/jpeg",
          base64: to64(bytes),
        });
      }
      return [{ type: "image", attrs: { assetId, alt, size: "medium" } }];
    });
  }
  const noteParts = new Map<string, string>();
  for (const name of ["footnotes", "endnotes", "comments"]) {
    const part = partFor(name);
    if (part) {
      noteParts.set(name, part);
      usedParts.add(part);
    }
  }
  const usedNotes = new Set<string>();
  const fieldStack: boolean[] = [];
  const fieldVisible = () => fieldStack.every(Boolean);
  function inline(n: Xml, part: string, marks: Mark[] = []): Node[] {
    currentPart = part;
    if (n.name === "w:t") {
      consumedText.add(n);
      if (n.children.length) fail("DOCX_PACKAGE");
      return fieldVisible() && n.text ? [textNode(n.text, marks)] : [];
    }
    if (n.name === "w:instrText") {
      warn(
        "DOCX_FIELD",
        "Field instructions were not executed; only stored visible results are retained.",
        "field",
      );
      return [];
    }
    if (n.name === "w:fldChar") {
      const kind = n.attrs["w:fldCharType"];
      if (kind === "begin") {
        if (fieldStack.length >= 16) fail("DOCX_LIMIT");
        fieldStack.push(false);
        warn(
          "DOCX_FIELD",
          "Field instructions were not executed; only stored visible results are retained.",
          "field",
        );
      } else if (kind === "separate" && fieldStack.length)
        fieldStack[fieldStack.length - 1] = true;
      else if (kind === "end" && fieldStack.length) fieldStack.pop();
      else fail("DOCX_PACKAGE");
      return [];
    }
    if (n.name === "w:r") {
      const p = child(n, "w:rPr");
      const properties = [
        ...paragraphStyles,
        ...styleChain(val(child(p, "w:rStyle"))),
      ]
        .map((s) => child(s, "w:rPr"))
        .filter((s): s is Xml => !!s);
      if (p) properties.push(p);
      const runMarks = [
        ...marks.filter((m) => m.type === "link"),
        ...emphasis(properties),
      ];
      return n.children
        .filter((c) => c.name !== "w:rPr")
        .flatMap((c) => inline(c, part, runMarks));
    }
    if (n.name === "w:hyperlink") {
      const id = n.attrs["r:id"],
        anchor = n.attrs["w:anchor"];
      const rel = id ? relations.get(part)?.get(id) : undefined;
      if (id && (!rel || rel.type !== `${NS.r}/hyperlink`))
        fail("DOCX_PACKAGE");
      const href = rel?.target ?? (anchor ? `#${anchor}` : "");
      // The canonical project-model URL policy independently revalidates output.
      const safe =
        !hasControls(href) &&
        !href.includes("\\") &&
        /^(?:https?:\/\/[^/?#]+(?:[/?#].*)?|mailto:[^:]+|#[^#]+)$/.test(href);
      if (!safe)
        warn(
          "DOCX_LINK",
          "An unsafe or unsupported hyperlink target was removed; its visible text is retained.",
          "hyperlink",
        );
      return n.children.flatMap((c) =>
        inline(
          c,
          part,
          safe
            ? [
                ...marks.filter((m) => m.type !== "link"),
                { type: "link", attrs: { href } },
              ]
            : marks,
        ),
      );
    }
    if (n.name === "w:tab")
      return fieldVisible() ? [textNode("\t", marks)] : [];
    if (n.name === "w:br" || n.name === "w:cr")
      return fieldVisible() ? [{ type: "hardBreak" }] : [];
    if (n.name === "w:noBreakHyphen")
      return fieldVisible() ? [textNode("\u2011", marks)] : [];
    if (n.name === "w:softHyphen")
      return fieldVisible() ? [textNode("\u00ad", marks)] : [];
    if (n.name === "w:drawing" || n.name === "w:pict") return image(n, part);
    if (
      [
        "w:footnoteReference",
        "w:endnoteReference",
        "w:commentReference",
      ].includes(n.name)
    ) {
      const kind = n.name.slice(2).replace("Reference", "");
      const partName = noteParts.get(`${kind}s`);
      const id = n.attrs["w:id"];
      const note = partName
        ? trees
            .get(partName)
            ?.children.find(
              (c) => c.name === `w:${kind}` && c.attrs["w:id"] === id,
            )
        : undefined;
      if (!note || !partName || !id) fail("DOCX_PACKAGE");
      const key = `${kind}:${id}`;
      if (usedNotes.has(key)) {
        warn(
          "DOCX_NOTE_REPEAT",
          "Repeated note reference retained as a label; note text was already recovered.",
          kind,
        );
        return [textNode(`[${kind} ${id}]`)];
      }
      usedNotes.add(key);
      warn(
        "DOCX_NOTE",
        "Note/comment text recovered at its reference; annotation semantics were not retained.",
        kind,
      );
      const saved = paragraphStyles;
      const recovered = blocks(note, partName);
      paragraphStyles = saved;
      return [paragraph(`[${kind}]`), ...recovered];
    }
    if (n.name === "w:fldSimple") {
      warn(
        "DOCX_FIELD",
        "Stored field result retained; instructions were not executed.",
        "field",
      );
      return n.children.flatMap((c) => inline(c, part, marks));
    }
    if (
      [
        "w:rPr",
        "w:pPr",
        "w:bookmarkStart",
        "w:bookmarkEnd",
        "w:proofErr",
        "w:commentRangeStart",
        "w:commentRangeEnd",
        "w:lastRenderedPageBreak",
        "w:footnoteRef",
        "w:endnoteRef",
        "w:annotationRef",
      ].includes(n.name)
    )
      return [];
    if (n.name === "w:sdt") {
      warn(
        "DOCX_CONTENT_CONTROL",
        "Content control text recovered; bindings and control semantics were not retained.",
        "content control",
      );
      const content = child(n, "w:sdtContent");
      if (!content) fail("DOCX_UNSUPPORTED");
      return content.children.flatMap((c) => inline(c, part, marks));
    }
    if (n.name === "w:p") return paragraphNodes(n, part);
    if (n.name === "w:tbl") return blocks({ ...n, children: [n] }, part);
    // Unknown content is never ignored: text-bearing extensions are blocked.
    fail("DOCX_UNSUPPORTED");
  }
  function paragraphNodes(p: Xml, part: string): Node[] {
    if (++blockIndex > L.paragraphs) fail("DOCX_LIMIT");
    const sourceBlock = blockIndex;
    currentPart = part;
    locate(
      part === main ? "Main document" : "Supporting document part",
      blockIndex,
    );
    const props = child(p, "w:pPr"),
      styleId = val(child(props, "w:pStyle"));
    paragraphStyles = styleChain(styleId);
    let level = 0;
    for (const s of paragraphStyles) {
      const styleName = val(child(s, "w:name")) ?? s.attrs["w:styleId"] ?? "";
      const match = /^heading\s*([1-6])$/i.exec(styleName);
      if (match) level = Number(match[1]);
      const outline = val(child(child(s, "w:pPr"), "w:outlineLvl"));
      if (outline && Number(outline) < 6) level = Number(outline) + 1;
    }
    const direct = /^Heading([1-6])$/i.exec(styleId ?? "");
    if (direct) level = Number(direct[1]);
    const outline = val(child(props, "w:outlineLvl"));
    if (outline !== undefined)
      level = Number(outline) < 6 ? Number(outline) + 1 : 0;
    const content = p.children
      .filter((c) => c.name !== "w:pPr")
      .flatMap((c) => inline(c, part));
    const nodes: Node[] = [];
    let pending: Node[] = [];
    const flush = () => {
      if (pending.length) {
        nodes.push({
          type: level ? "heading" : "paragraph",
          ...(level ? { attrs: { level } } : {}),
          content: pending,
        });
        pending = [];
      }
    };
    for (const node of content) {
      if (node.type === "text" || node.type === "hardBreak") {
        const previous = pending[pending.length - 1];
        if (
          node.type === "text" &&
          previous?.type === "text" &&
          JSON.stringify(node.marks) === JSON.stringify(previous.marks)
        )
          previous.text! += node.text!;
        else pending.push(node);
      } else {
        flush();
        nodes.push(node);
      }
    }
    flush();
    if (!nodes.length) nodes.push(paragraph(""));
    for (const n of nodes)
      if (!nodeLocations.has(n)) nodeLocations.set(n, sourceBlock);
    return nodes;
  }
  function listInfo(
    p: Xml,
  ): { id: string; level: number; type: string; start: number } | undefined {
    const properties = child(p, "w:pPr");
    const inherited = styleChain(val(child(properties, "w:pStyle")))
      .map((s) => child(child(s, "w:pPr"), "w:numPr"))
      .filter((s): s is Xml => !!s);
    const num = child(properties, "w:numPr") ?? inherited[inherited.length - 1];
    if (!num) return;
    const id = val(child(num, "w:numId"));
    if (id === "0") return;
    const level = Number(val(child(num, "w:ilvl")) ?? 0);
    const instance = numbering?.children.find(
      (c) => c.name === "w:num" && c.attrs["w:numId"] === id,
    );
    const abstract = numbering?.children.find(
      (c) =>
        c.name === "w:abstractNum" &&
        c.attrs["w:abstractNumId"] === val(child(instance, "w:abstractNumId")),
    );
    const definition = abstract?.children.find(
      (c) => c.name === "w:lvl" && c.attrs["w:ilvl"] === String(level),
    );
    const format = val(child(definition, "w:numFmt"));
    if (
      !id ||
      !definition ||
      !["bullet", "decimal"].includes(format ?? "") ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 8 ||
      child(instance, "w:lvlOverride")
    ) {
      warn(
        "DOCX_LIST",
        "Unsupported list numbering recovered as ordinary paragraphs; automatic labels/nesting were not retained.",
        "list",
      );
      return;
    }
    const start = Number(val(child(definition, "w:start")) ?? 1);
    if (!Number.isSafeInteger(start) || start < 0 || start > 1_000_000)
      fail("DOCX_PACKAGE");
    return {
      id,
      level,
      type: format === "bullet" ? "bulletList" : "orderedList",
      start,
    };
  }
  function blocks(parent: Xml, part: string, proposeChapters = false): Node[] {
    const output: Node[] = [];
    const listStack: { id: string; node: Node }[] = [];
    for (const c of parent.children) {
      if (c.name === "w:p") {
        const originalBlock = blockIndex + 1;
        const nodes = paragraphNodes(c, part),
          info = listInfo(c);
        if (proposeChapters && !info)
          for (const node of nodes)
            if (
              node.type === "heading" &&
              node.attrs?.level === 1 &&
              nodeLocations.get(node) === originalBlock
            )
              chapterCandidates.add(node);
        if (
          info &&
          nodes[0]?.type === "paragraph" &&
          info.level <= listStack.length
        ) {
          listStack.length = Math.min(listStack.length, info.level + 1);
          let entry = listStack[info.level];
          if (!entry || entry.id !== info.id || entry.node.type !== info.type) {
            const node: Node = {
              type: info.type,
              ...(info.type === "orderedList"
                ? {
                    attrs: {
                      start:
                        listCounters.get(`${part}|${info.id}|${info.level}`) ??
                        info.start,
                    },
                  }
                : {}),
              content: [],
            };
            if (info.level === 0) output.push(node);
            else {
              const items = listStack[info.level - 1]!.node.content!;
              items[items.length - 1]!.content!.push(node);
            }
            entry = { id: info.id, node };
            listStack[info.level] = entry;
          }
          entry.node.content!.push({ type: "listItem", content: nodes });
          if (info.type === "orderedList") {
            const key = `${part}|${info.id}|${info.level}`;
            listCounters.set(key, (listCounters.get(key) ?? info.start) + 1);
          }
          for (let depth = info.level + 1; depth <= 8; depth++)
            listCounters.delete(`${part}|${info.id}|${depth}`);
        } else {
          if (info)
            warn(
              "DOCX_LIST",
              "A discontinuous list level or heading item was recovered as paragraphs.",
              "list",
            );
          listStack.length = 0;
          output.push(...nodes);
        }
      } else {
        listStack.length = 0;
        if (c.name === "w:sectPr") continue;
        if (c.name === "w:tbl") {
          warn(
            "DOCX_TABLE",
            "Table cell content recovered in row/cell XML order; table layout and merged-cell semantics were not retained.",
            "table",
          );
          for (const row of c.children) {
            if (row.name === "w:tr") {
              for (const cell of row.children)
                if (cell.name === "w:tc") output.push(...blocks(cell, part));
                else if (!["w:trPr", "w:tblPrEx"].includes(cell.name))
                  fail("DOCX_UNSUPPORTED");
            } else if (!["w:tblPr", "w:tblGrid"].includes(row.name))
              fail("DOCX_UNSUPPORTED");
          }
        } else if (["w:tcPr", "w:tblPr", "w:tblGrid"].includes(c.name))
          continue;
        else if (c.name === "w:sdt") {
          warn(
            "DOCX_CONTENT_CONTROL",
            "Content control body recovered; bindings were not retained.",
            "content control",
          );
          const body = child(c, "w:sdtContent");
          if (!body) fail("DOCX_UNSUPPORTED");
          output.push(...blocks(body, part, proposeChapters));
        } else fail("DOCX_UNSUPPORTED");
      }
    }
    return output;
  }
  // Preflight even unsupported/unused XML so revisions and active structures cannot hide.
  for (const [part, tree] of trees) {
    let paragraphNumber = 0;
    const visit = (n: Xml): void => {
      if (n.name === "w:p") paragraphNumber++;
      locate(
        part === main ? "Main document" : "Supporting document part",
        paragraphNumber,
      );
      if (
        (n.name.startsWith("w:") ||
          part === main ||
          tree.name.startsWith("w:")) &&
        n.text.trim() &&
        !["w:t", "w:instrText", "w:delText", "w:delInstrText"].includes(n.name)
      )
        fail("DOCX_UNSUPPORTED");
      if (
        /^w:(?:ins|del|delText|delInstrText|moveFrom|moveTo|.*Change|.*RangeStart|.*RangeEnd)$/.test(
          n.name,
        ) &&
        !["w:commentRangeStart", "w:commentRangeEnd"].includes(n.name)
      )
        fail("DOCX_REVISIONS");
      if (
        n.name.endsWith(":AlternateContent") ||
        ["w:altChunk", "w:object", "w:subDoc"].includes(n.name)
      )
        fail("DOCX_UNSUPPORTED");
      for (const c of n.children) visit(c);
    };
    visit(tree);
    if (part.endsWith(".rels")) usedParts.add(part);
  }
  for (const [source, map] of relations)
    for (const r of map.values()) {
      const kind = r.type.startsWith(`${NS.r}/`)
        ? r.type.slice(NS.r.length + 1)
        : "unknown";
      if (
        ["oleObject", "package", "aFChunk", "subDocument", "control"].includes(
          kind,
        )
      )
        fail("DOCX_UNSUPPORTED");
      if (r.external && kind !== "hyperlink" && kind !== "image") {
        warn(
          "DOCX_EXTERNAL_RELATIONSHIP",
          "An external relationship was not loaded or executed.",
          "external relationship",
        );
        continue;
      }
      if (
        !r.external &&
        ["settings", "webSettings", "fontTable", "theme"].includes(kind)
      )
        usedParts.add(r.target);
      if (
        source &&
        ![
          "hyperlink",
          "image",
          "styles",
          "numbering",
          "footnotes",
          "endnotes",
          "comments",
          "header",
          "footer",
          "settings",
          "webSettings",
          "fontTable",
          "theme",
        ].includes(kind) &&
        !r.external
      )
        fail("DOCX_UNSUPPORTED");
    }
  const core = rootRelationships.find(
    (r) =>
      r.type ===
      `${NS.cp.replace("/metadata/core-properties", "")}/relationships/metadata/core-properties`,
  );
  if (core) {
    if (core.external) fail("DOCX_PACKAGE");
    usedParts.add(core.target);
    const meta = trees.get(core.target);
    if (meta?.name !== "cp:coreProperties") fail("DOCX_PACKAGE");
    for (const [tag, key, max] of [
      ["dc:title", "title", 500],
      ["dc:creator", "author", 500],
      ["dc:language", "language", 100],
      ["dc:description", "description", 4000],
    ] as const) {
      const value = child(meta, tag)?.text;
      if (value?.trim()) {
        if (value.length > max) fail("DOCX_LIMIT");
        result.metadata[key] = value;
      }
    }
    if (
      meta.children.some(
        (c) =>
          !["dc:title", "dc:creator", "dc:language", "dc:description"].includes(
            c.name,
          ) && c.text.trim(),
      )
    )
      warn(
        "DOCX_METADATA",
        "Some Word metadata, including subject/keywords/revision properties, has no matching project field and was not mapped.",
        "metadata",
      );
  }
  if (
    result.metadata.author === "Unknown author" ||
    result.metadata.title === "Imported manuscript" ||
    result.metadata.language === "und"
  )
    warn(
      "DOCX_METADATA_DEFAULT",
      "Missing title/author/language use explicit placeholders; review metadata before committing.",
      "metadata",
    );
  const nodes = blocks(body, main, true);
  if (fieldStack.length) fail("DOCX_PACKAGE");
  for (const [kind, part] of noteParts) {
    currentPart = part;
    for (const note of trees.get(part)?.children ?? []) {
      const id = note.attrs["w:id"];
      if (
        ["separator", "continuationSeparator"].includes(
          note.attrs["w:type"] ?? "",
        )
      )
        continue;
      if (id && !usedNotes.has(`${kind.slice(0, -1)}:${id}`)) {
        usedNotes.add(`${kind.slice(0, -1)}:${id}`);
        warn(
          "DOCX_UNREFERENCED_NOTE",
          "Unreferenced note/comment text appended in part order.",
          "note",
        );
        nodes.push(paragraph(`[${kind.slice(0, -1)}]`), ...blocks(note, part));
      }
    }
  }
  for (const r of relations.get(main)?.values() ?? [])
    if (
      !r.external &&
      ["header", "footer"].some((k) => r.type === `${NS.r}/${k}`)
    ) {
      usedParts.add(r.target);
      currentPart = r.target;
      warn(
        "DOCX_HEADER_FOOTER",
        "Header/footer text appended once in relationship order; page repetition/layout was not retained.",
        "header/footer",
      );
      const tree = trees.get(r.target);
      if (!tree) fail("DOCX_PACKAGE");
      nodes.push(...blocks(tree, r.target));
    }
  // Never silently discard unknown package parts. Known non-manuscript properties are explicit.
  for (const [name, bytes] of files)
    if (!usedParts.has(name)) {
      const type =
        contentTypes.get(name) ?? defaults.get(name.split(".").pop() ?? "");
      if (
        type ===
          "application/vnd.openxmlformats-officedocument.extended-properties+xml" ||
        type ===
          "application/vnd.openxmlformats-officedocument.custom-properties+xml"
      ) {
        warn(
          "DOCX_METADATA",
          "Additional application/custom metadata was not mapped into the manuscript.",
          "metadata",
        );
        continue;
      }
      if (type?.startsWith("image/") && bytes.length) {
        warn(
          "DOCX_UNUSED_IMAGE",
          "An unreferenced package image/thumbnail was not imported.",
          "unused image",
        );
        continue;
      }
      fail("DOCX_UNSUPPORTED");
    }
  currentPart = main;
  for (const [part, tree] of trees) {
    locate(part === main ? "Main document" : "Supporting document part");
    if (
      [...all(tree, "w:t"), ...all(tree, "a:t")].some(
        (t) => t.text && !consumedText.has(t),
      )
    )
      fail("DOCX_UNSUPPORTED");
  }
  if (fieldStack.length) fail("DOCX_PACKAGE");
  let chapter: ImporterResult["chapters"][number] | undefined;
  for (const node of nodes) {
    blockIndex = nodeLocations.get(node) ?? blockIndex;
    if (!chapter || chapterCandidates.has(node)) {
      const heading = chapterCandidates.has(node);
      const title = heading ? plain([node]).trim() : "Opening";
      if (title.length > 200)
        warn(
          "DOCX_CHAPTER_TITLE",
          "A long chapter proposal title was shortened; its complete heading remains in the manuscript.",
          "heading",
        );
      chapter = {
        title:
          title.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "") ||
          "Untitled chapter",
        type: "chapter",
        content: { type: "doc", content: [] },
      };
      result.chapters.push(chapter);
      if (result.chapters.length > 1000) fail("DOCX_LIMIT");
      if (heading)
        warn(
          "DOCX_CHAPTER_PROPOSAL",
          "Heading 1 proposes a chapter boundary; the heading remains in the chapter for review.",
          "heading",
        );
      if (heading)
        result.warnings[result.warnings.length - 1]!.location.chapter =
          result.chapters.length - 1;
    }
    chapter.content.content!.push(node);
  }
  if (!result.chapters.length)
    result.chapters.push({
      title: "Opening",
      type: "chapter",
      content: { type: "doc", content: [] },
    });
  return result;
}
