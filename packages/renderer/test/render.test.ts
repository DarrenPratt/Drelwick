import { expect, it } from "vitest";
import { ManuscriptDocumentSchema } from "@drelwick/project-model";
import {
  renderBook,
  SEMANTIC_NODES,
  SEMANTIC_MARKS,
  type BookRevision,
  type RenderOptions,
  type AssetReference,
} from "../src/index.js";
import { fixture, assetId, chapterId } from "./fixture.js";
const options: RenderOptions = {
  resolveAsset: (asset) => ({
    kind: "relative",
    value: `images/${asset.id}.png`,
  }),
};
function xml(markup: string) {
  const result = new DOMParser().parseFromString(
    `<main xmlns="http://www.w3.org/1999/xhtml">${markup}</main>`,
    "application/xhtml+xml",
  );
  expect(result.querySelector("parsererror")).toBeNull();
  return result;
}
interface Source {
  type: string;
  text?: string;
  attrs?: { attribution?: string; alt?: string };
  content?: Source[];
  marks?: { type: string }[];
}
/** No whitespace folding. Only hard breaks introduce separators; images contribute alt. */
function sourceText(node: Source): string {
  if (node.type === "text") return node.text!;
  if (node.type === "hardBreak") return "\n";
  if (node.type === "image") return node.attrs!.alt!;
  return (
    (node.content ?? []).map(sourceText).join("") +
    (node.type === "epigraph" ? (node.attrs?.attribution ?? "") : "")
  );
}
function renderedText(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue!;
  if (node instanceof Element && node.localName === "br") return "\n";
  if (node instanceof Element && node.localName === "img")
    return node.getAttribute("alt")!;
  return Array.from(node.childNodes).map(renderedText).join("");
}
it("golden XHTML covers the entire supported vocabulary and exact reading order", async () => {
  const book = fixture();
  const result = renderBook(book, options);
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
  await expect(result.chapters[0]!.xhtml).toMatchFileSnapshot(
    "./golden/book.xhtml",
  );
  const parsed = xml(result.chapters[0]!.xhtml);
  expect(renderedText(parsed.querySelector(".chapter-body")!)).toBe(
    sourceText(book.chapters[0]!.document as Source),
  );
  expect(parsed.querySelector(".chapter-title")!.textContent).toBe(
    book.chapters[0]!.title,
  );
  const nodes = new Set<string>();
  const marks = new Set<string>();
  const visit = (node: Source) => {
    nodes.add(node.type);
    node.marks?.forEach((mark) => marks.add(mark.type));
    node.content?.forEach(visit);
  };
  visit(book.chapters[0]!.document as Source);
  expect([...nodes].sort()).toEqual([...SEMANTIC_NODES].sort());
  expect([...marks].sort()).toEqual([...SEMANTIC_MARKS].sort());
  expect(
    parsed.querySelectorAll(
      "script,iframe,object,style,[style],[target],[onclick],.evil",
    ),
  ).toHaveLength(0);
  expect(parsed.querySelectorAll("strong > em")).toHaveLength(2);
  expect(parsed.querySelectorAll("a > em")).toHaveLength(1);
  expect(parsed.querySelector("ul ol ul")).not.toBeNull();
  expect(parsed.querySelector("ol")?.getAttribute("start")).toBe("3");
  expect(renderBook(book, options)).toEqual(result);
});
it.each(["bold", "italic", "underline", "strike", "code", "link"])(
  "preserves %s on text and hard breaks",
  (type) => {
    const book = fixture();
    const mark =
      type === "link"
        ? { type, attrs: { href: "mailto:author@example.invalid" } }
        : { type };
    book.chapters[0]!.document.content = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "A", marks: [mark] },
          { type: "hardBreak", marks: [mark] },
          { type: "text", text: "B" },
        ],
      },
    ];
    const result = renderBook(book, options);
    expect(result.ok).toBe(true);
    expect(
      renderedText(
        xml(result.chapters[0]!.xhtml).querySelector(".chapter-body")!,
      ),
    ).toBe("A\nB");
  },
);
it.each([
  "https://example.invalid/?a=1&b=2",
  "http://example.invalid",
  "mailto:a@example.invalid",
  `#chapter-${chapterId}`,
])("renders supported link %s", (href) => {
  const book = fixture();
  book.chapters[0]!.document.content = [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "label",
          marks: [{ type: "link", attrs: { href } }],
        },
      ],
    },
  ];
  const result = renderBook(book, options);
  expect(result.ok).toBe(true);
  expect(
    xml(result.chapters[0]!.xhtml).querySelector("a")!.getAttribute("href"),
  ).toBe(href);
});
it.each([
  "javascript:alert(1)",
  "file:///secret",
  "data:text/html,x",
  "custom:run",
  "//example.invalid",
  "https://",
  " https://example.invalid",
  "https://example.invalid/\nattack",
])("blocks unsafe stored URL %s", (href) => {
  const book = fixture();
  book.chapters[0]!.document.content = [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "PRIVATE LABEL",
          marks: [{ type: "link", attrs: { href } }],
        },
      ],
    },
  ];
  const result = renderBook(book, options);
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "unsafe-url", path: [0, 0] }),
  );
  expect(result.chapters).toEqual([]);
  expect(JSON.stringify(result.diagnostics)).not.toMatch(
    /PRIVATE|alert|secret/,
  );
});
it("resolves semantic fragments for packaging and reports unresolved fragments without losing labels", () => {
  const book = fixture();
  const result = renderBook(book, {
    ...options,
    resolveInternalLink: (target) => `chapters/one.xhtml#${target.id}`,
  });
  expect(
    xml(result.chapters[0]!.xhtml).querySelector('a[href^="chapters/"]'),
  ).not.toBeNull();
  book.chapters[0]!.document.content = [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "unresolved label",
          marks: [{ type: "link", attrs: { href: "#unknown" } }],
        },
      ],
    },
  ];
  const unresolved = renderBook(book, options);
  expect(unresolved.diagnostics).toEqual([
    {
      code: "unresolved-internal-link",
      severity: "warning",
      chapterId,
      path: [0, 0],
    },
  ]);
  expect(
    xml(unresolved.chapters[0]!.xhtml).querySelector(".chapter-body")!
      .textContent,
  ).toBe("unresolved label");
});
it.each(["missing", "invalid"] as const)(
  "reports every %s asset occurrence with a safe alternative",
  (status) => {
    const book = fixture();
    book.assets = [{ status, id: assetId }];
    const result = renderBook(book, options);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.filter((entry) => entry.code === `${status}-asset`),
    ).toHaveLength(4);
    expect(
      xml(result.chapters[0]!.xhtml).querySelectorAll(".missing-image"),
    ).toHaveLength(4);
    expect(result.chapters[0]!.xhtml).not.toContain("src=");
  },
);
it.each([
  "file:///secret",
  "https://example.invalid/x.png",
  "../secret",
  "/absolute",
  "a\\b",
  "data:image/svg+xml;base64,AAAA",
  "javascript:alert(1)",
])("rejects unsafe asset reference %s", (value) => {
  const result = renderBook(fixture(), {
    resolveAsset: () => ({
      kind: value.startsWith("data:") ? "embedded" : "relative",
      value,
    }),
  });
  expect(result.ok).toBe(false);
  expect(
    result.diagnostics.every(
      (entry) => entry.code === "unsafe-asset-reference",
    ),
  ).toBe(true);
  expect(xml(result.chapters[0]!.xhtml).querySelectorAll("img")).toHaveLength(
    0,
  );
});
it("rejects unsupported assets and safely catches resolver failures", () => {
  const book = fixture();
  if (book.assets[0]!.status === "available")
    Object.assign(book.assets[0]!.descriptor, { mediaType: "image/svg+xml" });
  expect(
    renderBook(book, options).diagnostics.every(
      (entry) => entry.code === "invalid-asset",
    ),
  ).toBe(true);
  expect(
    renderBook(fixture(), {
      resolveAsset: () => {
        throw new Error("private path");
      },
    }).diagnostics.every((entry) => entry.code === "unsafe-asset-reference"),
  ).toBe(true);
});
it("supports validated embedded PNG and JPEG references without output-specific paths", () => {
  for (const mediaType of ["image/png", "image/jpeg"] as const) {
    const book = fixture();
    if (book.assets[0]!.status === "available")
      book.assets[0]!.descriptor.mediaType = mediaType;
    const reference: AssetReference = {
      kind: "embedded",
      value: `data:${mediaType};base64,AAAA`,
    };
    expect(renderBook(book, { resolveAsset: () => reference }).ok).toBe(true);
  }
});
it.each(["node", "mark"])(
  "reports unknown %s explicitly without including arbitrary content",
  (kind) => {
    const book = fixture();
    book.chapters[0]!.document.content =
      kind === "node"
        ? [
            {
              type: "PRIVATE_UNKNOWN",
              content: [{ type: "text", text: "PRIVATE PROSE" }],
            },
          ]
        : [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "PRIVATE PROSE",
                  marks: [{ type: "PRIVATE_UNKNOWN" }],
                },
              ],
            },
          ];
    const result = renderBook(book, options);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((entry) => entry.code === `unsupported-${kind}`),
    ).toBe(true);
    expect(JSON.stringify(result.diagnostics)).not.toContain("PRIVATE");
  },
);
it("blocks malformed structure and unrepresentable XML text instead of dropping prose", () => {
  for (const document of [
    { type: "doc", content: [{ type: "listItem", content: [] }] },
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "bad\u0000text" }],
        },
      ],
    },
  ]) {
    const book = fixture();
    Object.assign(book.chapters[0]!, { document });
    const result = renderBook(book, options);
    expect(result.ok).toBe(false);
    expect(result.chapters).toEqual([]);
  }
});
it("accepts historical empty documents and produces no theme or target CSS", () => {
  const book: BookRevision = fixture();
  book.chapters[0]!.document = ManuscriptDocumentSchema.parse({ type: "doc" });
  const result = renderBook(book, options);
  expect(result.ok).toBe(true);
  expect(result.chapters[0]!.xhtml).not.toMatch(
    /style=|<style|font|margin|page-size/,
  );
});

it("preserves XML attribute whitespace exactly and rejects duplicate chapter anchors", () => {
  const book = fixture();
  book.chapters[0]!.document.content = [
    { type: "image", attrs: { assetId, alt: "a\tb\nc\rd", size: "small" } },
  ];
  expect(
    xml(renderBook(book, options).chapters[0]!.xhtml)
      .querySelector("img")!
      .getAttribute("alt"),
  ).toBe("a\tb\nc\rd");
  book.chapters = [
    book.chapters[0]!,
    { ...book.chapters[0]!, id: chapterId.toUpperCase() },
  ];
  expect(renderBook(book, options)).toMatchObject({
    ok: false,
    chapters: [],
    diagnostics: [{ code: "invalid-structure" }],
  });
});

it("canonicalizes mark order and resolves forward cross-chapter targets", () => {
  const book = fixture();
  const document = (marks: unknown[]) =>
    ManuscriptDocumentSchema.parse({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Same text", marks }],
        },
      ],
    });
  const marks = [
    { type: "italic" },
    { type: "bold" },
    { type: "link", attrs: { href: "https://example.invalid" } },
  ];
  book.chapters[0]!.document = document(marks);
  const first = renderBook(book, options);
  book.chapters[0]!.document = document([...marks].reverse());
  expect(renderBook(book, options)).toEqual(first);
  const nextId = "00000000-0000-4000-8000-000000000212";
  book.chapters = [book.chapters[0]!, { ...book.chapters[0]!, id: nextId }];
  book.chapters[0]!.document = document([
    { type: "link", attrs: { href: `#chapter-${nextId}` } },
  ]);
  const linked = renderBook(book, options);
  expect(linked.ok).toBe(true);
  expect(
    xml(linked.chapters[0]!.xhtml).querySelector("a")!.getAttribute("href"),
  ).toBe(`#chapter-${nextId}`);
});

it.each([
  "javascript:alert(1)",
  "file:///secret",
  "https://remote.invalid/chapter",
  "../outside.xhtml",
  undefined,
])("rejects unsafe/unresolved internal resolver output %s", (value) => {
  const result = renderBook(fixture(), {
    ...options,
    resolveInternalLink: () => value,
  });
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "unsafe-url" }),
  );
  expect(
    xml(result.chapters[0]!.xhtml).querySelector(
      'a[href^="javascript:"], a[href^="file:"], a[href^="../"]',
    ),
  ).toBeNull();
});

it("contains failing internal resolvers without exposing error content", () => {
  const result = renderBook(fixture(), {
    ...options,
    resolveInternalLink: () => {
      throw new Error("PRIVATE resolver payload");
    },
  });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result.diagnostics)).not.toContain("PRIVATE");
});
