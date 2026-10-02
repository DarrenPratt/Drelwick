import xml from "xml";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { ManuscriptDocumentSchema } from "@drelwick/project-model";
import { ApplicationError, type DocxExportWarning } from "@drelwick/shared";
import type { AssembledBook } from "./book-assembly.js";
import { NS, readZip, xml as parseXml } from "./docx/package.js";
import { DOCX_LIMITS } from "./docx/limits.js";

// Structured XML serialization, never interpolated author text or raw markup.
type X = xml.XmlObject;
const el = (
  name: string,
  attrs: Record<string, string | number> = {},
  children: X[] = [],
): X => ({ [name]: [{ _attr: attrs }, ...children] });
const v = (name: string, value: string | number) =>
  el(name, { "w:val": value });
const text = (name: string, value: string): X => ({
  [name]: [{ _attr: { "xml:space": "preserve" } }, value],
});
const encode = (root: X) =>
  Buffer.from(
    xml(root, { declaration: { encoding: "UTF-8", standalone: "yes" } }),
  );
export const docxExportError = (code: string, message: string) =>
  new ApplicationError(code, message);
const invalid = () =>
  docxExportError(
    "DOCX_EXPORT_CONTENT",
    "The manuscript contains unsupported or invalid content. No DOCX was written.",
  );
const limit = () =>
  docxExportError(
    "DOCX_EXPORT_LIMIT",
    "The manuscript exceeds the editable DOCX profile limits. Export was stopped without omitting content.",
  );
interface Node {
  type: string;
  content?: Node[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}
export interface PreparedDocx {
  bytes: Uint8Array;
  revision: string;
  warnings: DocxExportWarning[];
}

/** Pure conversion of captured semantic data and validated image originals. */
export function generateDocx(snapshot: AssembledBook): PreparedDocx {
  let inputBytes = 0;
  let inputNodes = 0;
  const warnings: DocxExportWarning[] = [];
  let chapterId: string | undefined;
  const warn = (
    code: DocxExportWarning["code"],
    construct: string,
    path: number[],
    message: string,
  ) => {
    if (warnings.length >= DOCX_LIMITS.warnings) throw limit();
    warnings.push({
      ...(chapterId ? { chapterId } : {}),
      path,
      construct,
      code,
      message,
    });
  };
  // XML 1.0 cannot represent every string accepted by the historic text schema.
  const checkStrings = (value: unknown, depth = 0): void => {
    if (depth > 64) throw limit();
    if (++inputNodes > 1_000_000) throw limit();
    if (typeof value === "string") {
      inputBytes += Buffer.byteLength(value);
      if (inputBytes > 32 * 1024 * 1024) throw limit();
      for (const c of value) {
        const n = c.codePointAt(0)!;
        if (
          (n < 32 && ![9, 10, 13].includes(n)) ||
          (n >= 0xd800 && n <= 0xdfff) ||
          n === 0xfffe ||
          n === 0xffff
        )
          throw invalid();
      }
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) checkStrings(child, depth + 1);
    }
  };
  checkStrings(snapshot.book);
  const files: Record<string, Uint8Array> = {};
  const rels: X[] = [];
  const abstracts: X[] = [];
  const numbers: X[] = [];
  let relation = 0;
  let numbering = 0;
  let drawing = 0;
  let paragraphs = 0;
  let headings = 0;
  let imageBytes = 0;
  const relationship = (type: string, target: string, external = false) => {
    if (relation >= DOCX_LIMITS.relationships - 2) throw limit();
    const id = `rId${++relation}`;
    rels.push(
      el("Relationship", {
        Id: id,
        Type: `${NS.r}/${type}`,
        Target: target,
        ...(external ? { TargetMode: "External" } : {}),
      }),
    );
    return id;
  };
  const run = (value: string, props: X[] = []): X =>
    el("w:r", {}, [
      ...(props.length ? [el("w:rPr", {}, props)] : []),
      ...value
        .split(/(\t|\r\n|\r|\n)/)
        .filter(Boolean)
        .map((s) =>
          s === "\t"
            ? el("w:tab")
            : /^[\r\n]+$/.test(s)
              ? el("w:br")
              : text("w:t", s),
        ),
    ]);
  const inline = (nodes: Node[], path: number[]): X[] =>
    nodes.map((node, i) => {
      const at = [...path, i];
      const props: X[] = [];
      let href: string | undefined;
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") props.push(el("w:b"));
        else if (mark.type === "italic") props.push(el("w:i"));
        else if (mark.type === "underline") props.push(v("w:u", "single"));
        else if (mark.type === "strike") props.push(el("w:strike"));
        else if (mark.type === "code")
          props.push(
            el("w:rFonts", {
              "w:ascii": "Courier New",
              "w:hAnsi": "Courier New",
            }),
          );
        else if (mark.type === "link") {
          href = String(mark.attrs?.href);
          if (
            Object.keys(mark.attrs ?? {}).some(
              (key) => key !== "href" && mark.attrs?.[key] != null,
            )
          )
            warn(
              "link",
              "link",
              at,
              "Link browser attributes are not retained; its destination and visible text are preserved.",
            );
        } else throw invalid();
        if (["underline", "strike", "code"].includes(mark.type))
          warn(
            "style",
            mark.type,
            at,
            "Formatting is retained in Word, but the current importer recovers its text without this mark.",
          );
      }
      const r =
        node.type === "hardBreak"
          ? el("w:r", {}, [
              ...(props.length ? [el("w:rPr", {}, props)] : []),
              el("w:br"),
            ])
          : node.type === "text"
            ? run(node.text!, props)
            : (() => {
                throw invalid();
              })();
      if (!href) return r;
      if (href.startsWith("#")) {
        warn(
          "link",
          "fragment",
          at,
          "Fragment destination is retained; the current project/import model does not retain Word bookmark definitions, so navigation is not guaranteed.",
        );
        return el("w:hyperlink", { "w:anchor": href.slice(1) }, [r]);
      }
      return el(
        "w:hyperlink",
        { "r:id": relationship("hyperlink", href, true) },
        [r],
      );
    });
  const p = (children: X[], props: X[] = []): X => {
    if (++paragraphs > DOCX_LIMITS.paragraphs) throw limit();
    return el("w:p", {}, [
      ...(props.length ? [el("w:pPr", {}, props)] : []),
      ...children,
    ]);
  };
  const imageIds = new Map<string, string>();
  const blocks = (
    nodes: Node[],
    path: number[],
    depth = 0,
    style?: string,
    offset = 0,
  ): X[] =>
    nodes.flatMap((node, i): X[] => {
      const at = [...path, i + offset];
      const content = node.content ?? [];
      if (
        node.type === "heading" &&
        node.attrs?.level === 1 &&
        ++headings > 1000
      )
        throw limit();
      if (node.type === "heading" && node.attrs?.level === 1)
        warn(
          "publication",
          "heading",
          at,
          "Heading 1 remains editable, but the importer proposes an additional chapter at this heading; review chapter boundaries on re-import.",
        );
      if (node.type === "paragraph" || node.type === "heading")
        return [
          p(
            inline(content, at),
            node.type === "heading"
              ? [v("w:pStyle", `Heading${node.attrs?.level}`)]
              : style
                ? [v("w:pStyle", style)]
                : [],
          ),
        ];
      if (node.type === "bulletList" || node.type === "orderedList") {
        const ordered = node.type === "orderedList";
        const start = Number(node.attrs?.start ?? 1);
        const flatten = depth > 8 || start < 0 || start > 1_000_000;
        if (flatten || node.attrs?.type)
          warn(
            "list",
            node.type,
            at,
            "Unsupported list depth/start or custom numbering maps to readable decimal/bullet text; exact list semantics may differ.",
          );
        const id = ++numbering;
        if (!flatten) {
          abstracts.push(
            el("w:abstractNum", { "w:abstractNumId": id }, [
              v("w:multiLevelType", "multilevel"),
              el("w:lvl", { "w:ilvl": depth }, [
                v("w:start", start),
                v("w:numFmt", ordered ? "decimal" : "bullet"),
                v("w:lvlText", ordered ? `%${depth + 1}.` : "•"),
                v("w:lvlJc", "left"),
                el("w:pPr", {}, [
                  el("w:ind", {
                    "w:left": (depth + 1) * 720,
                    "w:hanging": 360,
                  }),
                ]),
              ]),
            ]),
          );
          numbers.push(
            el("w:num", { "w:numId": id }, [v("w:abstractNumId", id)]),
          );
        }
        return content.flatMap((item, j) => {
          const first = item.content?.[0];
          if (!first || first.type !== "paragraph") throw invalid();
          const rest = item.content!.slice(1);
          if (rest.some((n) => !["bulletList", "orderedList"].includes(n.type)))
            warn(
              "list",
              "listItem",
              [...at, j],
              "Continuation blocks retain their content/order but may re-import outside the list item.",
            );
          return [
            p(
              [
                ...(flatten ? [run(ordered ? `${start + j}. ` : "• ")] : []),
                ...inline(first.content ?? [], [...at, j, 0]),
              ],
              flatten
                ? []
                : [el("w:numPr", {}, [v("w:ilvl", depth), v("w:numId", id)])],
            ),
            ...blocks(rest, [...at, j], depth + 1, style, 1),
          ];
        });
      }
      if (node.type === "blockquote" || node.type === "epigraph") {
        warn(
          "style",
          node.type,
          at,
          "Quote/epigraph style and all text are retained in Word; re-import recovers ordinary paragraphs, including attribution.",
        );
        const result = blocks(
          content,
          at,
          depth,
          node.type === "epigraph" ? "Epigraph" : "Quote",
        );
        if (node.attrs?.attribution)
          result.push(
            p(
              [run(String(node.attrs.attribution))],
              [v("w:pStyle", "Attribution")],
            ),
          );
        return result;
      }
      if (node.type === "codeBlock") {
        warn(
          "style",
          "codeBlock",
          at,
          "Code text is retained in a monospace paragraph; code-block/language semantics are not restored by import.",
        );
        // Language is author metadata: preserve it as visible text rather than discard it.
        return [
          ...(node.attrs?.language
            ? [
                p(
                  [run(`Language: ${String(node.attrs.language)}`)],
                  [v("w:pStyle", "Code")],
                ),
              ]
            : []),
          p(inline(content, at), [v("w:pStyle", "Code")]),
        ];
      }
      if (["sceneBreak", "horizontalRule"].includes(node.type)) {
        warn(
          "style",
          node.type,
          at,
          "Break maps to a visible *** paragraph; re-import retains the marker as text.",
        );
        return [p([run("***")], [v("w:pStyle", "SceneBreak")])];
      }
      if (node.type === "image") {
        const id = String(node.attrs?.assetId);
        const asset = snapshot.book.assets.find(
          (a) => a.status === "available" && a.descriptor.id === id,
        );
        const bytes = snapshot.assets.get(id);
        if (
          !asset ||
          asset.status !== "available" ||
          !bytes ||
          createHash("sha256").update(bytes).digest("hex") !==
            asset.descriptor.sha256
        )
          throw docxExportError(
            "DOCX_EXPORT_IMAGE",
            "A referenced project image is missing or damaged. Restore or replace it before exporting; no content was omitted.",
          );
        const descriptor = asset.descriptor;
        let rid = imageIds.get(id);
        if (!rid) {
          imageBytes += bytes.length;
          if (imageBytes > DOCX_LIMITS.assetBytes) throw limit();
          if (imageIds.size >= DOCX_LIMITS.assets) throw limit();
          const name = `media/image${imageIds.size + 1}.${descriptor.mediaType === "image/png" ? "png" : "jpg"}`;
          files[`word/${name}`] = bytes;
          rid = relationship("image", name);
          imageIds.set(id, rid);
        }
        warn(
          "image",
          "image",
          at,
          "Original PNG/JPEG and alternative text are embedded. Relative sizing maps to an approximate width; import resets it to medium.",
        );
        const max =
          node.attrs?.size === "small"
            ? 192
            : node.attrs?.size === "full"
              ? 576
              : 384;
        const scale = Math.min(
          1,
          max / descriptor.width,
          768 / descriptor.height,
        );
        const cx = Math.max(1, Math.round(descriptor.width * scale * 9525));
        const cy = Math.max(1, Math.round(descriptor.height * scale * 9525));
        const draw = ++drawing;
        return [
          p([
            el("w:r", {}, [
              el("w:drawing", {}, [
                el("wp:inline", { distT: 0, distB: 0, distL: 0, distR: 0 }, [
                  el("wp:extent", { cx, cy }),
                  el("wp:docPr", {
                    id: draw,
                    name: `Image ${draw}`,
                    descr: String(node.attrs?.alt ?? ""),
                  }),
                  el("a:graphic", {}, [
                    el(
                      "a:graphicData",
                      {
                        uri: "http://schemas.openxmlformats.org/drawingml/2006/picture",
                      },
                      [
                        el("pic:pic", {}, [
                          el("pic:nvPicPr", {}, [
                            el("pic:cNvPr", {
                              id: 0,
                              name: `Image ${draw}`,
                              descr: String(node.attrs?.alt ?? ""),
                            }),
                            el("pic:cNvPicPr"),
                          ]),
                          el("pic:blipFill", {}, [
                            el("a:blip", { "r:embed": rid }),
                            el("a:stretch", {}, [el("a:fillRect")]),
                          ]),
                          el("pic:spPr", {}, [
                            el("a:xfrm", {}, [
                              el("a:off", { x: 0, y: 0 }),
                              el("a:ext", { cx, cy }),
                            ]),
                            el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
                          ]),
                        ]),
                      ],
                    ),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ];
      }
      throw invalid();
    });
  const body: X[] = [];
  for (const chapter of snapshot.book.chapters) {
    if (++headings > 1000) throw limit();
    chapterId = chapter.id;
    const doc = ManuscriptDocumentSchema.safeParse(chapter.document);
    if (!doc.success) throw invalid();
    if (
      chapter.publication &&
      (chapter.publication.section !== "body" ||
        !chapter.publication.inclusion.ebook ||
        !chapter.publication.inclusion.print)
    )
      warn(
        "publication",
        "matter",
        [],
        "Editable interchange includes all matter/chapters in reading order, regardless of ebook/print visibility. Publication roles and visibility do not round-trip.",
      );
    body.push(p([run(chapter.title)], [v("w:pStyle", "Heading1")]));
    body.push(...blocks((doc.data.content ?? []) as Node[], []));
  }
  chapterId = undefined;
  const metadata = snapshot.book.metadata;
  if (metadata?.identifiers.length)
    warn(
      "metadata",
      "identifiers",
      [],
      "Publication identifiers are retained in Word core metadata but are not restored by the current importer.",
    );
  if ((metadata?.description.length ?? 0) > 4000)
    warn(
      "metadata",
      "description",
      [],
      "The complete description is retained in Word metadata. Re-import will be blocked until the description is shortened to the importer's 4000-character limit.",
    );
  files["docProps/core.xml"] = encode(
    el("cp:coreProperties", { "xmlns:cp": NS.cp, "xmlns:dc": NS.dc }, [
      text("dc:title", snapshot.book.title),
      text("dc:creator", metadata?.author ?? "Unknown author"),
      text("dc:language", snapshot.book.language),
      text("dc:description", metadata?.description ?? ""),
      ...(metadata?.identifiers.length
        ? [
            text(
              "dc:identifier",
              metadata.identifiers
                .map((id) => `${id.scheme}: ${id.value}`)
                .join("; "),
            ),
          ]
        : []),
    ]),
  );
  files["word/document.xml"] = encode(
    el(
      "w:document",
      {
        "xmlns:w": NS.w,
        "xmlns:r": NS.r,
        "xmlns:wp": NS.wp,
        "xmlns:a": NS.a,
        "xmlns:pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
      },
      [el("w:body", {}, body)],
    ),
  );
  const styles: X[] = [
    el(
      "w:style",
      { "w:type": "paragraph", "w:default": 1, "w:styleId": "Normal" },
      [v("w:name", "Normal")],
    ),
  ];
  for (let level = 1; level <= 6; level++)
    styles.push(
      el("w:style", { "w:type": "paragraph", "w:styleId": `Heading${level}` }, [
        v("w:name", `heading ${level}`),
        v("w:basedOn", "Normal"),
        el("w:pPr", {}, [v("w:outlineLvl", level - 1)]),
      ]),
    );
  for (const style of [
    "Quote",
    "Epigraph",
    "Attribution",
    "Code",
    "SceneBreak",
  ])
    styles.push(
      el("w:style", { "w:type": "paragraph", "w:styleId": style }, [
        v("w:name", style),
        v("w:basedOn", "Normal"),
        ...(style === "Code"
          ? [
              el("w:rPr", {}, [
                el("w:rFonts", {
                  "w:ascii": "Courier New",
                  "w:hAnsi": "Courier New",
                }),
              ]),
            ]
          : []),
      ]),
    );
  files["word/styles.xml"] = encode(
    el("w:styles", { "xmlns:w": NS.w }, styles),
  );
  relationship("styles", "styles.xml");
  if (numbers.length) {
    files["word/numbering.xml"] = encode(
      el("w:numbering", { "xmlns:w": NS.w }, [...abstracts, ...numbers]),
    );
    relationship("numbering", "numbering.xml");
  }
  files["word/_rels/document.xml.rels"] = encode(
    el("Relationships", { xmlns: NS.rel }, rels),
  );
  files["_rels/.rels"] = encode(
    el("Relationships", { xmlns: NS.rel }, [
      el("Relationship", {
        Id: "document",
        Type: `${NS.r}/officeDocument`,
        Target: "word/document.xml",
      }),
      el("Relationship", {
        Id: "metadata",
        Type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        Target: "docProps/core.xml",
      }),
    ]),
  );
  files["[Content_Types].xml"] = encode(
    el("Types", { xmlns: NS.ct }, [
      el("Default", {
        Extension: "rels",
        ContentType: "application/vnd.openxmlformats-package.relationships+xml",
      }),
      el("Default", { Extension: "png", ContentType: "image/png" }),
      el("Default", { Extension: "jpg", ContentType: "image/jpeg" }),
      ...Object.keys(files)
        .filter((name) => name.endsWith(".xml"))
        .map((name) =>
          el("Override", {
            PartName: `/${name}`,
            ContentType:
              name === "docProps/core.xml"
                ? "application/vnd.openxmlformats-package.core-properties+xml"
                : `application/vnd.openxmlformats-officedocument.wordprocessingml.${name === "word/document.xml" ? "document.main" : name === "word/styles.xml" ? "styles" : "numbering"}+xml`,
          }),
        ),
    ]),
  );
  let total = 0;
  const budget = { nodes: 0 };
  for (const [name, bytes] of Object.entries(files)) {
    total += bytes.length;
    if (bytes.length > DOCX_LIMITS.entryBytes || total > 64 * 1024 * 1024)
      throw limit();
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      try {
        parseXml(bytes, budget);
      } catch {
        throw limit();
      }
    }
  }
  // Stored ZIP avoids artificial expansion-ratio failures for repetitive novels.
  const bytes = zipSync(files, { level: 0 });
  if (bytes.length > 64 * 1024 * 1024) throw limit();
  try {
    readZip(bytes);
  } catch {
    throw invalid();
  }
  return { bytes, revision: snapshot.book.revision, warnings };
}
