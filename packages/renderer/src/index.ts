import {
  isSupportedManuscriptLink,
  ManuscriptDocumentSchema,
  ImageAssetIdSchema,
} from "@drelwick/project-model";
import type {
  AssetReference,
  BookRevision,
  RenderDiagnostic,
  RenderOptions,
  RenderedBook,
  SemanticTarget,
} from "./types.js";
export * from "./types.js";
export * from "./themes.js";

/** Deliberate publishing vocabulary. Dispatch below is exhaustive over these keys. */
export const SEMANTIC_NODES = [
  "doc",
  "text",
  "paragraph",
  "heading",
  "hardBreak",
  "blockquote",
  "epigraph",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "sceneBreak",
  "horizontalRule",
  "image",
] as const;
export const SEMANTIC_MARKS = [
  "link",
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
] as const;
type NodeType = (typeof SEMANTIC_NODES)[number];
type MarkType = (typeof SEMANTIC_MARKS)[number];
interface Node {
  type: NodeType;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: { type: MarkType; attrs?: Record<string, unknown> }[];
}

export function escapeXml(value: string): string {
  return value.replace(
    /[&<>"'\r\n\t]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\r": "&#13;",
        "\n": "&#10;",
        "\t": "&#9;",
      })[character]!,
  );
}
// XML 1.0 cannot represent these characters. Block instead of silently replacing prose.
function hasInvalidXml(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0)!;
    return (
      point !== 9 &&
      point !== 10 &&
      point !== 13 &&
      !(point >= 0x20 && point <= 0xd7ff) &&
      !(point >= 0xe000 && point <= 0xfffd) &&
      !(point >= 0x10000 && point <= 0x10ffff)
    );
  });
}
export const chapterAnchor = (id: string): string =>
  `chapter-${id.toLowerCase()}`;
export const nodeAnchor = (id: string, path: readonly number[]): string =>
  `${chapterAnchor(id)}-node-${path.join("-")}`;
/** Strict local output paths; no URL parser normalization, queries, traversal or schemes. */
export function isSafePublicationReference(value: string): boolean {
  return (
    /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:#[A-Za-z0-9_-]+)?$/.test(
      value,
    ) || /^#[A-Za-z0-9_-]+$/.test(value)
  );
}
function safeAsset(reference: AssetReference, mediaType: string): boolean {
  return reference.kind === "relative"
    ? isSafePublicationReference(reference.value) &&
        !reference.value.includes("#")
    : reference.kind === "embedded" &&
        reference.value.startsWith(`data:${mediaType};base64,`) &&
        /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          reference.value,
        );
}

/** No DOM, filesystem, Electron, network, clock, random state, or manuscript logging. */
export function renderBook(
  book: BookRevision,
  options: RenderOptions,
): RenderedBook {
  const diagnostics: RenderDiagnostic[] = [];
  const targets = new Map<string, SemanticTarget>();
  const documents = new Map<string, Node>();
  const add = (
    chapterId: string,
    path: readonly number[],
    code: RenderDiagnostic["code"],
    extra: Partial<RenderDiagnostic> = {},
  ) => diagnostics.push({ code, severity: "error", chapterId, path, ...extra });
  const identities = book.chapters.map((chapter) => chapter.id.toLowerCase());
  if (
    new Set(identities).size !== identities.length ||
    identities.some((id) => !ImageAssetIdSchema.safeParse(id).success)
  ) {
    add("", [], "invalid-structure");
    return { ok: false, revision: book.revision, chapters: [], diagnostics };
  }
  for (const chapter of book.chapters) {
    const scan = (value: unknown, path: number[]) => {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (!SEMANTIC_NODES.includes(node.type as NodeType))
        add(chapter.id, path, "unsupported-node");
      if (Array.isArray(node.marks))
        for (const value of node.marks) {
          if (!value || typeof value !== "object") continue;
          const mark = value as { type?: unknown; attrs?: { href?: unknown } };
          if (!SEMANTIC_MARKS.includes(mark.type as MarkType))
            add(chapter.id, path, "unsupported-mark");
          if (
            mark.type === "link" &&
            (typeof mark.attrs?.href !== "string" ||
              !isSupportedManuscriptLink(mark.attrs.href))
          )
            add(chapter.id, path, "unsafe-url");
        }
      if (Array.isArray(node.content))
        node.content.forEach((child, index) => scan(child, [...path, index]));
    };
    scan(chapter.document, []);
    const parsed = ManuscriptDocumentSchema.safeParse(chapter.document);
    if (!parsed.success) {
      add(chapter.id, [], "invalid-structure");
      continue;
    }
    const root = parsed.data as Node;
    // Check all string attributes as well as text, without emitting their values.
    const validStrings = (value: unknown): boolean =>
      typeof value === "string"
        ? !hasInvalidXml(value)
        : Array.isArray(value)
          ? value.every(validStrings)
          : value !== null && typeof value === "object"
            ? Object.values(value).every(validStrings)
            : true;
    if (!validStrings(root) || hasInvalidXml(chapter.title)) {
      add(chapter.id, [], "invalid-xml-text");
      continue;
    }
    documents.set(chapter.id, root);
    targets.set(chapterAnchor(chapter.id), {
      chapterId: chapter.id,
      id: chapterAnchor(chapter.id),
      path: [],
    });
    const visit = (node: Node, path: number[]) => {
      if (node.type === "heading")
        targets.set(nodeAnchor(chapter.id, path), {
          chapterId: chapter.id,
          id: nodeAnchor(chapter.id, path),
          path,
        });
      node.content?.forEach((child, index) => visit(child, [...path, index]));
    };
    visit(root, []);
  }
  const chapters = book.chapters.flatMap((chapter) => {
    const root = documents.get(chapter.id);
    if (!root) return [];
    const assetIds = new Set<string>();
    const report = (
      path: number[],
      code: RenderDiagnostic["code"],
      extra: Partial<RenderDiagnostic> = {},
    ) => add(chapter.id, path, code, extra);
    const children = (node: Node, path: number[]): string =>
      (node.content ?? [])
        .map((child, index) => render(child, [...path, index]))
        .join("");
    const wrap = (tag: string, node: Node, path: number[], attrs = "") =>
      `<${tag}${attrs}>${children(node, path)}</${tag}>`;
    const dispatch: Record<NodeType, (node: Node, path: number[]) => string> = {
      doc: children,
      text: (node) => escapeXml(node.text!),
      paragraph: (node, path) => wrap("p", node, path),
      heading: (node, path) =>
        wrap(
          `h${node.attrs!.level}`,
          node,
          path,
          ` id="${nodeAnchor(chapter.id, path)}"`,
        ),
      hardBreak: () => "<br />",
      blockquote: (node, path) => wrap("blockquote", node, path),
      epigraph: (node, path) =>
        `<figure class="epigraph">${wrap("blockquote", node, path)}${typeof node.attrs?.attribution === "string" ? `<figcaption>${escapeXml(node.attrs.attribution)}</figcaption>` : ""}</figure>`,
      bulletList: (node, path) => wrap("ul", node, path),
      orderedList: (node, path) =>
        wrap(
          "ol",
          node,
          path,
          ` start="${node.attrs?.start ?? 1}"${typeof node.attrs?.type === "string" && ["1", "a", "A", "i", "I"].includes(node.attrs.type) ? ` type="${node.attrs.type}"` : ""}`,
        ),
      listItem: (node, path) => wrap("li", node, path),
      codeBlock: (node, path) =>
        `<pre><code${typeof node.attrs?.language === "string" ? ` data-language="${escapeXml(node.attrs.language)}"` : ""}>${children(node, path)}</code></pre>`,
      sceneBreak: () => '<hr class="scene-break" />',
      horizontalRule: () => "<hr />",
      image: (node, path) => {
        const id = node.attrs!.assetId as string;
        assetIds.add(id);
        const asset = book.assets.find((entry) =>
          entry.status === "available"
            ? entry.descriptor.id === id
            : entry.id === id,
        );
        const placeholder = () =>
          `<span class="missing-image" role="img" aria-label="${escapeXml(node.attrs!.alt as string)}" data-asset-id="${id}"></span>`;
        if (!asset || asset.status !== "available") {
          report(
            path,
            asset?.status === "invalid" ? "invalid-asset" : "missing-asset",
            { assetId: id, nodeType: "image" },
          );
          return placeholder();
        }
        if (!["image/png", "image/jpeg"].includes(asset.descriptor.mediaType)) {
          report(path, "invalid-asset", { assetId: id });
          return placeholder();
        }
        let reference: AssetReference | undefined;
        try {
          reference = options.resolveAsset(asset.descriptor, {
            chapterId: chapter.id,
            path,
          });
        } catch {
          /* Resolver errors must not leak manuscript data or paths. */
        }
        if (!reference || !safeAsset(reference, asset.descriptor.mediaType)) {
          report(path, "unsafe-asset-reference", { assetId: id });
          return placeholder();
        }
        return `<img src="${escapeXml(reference.value)}" alt="${escapeXml(node.attrs!.alt as string)}" class="manuscript-image image-${node.attrs!.size}" data-asset-id="${id}" />`;
      },
    };
    const markTags: Record<Exclude<MarkType, "link">, string> = {
      bold: "strong",
      italic: "em",
      underline: "u",
      strike: "s",
      code: "code",
    };
    function render(node: Node, path: number[]): string {
      let markup = dispatch[node.type](node, path);
      // Fixed outer-to-inner order, independent of stored mark array order.
      for (const type of [...SEMANTIC_MARKS].reverse()) {
        const mark = node.marks?.find((mark) => mark.type === type);
        if (!mark) continue;
        if (type !== "link") {
          const tag = markTags[type];
          markup = `<${tag}>${markup}</${tag}>`;
          continue;
        }
        let href = mark.attrs!.href as string;
        if (href.startsWith("#")) {
          const target = targets.get(href.slice(1));
          if (!target) {
            report(path, "unresolved-internal-link", { severity: "warning" });
            continue;
          }
          try {
            href = options.resolveInternalLink
              ? (options.resolveInternalLink(target, chapter.id) ?? "")
              : `#${target.id}`;
          } catch {
            href = "";
          }
          if (!isSafePublicationReference(href)) {
            report(path, "unsafe-url");
            continue;
          }
        }
        const title =
          typeof mark.attrs?.title === "string"
            ? ` title="${escapeXml(mark.attrs.title)}"`
            : "";
        markup =
          options.links === "inert"
            ? `<span class="manuscript-link"${title}>${markup}</span>`
            : `<a href="${escapeXml(href)}"${title}>${markup}</a>`;
      }
      return markup;
    }
    const anchor = chapterAnchor(chapter.id);
    const xhtml = `<section class="chapter" id="${anchor}" data-chapter-type="${escapeXml(chapter.type)}"><h1 class="chapter-title">${escapeXml(chapter.title)}</h1><div class="chapter-body">${render(root, [])}</div></section>`;
    return [
      {
        id: chapter.id,
        anchor,
        title: chapter.title,
        xhtml,
        targets: [...targets.values()].filter(
          (target) => target.chapterId === chapter.id,
        ),
        assetIds: [...assetIds],
      },
    ];
  });
  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    revision: book.revision,
    chapters,
    diagnostics,
  };
}
