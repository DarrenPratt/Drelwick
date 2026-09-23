import { marked } from "marked";
import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";
import type { ImporterResult } from "@sarel/project-model";

type HtmlNode = DefaultTreeAdapterMap["node"];
interface Node {
  [key: string]: unknown;
  type: string;
  text?: string;
  content?: Node[];
  attrs?: Record<string, string | number>;
  marks?: Mark[];
}
interface Mark {
  type: string;
  attrs?: { href: string };
}
export type TextFormat = "txt" | "markdown" | "html";
export interface ApprovedImage {
  reference: string;
  asset: ImporterResult["assets"][number];
}
export const TEXT_LIMITS = {
  bytes: 8 * 1024 * 1024,
  nodes: 100_000,
  depth: 32,
  warnings: 1000,
  images: 256,
} as const;
const plain = (nodes: Node[]): string =>
  nodes
    .map(
      (n) => n.text ?? (n.type === "hardBreak" ? "\n" : plain(n.content ?? [])),
    )
    .join("");
function hasControls(text: string, allowWhitespace = false) {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (
      (code <= 32 && !(allowWhitespace && [9, 10, 13, 32].includes(code))) ||
      code === 127
    )
      return true;
  }
  return false;
}
const children = (n: HtmlNode): HtmlNode[] =>
  "childNodes" in n ? n.childNodes : [];
const tag = (n: HtmlNode) => ("tagName" in n ? n.tagName : "");
const attr = (n: HtmlNode, name: string) =>
  "attrs" in n ? n.attrs.find((a) => a.name === name)?.value : undefined;
const paragraph = (text: string): Node => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});

// The VM has no TextDecoder/Buffer. Decode explicitly and fatally, without locale defaults.
function utf8(base64: string): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += 4) {
    const value =
      (alphabet.indexOf(base64[i]!) << 18) |
      (alphabet.indexOf(base64[i + 1]!) << 12) |
      (Math.max(0, alphabet.indexOf(base64[i + 2]!)) << 6) |
      Math.max(0, alphabet.indexOf(base64[i + 3]!));
    bytes.push((value >>> 16) & 255);
    if (base64[i + 2] !== "=") bytes.push((value >>> 8) & 255);
    if (base64[i + 3] !== "=") bytes.push(value & 255);
    if (bytes.length >= 4096) {
      chunks.push(
        bytes.map((b) => `%${b.toString(16).padStart(2, "0")}`).join(""),
      );
      bytes.length = 0;
    }
  }
  chunks.push(bytes.map((b) => `%${b.toString(16).padStart(2, "0")}`).join(""));
  return decodeURIComponent(chunks.join(""))
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
}

/** No HTML is returned. Only an allowlisted semantic vocabulary crosses the worker. */
export function parse(
  base64: string,
  format: TextFormat,
  approved: ApprovedImage[] = [],
): string {
  if (base64.length > Math.ceil(TEXT_LIMITS.bytes / 3) * 4)
    throw new Error("limit");
  const source = utf8(base64);
  if (hasControls(source, true)) throw new Error("encoding");
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
  const references: string[] = [];
  let index = 0;
  function warn(code: string, message: string, n?: HtmlNode) {
    if (result.warnings.length >= TEXT_LIMITS.warnings)
      throw new Error("limit");
    const line = n?.sourceCodeLocation?.startLine;
    result.warnings.push({
      code: `${format.toUpperCase()}_${code}`,
      message,
      location: {
        block: index,
        label: `${format.toUpperCase()} ${line ? `${format === "markdown" ? "converted " : ""}line ${line}` : `block ${index + 1}`}`,
      },
    });
  }
  warn(
    "METADATA_DEFAULT",
    "Missing publication metadata uses placeholders. Review title, author and language after import.",
  );
  let blocks: Node[];
  if (format === "txt") {
    blocks = [];
    // Blank lines separate paragraphs; additional blank lines remain empty paragraphs.
    let lines: string[] = [];
    let previousBlank = false;
    const flush = () => {
      if (lines.length) {
        blocks.push(paragraph(lines.join("\n")));
        lines = [];
      }
    };
    for (const line of source.replace(/\n$/, "").split("\n")) {
      index++;
      if (!line.trim()) {
        if (lines.length) flush();
        else if (previousBlank || !blocks.length) blocks.push(paragraph(""));
      } else if (line.trim() === "* * *") {
        flush();
        blocks.push({ type: "sceneBreak" });
        warn(
          "SCENE_BREAK",
          "A standalone spaced three-asterisk marker became a scene break.",
        );
      } else lines.push(line);
      previousBlank = !line.trim();
      if (blocks.length > TEXT_LIMITS.nodes) throw new Error("limit");
    }
    flush();
    warn(
      "CHAPTER_AMBIGUOUS",
      "Plain text has no reliable heading structure. All content is one chapter; adjust boundaries in preview.",
    );
  } else {
    let html = source;
    if (format === "markdown") {
      warn(
        "EXTENSIONS",
        "CommonMark and GFM are interpreted. Other extension syntax remains ordinary text where recognizable; review footnote, definition, math and directive notation.",
      );
      // No hooks, extensions, plugins, highlighting or resource resolution.
      // Unsupported definitions can otherwise be mistaken for invisible link definitions.
      if (/^\s{0,3}(?:\[\^[^\]]+\]:|:\s|\$\$|:::)/m.test(source)) {
        warn(
          "EXTENSION_RECOVERY",
          "Footnote/definition/math/directive syntax is not supported. The complete Markdown source is retained as a literal code block; no definitions are discarded.",
        );
        html = `<pre><code>${source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`;
      } else {
        const tokens = marked.lexer(source, { gfm: true });
        let visited = 0;
        const pending: { value: unknown; depth: number }[] = [
          { value: tokens, depth: 0 },
        ];
        while (pending.length) {
          const { value, depth } = pending.pop()!;
          if (++visited > TEXT_LIMITS.nodes || depth > TEXT_LIMITS.depth)
            throw new Error("limit");
          if (Array.isArray(value))
            for (const child of value)
              pending.push({ value: child, depth: depth + 1 });
          else if (value && typeof value === "object") {
            if ("type" in value && value.type === "html")
              warn(
                "RAW_HTML",
                "Raw Markdown HTML passes through the HTML semantic sanitizer; active content and unsupported semantics are removed or recovered with warnings.",
              );
            for (const child of Object.values(value))
              if (child && typeof child === "object")
                pending.push({ value: child, depth: depth + 1 });
          }
        }
        html = marked.parser(tokens);
      }
    }
    if (html.length > TEXT_LIMITS.bytes * 4) throw new Error("limit");
    const tree = parseHtml(html, {
      scriptingEnabled: false,
      sourceCodeLocationInfo: true,
      onParseError: (error) => {
        if (error.code !== "missing-doctype")
          warn(
            "HTML_REPAIR",
            "Malformed HTML required parser repair. Review recovered DOM reading order.",
          );
      },
    });
    let count = 0;
    const stack: { node: HtmlNode; depth: number }[] = [
      { node: tree, depth: 0 },
    ];
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (++count > TEXT_LIMITS.nodes || depth > TEXT_LIMITS.depth)
        throw new Error("limit");
      for (const child of children(node))
        stack.push({ node: child, depth: depth + 1 });
      if ("content" in node)
        stack.push({ node: node.content, depth: depth + 1 });
    }
    const active = new Set([
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "svg",
      "math",
      "link",
      "meta",
      "base",
    ]);
    const inlineMarks: Record<string, string> = {
      strong: "bold",
      b: "bold",
      em: "italic",
      i: "italic",
      s: "strike",
      del: "strike",
      u: "underline",
      code: "code",
    };
    const containers = new Set([
      "html",
      "body",
      "div",
      "section",
      "article",
      "main",
      "header",
      "footer",
      "nav",
      "aside",
      "figure",
      "figcaption",
    ]);
    const inlineTags = new Set([
      "span",
      "a",
      "br",
      "img",
      ...Object.keys(inlineMarks),
    ]);
    function image(n: HtmlNode): Node {
      const reference = attr(n, "src") ?? "";
      const alt = attr(n, "alt") ?? "";
      if (alt.length > 4000) throw new Error("limit");
      // Only simple relative names are eligible for an explicit picker. Never resolve them.
      const local =
        reference.length > 0 &&
        reference.length <= 1000 &&
        !/[:\\%?#\s]/u.test(reference) &&
        !reference.startsWith("/") &&
        !reference.split("/").some((p) => p === ".." || p === "." || !p);
      const image = local
        ? approved.find((a) => a.reference === reference)
        : undefined;
      if (image) {
        warn(
          "IMAGE_BLOCK",
          "An individually selected image becomes a semantic block in reading order; inline wrapping/layout is not retained.",
          n,
        );
        if (!result.assets.some((a) => a.id === image.asset.id))
          result.assets.push(image.asset);
        return {
          type: "image",
          attrs: { assetId: image.asset.id, alt, size: "medium" },
        };
      }
      if (local && !references.includes(reference)) {
        if (references.length >= TEXT_LIMITS.images) throw new Error("limit");
        references.push(reference);
      }
      warn(
        "IMAGE_UNAVAILABLE",
        "Image not imported: remote/unsafe references are blocked; local images require individual native selection. Alternative text is retained as a placeholder.",
        n,
      );
      return paragraph(`[Image not imported${alt ? `: ${alt}` : ""}]`);
    }
    function convert(
      nodes: HtmlNode[],
      marks: Mark[] = [],
      pre = false,
    ): Node[] {
      const out: Node[] = [];
      for (const n of nodes) {
        if (++index > TEXT_LIMITS.nodes) throw new Error("limit");
        if ("value" in n) {
          const text = pre ? n.value : n.value.replace(/[\t\n\r ]+/g, " ");
          if (text)
            out.push({
              type: "text",
              text,
              ...(marks.length ? { marks } : {}),
            });
          continue;
        }
        const name = tag(n);
        if (!name) {
          if (n.nodeName === "#comment")
            warn("COMMENT", "An HTML comment was omitted.", n);
          continue;
        }
        if (
          "attrs" in n &&
          n.attrs.some(
            (a) =>
              /^on/i.test(a.name) ||
              ["style", "srcset", "hidden"].includes(a.name),
          )
        )
          warn(
            "ATTRIBUTES",
            "Active/presentational attributes were removed; hidden text is visible for review.",
            n,
          );
        if (active.has(name)) {
          warn(
            "ACTIVE_CONTENT",
            "Active, embedded or resource-loading HTML was removed without execution or fetching.",
            n,
          );
          continue;
        }
        if (name === "head") {
          out.push(...convert(children(n)));
          continue;
        }
        if (name === "title") {
          const title = plain(convert(children(n))).trim();
          if (title && title.length <= 500) result.metadata.title = title;
          else if (title)
            warn("METADATA", "An unsupported title was not mapped.", n);
          continue;
        }
        if (name === "img") {
          out.push(image(n));
          continue;
        }
        if (name === "hr") {
          out.push({ type: "sceneBreak" });
          continue;
        }
        if (name === "br") {
          out.push({ type: "hardBreak" });
          continue;
        }
        if (name === "input") {
          warn(
            "CONTROL",
            "Form control behaviour was removed; available value or checkbox state is recovered as text.",
            n,
          );
          out.push({
            type: "text",
            text:
              attr(n, "type") === "checkbox"
                ? attr(n, "checked") !== undefined
                  ? "[x] "
                  : "[ ] "
                : attr(n, "value") || "[Form control]",
          });
          continue;
        }
        let next = marks;
        const mark = inlineMarks[name];
        if (mark) {
          if (
            (pre && mark !== "code") ||
            (mark === "code" && marks.length) ||
            (mark !== "code" && marks.some((m) => m.type === "code"))
          )
            warn(
              "CODE_FORMAT",
              "Formatting combined with inline code was reduced to the supported code mark.",
              n,
            );
          next =
            mark === "code"
              ? [{ type: "code" }]
              : marks.some((m) => m.type === "code" || m.type === mark)
                ? marks
                : [...marks, { type: mark }];
        }
        if (name === "a") {
          const href = attr(n, "href") ?? "";
          // Restrictive syntax here; canonical project-model URL validation runs again in host.
          if (
            /^(?:https?:\/\/[^/\s?#]+(?:[^\s]*)|mailto:[^\s]+|#[^\s]+)$/i.test(
              href,
            ) &&
            !hasControls(href) &&
            !marks.some((m) => m.type === "code" || m.type === "link")
          )
            next = [...marks, { type: "link", attrs: { href } }];
          else
            warn(
              "LINK",
              "Unsupported link target removed; link text retained without following the target.",
              n,
            );
        }
        if (
          !containers.has(name) &&
          !inlineTags.has(name) &&
          !["p", "blockquote", "ol", "ul", "li", "pre"].includes(name) &&
          !/^h[1-6]$/.test(name)
        )
          warn(
            "STRUCTURE",
            "Unsupported HTML structure reduced to readable content in DOM order.",
            n,
          );
        const content = convert(
          "content" in n ? children(n.content) : children(n),
          next,
          pre || name === "pre",
        );
        if (inlineTags.has(name)) out.push(...content);
        else if (name === "p" || /^h[1-6]$/.test(name)) {
          const parts = asBlocks(content, true);
          if (name !== "p")
            for (const part of parts)
              if (part.type === "paragraph") {
                part.type = "heading";
                part.attrs = { level: Number(name[1]) };
              }
          out.push(...parts);
        } else if (name === "pre") {
          // Preserve block images and separators even inside unsupported preformatted layout.
          let run: Node[] = [];
          const flushCode = () => {
            if (run.length) {
              const text = plain(run);
              out.push({
                type: "codeBlock",
                content: text ? [{ type: "text", text }] : [],
              });
              run = [];
            }
          };
          for (const part of content) {
            if (part.type === "text" || part.type === "hardBreak")
              run.push(part);
            else {
              flushCode();
              warn(
                "PRE_STRUCTURE",
                "A block inside preformatted content was retained separately in reading order.",
                n,
              );
              out.push(part);
            }
          }
          flushCode();
          if (!content.length) out.push({ type: "codeBlock", content: [] });
        } else if (name === "blockquote")
          out.push({ type: "blockquote", content: asBlocks(content, true) });
        else if (name === "li") {
          if (attr(n, "value") !== undefined)
            warn(
              "LIST",
              "Per-item numbering reduced to sequential list order.",
              n,
            );
          const items = asBlocks(content, true);
          if (items[0]?.type !== "paragraph") items.unshift(paragraph(""));
          out.push({ type: "listItem", content: items });
        } else if (name === "ol" || name === "ul") {
          const items: Node[] = [];
          for (const part of asBlocks(content)) {
            if (part.type === "listItem") items.push(part);
            else {
              warn(
                "LIST",
                "Content outside list items retained as an additional item.",
                n,
              );
              items.push({ type: "listItem", content: [paragraph(""), part] });
            }
          }
          const start = Number(attr(n, "start") ?? "1");
          if (!Number.isSafeInteger(start)) throw new Error("list");
          if (
            attr(n, "reversed") !== undefined ||
            attr(n, "type") !== undefined
          )
            warn(
              "LIST",
              "List numbering presentation reduced to a forward semantic list.",
              n,
            );
          if (items.length)
            out.push({
              type: name === "ol" ? "orderedList" : "bulletList",
              ...(name === "ol" ? { attrs: { start } } : {}),
              content: items,
            });
        } else out.push(...asBlocks(content));
      }
      return out;
    }
    function asBlocks(nodes: Node[], keepEmpty = false): Node[] {
      const out: Node[] = [];
      let inline: Node[] = [];
      const flush = () => {
        // HTML collapses ASCII whitespace across inline element boundaries too.
        let space = true;
        for (const node of inline) {
          if (node.text !== undefined) {
            if (space) node.text = node.text.replace(/^ +/, "");
            if (node.text) space = node.text.endsWith(" ");
          } else space = node.type === "hardBreak";
        }
        const last = inline.at(-1);
        if (last?.text !== undefined) last.text = last.text.replace(/ +$/, "");
        inline = inline.filter((node) => node.text !== "");
        if (inline.some((n) => n.type === "hardBreak" || n.text?.trim()))
          out.push({ type: "paragraph", content: inline });
        inline = [];
      };
      for (const node of nodes) {
        if (node.type === "text" || node.type === "hardBreak")
          inline.push(node);
        else {
          flush();
          out.push(node);
        }
      }
      flush();
      if (!out.length && keepEmpty) out.push(paragraph(""));
      return out;
    }
    blocks = asBlocks(convert(children(tree)));
  }
  let chapter: ImporterResult["chapters"][number] | undefined;
  if (
    format !== "txt" &&
    blocks.filter((n) => n.type === "heading" && n.attrs?.level === 1)
      .length === 1 &&
    blocks.some((n) => n.type === "heading" && n.attrs?.level !== 1)
  )
    warn(
      "CHAPTER_AMBIGUOUS",
      "A single Heading 1 with weaker headings may be a book title rather than a chapter. Review and adjust the proposals.",
    );
  blocks.forEach((node, block) => {
    index = block;
    const heading = node.type === "heading" && node.attrs?.level === 1;
    if (!chapter || heading) {
      const fullTitle = heading ? plain([node]).trim() : "Opening";
      const title =
        fullTitle.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "") ||
        "Untitled chapter";
      if (fullTitle.length > 200)
        warn(
          "CHAPTER_TITLE",
          "Long proposal title shortened; complete heading retained.",
        );
      chapter = {
        title,
        type: "chapter",
        content: { type: "doc", content: [] },
      };
      result.chapters.push(chapter);
      if (result.chapters.length > 1000) throw new Error("limit");
      if (heading)
        warn(
          "CHAPTER_PROPOSAL",
          "Heading 1 proposes a chapter boundary. Review and adjust boundaries; the heading is retained.",
        );
    }
    chapter.content.content!.push(node);
  });
  if (
    format !== "txt" &&
    !blocks.some((n) => n.type === "heading" && n.attrs?.level === 1)
  )
    warn(
      "CHAPTER_AMBIGUOUS",
      "No top-level Heading 1 identifies chapters. Content remains one chapter; adjust boundaries in preview.",
    );
  if (!result.chapters.length)
    result.chapters.push({
      title: "Opening",
      type: "chapter",
      content: { type: "doc", content: [] },
    });
  return JSON.stringify({ manuscript: result, references });
}
