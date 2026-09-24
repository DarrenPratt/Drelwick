import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  TextManuscriptImporter,
  StagedManuscriptImport,
  IsolatedManuscriptImporter,
  validateProjectFiles,
  createProject,
  loadChapter,
  type TextFormat,
} from "@drelwick/core";
import {
  validateImportedManuscript,
  ManuscriptDocumentSchema,
} from "@drelwick/project-model";
import { syntheticImage } from "../../../tests/helpers/synthetic-images.js";

const signal = () => new AbortController().signal;
const parse = async (format: TextFormat, text: string | Uint8Array) =>
  validateImportedManuscript(
    await new TextManuscriptImporter(format).parse(
      typeof text === "string" ? Buffer.from(text, "utf8") : text,
      signal(),
    ),
  );
const fixture = (extension: string) =>
  readFile(
    new URL(
      `../../../tests/fixtures/import/novel.${extension}`,
      import.meta.url,
    ),
  );
const unicode = "Café “hello” — – Ελληνικά 日本語 العربية 🌱 é";
const p = (text: string) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const h = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const item = (text: string) => ({ type: "listItem", content: [p(text)] });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "drelwick-text-import-"));
  roots.push(path);
  return path;
}

it.each([
  "[^note]: Footnote body",
  "Term\n: Definition",
  "$$\nx + y\n$$",
  "::: custom\nbody\n:::",
])(
  "unsupported extension preserves the complete source: %s",
  async (extension) => {
    const source = `# Heading\n\nBefore\n\n${extension}\n\nAfter`;
    const r = await parse("markdown", source);
    expect(r.chapters[0]!.content.content).toEqual([
      { type: "codeBlock", content: [{ type: "text", text: source }] },
    ]);
    expect(
      r.warnings.some((w) => w.code === "MARKDOWN_EXTENSION_RECOVERY"),
    ).toBe(true);
  },
);

it("malformed HTML is repaired inertly and whitespace preserves nested inline reading order", async () => {
  const r = await parse(
    "html",
    "<p>Hello <strong>important <em>world</strong> again.</em></p><p>next",
  );
  const text = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    if ("text" in node) return String(node.text);
    return "content" in node && Array.isArray(node.content)
      ? node.content.map(text).join("")
      : "";
  };
  expect(r.chapters[0]!.content.content?.map(text)).toEqual([
    "Hello important world again.",
    "next",
  ]);
  expect(
    (
      await parse(
        "html",
        "<p>  Hello <span> </span><b> important</b> again.  </p>",
      )
    ).chapters[0]!.content.content?.map(text),
  ).toEqual(["Hello important again."]);
});

it.each(["txt", "markdown", "html"] as const)(
  "%s invalid encoding and parser rejection preserve source during staged inspection",
  async (format) => {
    const dir = await root();
    const source = join(dir, "source");
    for (const bytes of [
      Buffer.from([0xc3, 0x28]),
      Buffer.from("before\u0000after"),
    ]) {
      await writeFile(source, bytes);
      await expect(
        StagedManuscriptImport.inspect(
          source,
          new TextManuscriptImporter(format),
          { signal: signal() },
        ),
      ).rejects.toBeDefined();
      expect(await readFile(source)).toEqual(bytes);
      expect(await readdir(dir)).toEqual(["source"]);
    }
  },
);

it("cancellation during image authorization cannot read or stage the selected file", async () => {
  const dir = await root();
  const source = join(dir, "source.html");
  const bytes = Buffer.from('<img src="image.png">');
  await writeFile(source, bytes);
  const abort = new AbortController();
  const importer = new TextManuscriptImporter("html", async () => {
    abort.abort();
    return join(dir, "does-not-exist.png");
  });
  await expect(
    StagedManuscriptImport.inspect(source, importer, { signal: abort.signal }),
  ).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
  expect(await readFile(source)).toEqual(bytes);
  expect(await readdir(dir)).toEqual(["source.html"]);
});

it("preformatted text retains leading newlines, hard breaks and image positions", async () => {
  const source = "\n[^n]: Note\n";
  expect(
    (await parse("markdown", source)).chapters[0]!.content.content,
  ).toEqual([{ type: "codeBlock", content: [{ type: "text", text: source }] }]);
  const r = await parse(
    "html",
    '<pre>before<br>line<img src="https://example.invalid/a" alt="Picture">after</pre>',
  );
  expect(r.chapters[0]!.content.content).toEqual([
    { type: "codeBlock", content: [{ type: "text", text: "before\nline" }] },
    p("[Image not imported: Picture]"),
    { type: "codeBlock", content: [{ type: "text", text: "after" }] },
  ]);
  expect(r.warnings.some((w) => w.code === "HTML_PRE_STRUCTURE")).toBe(true);
});

it.each(["markdown", "html"] as const)(
  "%s selected assets survive shared commit and source removal",
  async (format) => {
    const dir = await root();
    const source = join(dir, "source");
    const image = join(dir, "chosen.png");
    const destination = join(dir, "destination");
    const bytes = await syntheticImage();
    await writeFile(image, bytes);
    await mkdir(destination);
    const original = Buffer.from(
      format === "html"
        ? '<p>before<img src="image.png" alt="海">after</p>'
        : "before ![海](image.png) after",
    );
    await writeFile(source, original);
    const stage = await StagedManuscriptImport.inspect(
      source,
      new TextManuscriptImporter(format, async () => image),
      { signal: signal() },
    );
    const id = stage.preview.assets[0]!.id;
    await stage.commit(destination, { signal: signal() });
    expect(await readFile(source)).toEqual(original);
    expect(await readFile(image)).toEqual(bytes);
    await rm(image); // Remove only this test-owned file; committed originals must remain independent.
    expect(
      await readFile(join(destination, "assets", "images", id, "original.png")),
    ).toEqual(bytes);
    const project = await validateProjectFiles(destination);
    const chapter = await loadChapter({
      projectPath: destination,
      chapterId: project.project.manuscript.order[0]!,
    });
    expect(
      ManuscriptDocumentSchema.parse(chapter.content).content?.map(
        (n) => n.type,
      ),
    ).toEqual(["paragraph", "image", "paragraph"]);
  },
);
it("TXT golden: exact paragraphs, Unicode, conservative chapters and scene breaks", async () => {
  const result = await parse("txt", await fixture("txt"));
  expect(result.chapters).toEqual([
    {
      title: "Opening",
      type: "chapter",
      content: {
        type: "doc",
        content: [
          p("CHAPTER ONE"),
          p(`${unicode}\ncontinued line.`),
          { type: "sceneBreak" },
          p("CHAPTER TWO"),
          p("Last paragraph."),
        ],
      },
    },
  ]);
  expect(result.warnings.map((w) => w.code)).toContain("TXT_CHAPTER_AMBIGUOUS");
});
it.each(["markdown", "html"] as const)(
  "%s golden: exact semantic order and chapter proposals",
  async (format) => {
    const result = await parse(
      format,
      await fixture(format === "markdown" ? "md" : "html"),
    );
    expect(result.chapters.map((c) => c.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    expect(result.chapters[0]!.content.content).toEqual([
      h(1, "Chapter One"),
      p(unicode),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "important ", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: "world",
            marks: [{ type: "bold" }, { type: "italic" }],
          },
          { type: "text", text: " again." },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [item("First"), item("Second")],
      },
      { type: "bulletList", content: [item("Apple"), item("Pear")] },
      { type: "blockquote", content: [p("Quoted words.")] },
      { type: "sceneBreak" },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Safe link",
            marks: [
              { type: "link", attrs: { href: "https://example.invalid/book" } },
            ],
          },
        ],
      },
      h(2, "Section"),
    ]);
    expect(result.chapters[1]!.content.content).toEqual([
      h(1, "Chapter Two"),
      p("Last paragraph."),
    ]);
    expect(
      result.warnings.filter((w) => w.code.endsWith("CHAPTER_PROPOSAL")),
    ).toHaveLength(2);
  },
);
it.each(["txt", "markdown", "html"] as const)(
  "%s explicit UTF-8 preserves BOM, combining marks and all line endings",
  async (format) => {
    const source =
      format === "html" ? `<p>${unicode}</p>\n<p>end</p>` : `${unicode}\n\nend`;
    const expected = await parse(format, source);
    for (const ending of ["\n", "\r\n", "\r"])
      expect(
        (await parse(format, `\uFEFF${source.replace(/\n/g, ending)}`))
          .chapters,
      ).toEqual(expected.chapters);
    for (const bytes of [
      [0xc3, 0x28],
      [0xed, 0xa0, 0x80],
      [0xf0, 0x9f],
      [0xff, 0xfe, 0x61, 0],
      [0xc0, 0xaf],
    ])
      await expect(parse(format, new Uint8Array(bytes))).rejects.toMatchObject({
        code: "IMPORT_INVALID",
      });
  },
);
it("TXT preserves uppercase, short lines, ambiguous separators and extra blank paragraphs", async () => {
  const r = await parse("txt", "TITLE\nshort\n\n\n---\n# #\n");
  expect(r.chapters[0]!.content.content).toEqual([
    p("TITLE\nshort"),
    p(""),
    p("---\n# #"),
  ]);
});
it.each(["markdown", "html"] as const)(
  "%s weaker/nested headings stay in one adjustable chapter",
  async (format) => {
    const r = await parse(
      format,
      format === "markdown"
        ? "## First\n\n> # Quoted\n\n## Second"
        : "<h2>First</h2><blockquote><h1>Quoted</h1></blockquote><h2>Second</h2>",
    );
    expect(r.chapters).toHaveLength(1);
    expect(r.warnings.some((w) => w.code.endsWith("CHAPTER_AMBIGUOUS"))).toBe(
      true,
    );
  },
);
it("nested mixed lists retain ordered structure", async () => {
  const r = await parse(
    "markdown",
    "3. Outer\n   - Inner\n     1. Deep\n4. End",
  );
  expect(r.chapters[0]!.content.content).toEqual([
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [
            p("Outer"),
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    p("Inner"),
                    {
                      type: "orderedList",
                      attrs: { start: 1 },
                      content: [item("Deep")],
                    },
                  ],
                },
              ],
            },
          ],
        },
        item("End"),
      ],
    },
  ]);
});

it.each(["markdown", "html"] as const)(
  "%s all heading levels are semantic but only level one proposes a chapter",
  async (format) => {
    const levels = [1, 2, 3, 4, 5, 6];
    const source = levels
      .map((level) =>
        format === "html"
          ? `<h${level}>Level ${level}</h${level}>`
          : `${"#".repeat(level)} Level ${level}`,
      )
      .join("\n\n");
    const r = await parse(format, source);
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.content.content).toEqual(
      levels.map((level) => h(level, `Level ${level}`)),
    );
    expect(r.warnings.some((w) => w.code.endsWith("CHAPTER_AMBIGUOUS"))).toBe(
      true,
    );
  },
);

it("Markdown link syntax preserves safe data and cannot introduce executable schemes", async () => {
  const r = await parse(
    "markdown",
    "[Web](https://example.invalid/a) [Email](mailto:writer@example.invalid) [Fragment](#chapter) [Unsafe](javascript:alert%281%29) [Local](file:///secret)",
  );
  const content = r.chapters[0]!.content.content;
  const json = JSON.stringify(content);
  for (const href of [
    "https://example.invalid/a",
    "mailto:writer@example.invalid",
    "#chapter",
  ])
    expect(json).toContain(href);
  for (const href of ["javascript:", "file:"]) expect(json).not.toContain(href);
  expect(json).toContain("Unsafe");
  expect(json).toContain("Local");
  expect(r.warnings.filter((w) => w.code === "MARKDOWN_LINK")).toHaveLength(2);
});
it("tables, tasks and unknown HTML recover text with located warnings", async () => {
  const r = await parse(
    "markdown",
    "| A | B |\n| - | - |\n| C | D |\n\n- [x] Done\n\n<custom>Keep me</custom>",
  );
  const json = JSON.stringify(r.chapters);
  for (const text of ["A", "B", "C", "D", "[x] ", "Done", "Keep me"])
    expect(json).toContain(text);
  expect(r.warnings.some((w) => w.code === "MARKDOWN_STRUCTURE")).toBe(true);
  expect(r.warnings.every((w) => w.location.label.startsWith("MARKDOWN"))).toBe(
    true,
  );
});
it.each(["html", "markdown"] as const)(
  "%s active markup and resources cannot survive semantic sanitization",
  async (format) => {
    const r = await parse(
      format,
      `<p onclick="throw 1" style="background:url(https://example.invalid/a)">before <a href="javascript:alert(1)">bad</a> <a href="file:///secret">file</a> <a href="data:text/html,test">data</a></p>
<script>throw new Error('executed')</script><iframe src="https://example.invalid"></iframe><object data="secret"><p>fallback</p></object><embed src="a"><svg onload="throw 1"><script>throw 1</script></svg><link rel="stylesheet" href="https://example.invalid/a"><meta http-equiv="refresh" content="0;url=https://example.invalid"><img src="https://example.invalid/a.png" alt="Remote"><img src="../secret.png" alt="Traversal"><img src="C:/secret.png" alt="Absolute"><img src="/secret.png" alt="Absolute POSIX"><p>after</p>`,
    );
    const json = JSON.stringify(r.chapters);
    for (const forbidden of [
      "javascript:",
      "file:",
      "data:",
      "onclick",
      "onload",
      "<script",
      "throw",
      "src",
      "https://example.invalid",
    ])
      expect(json).not.toContain(forbidden);
    for (const kept of [
      "before ",
      "bad",
      "file",
      "data",
      "Remote",
      "Traversal",
      "Absolute",
      "after",
    ])
      expect(json).toContain(kept);
    expect(r.assets).toEqual([]);
    expect(r.warnings.some((w) => w.code.endsWith("ACTIVE_CONTENT"))).toBe(
      true,
    );
  },
);
it("actual bundled parser works with host/network APIs absent", async () => {
  const bundle = await readFile(
    new URL("../dist/text-parser.bundle.js", import.meta.url),
    "utf8",
  );
  const parser = new IsolatedManuscriptImporter(
    `(source) => { for (const name of ['fetch','XMLHttpRequest','WebSocket','require','process','document','Image']) if (typeof globalThis[name] !== 'undefined') throw new Error(); ${bundle}\n return TEXT.parse(source, 'html'); }`,
  );
  const data = JSON.parse(
    await parser.parse(
      Buffer.from('<p>offline</p><img src="https://example.invalid/a">'),
      signal(),
    ),
  );
  expect(
    validateImportedManuscript(JSON.stringify(data.manuscript)).chapters[0]!
      .content.content?.[0],
  ).toEqual(p("offline"));
});
it.each(["html", "markdown"] as const)(
  "%s only individually selected images become validated assets",
  async (format) => {
    const dir = await root();
    const path = join(dir, "chosen.png");
    const bytes = await syntheticImage("png");
    await writeFile(path, bytes);
    const select = vi.fn(async (ref: string) =>
      ref === "approved.png" ? path : null,
    );
    const source =
      format === "html"
        ? '<p>before<img src="approved.png" alt="海">after</p><img src="unapproved.png" alt="Missing"><img src="../secret.png"><img src="https://example.invalid/a">'
        : "before ![海](approved.png) after\n\n![Missing](unapproved.png) ![secret](../secret.png) ![remote](https://example.invalid/a)";
    const r = validateImportedManuscript(
      await new TextManuscriptImporter(format, select).parse(
        Buffer.from(source),
        signal(),
      ),
    );
    expect(select.mock.calls.map((c) => c[0])).toEqual([
      "approved.png",
      "unapproved.png",
    ]);
    expect(r.assets).toHaveLength(1);
    expect(Buffer.from(r.assets[0]!.base64, "base64")).toEqual(bytes);
    expect(JSON.stringify(r.chapters)).toContain('"assetId"');
    expect(JSON.stringify(r.chapters)).toContain("Missing");
    expect(await readFile(path)).toEqual(bytes);
    await writeFile(path, "not an image");
    await expect(
      new TextManuscriptImporter(format, select).parse(
        Buffer.from(source),
        signal(),
      ),
    ).rejects.toBeDefined();
  },
);
it("authorized paths still reject symlink/junction escape", async () => {
  const dir = await root();
  const actual = join(dir, "actual");
  const alias = join(dir, "alias");
  await mkdir(actual);
  await writeFile(join(actual, "image.png"), await syntheticImage("png"));
  await symlink(
    actual,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    new TextManuscriptImporter("html", async () =>
      join(alias, "image.png"),
    ).parse(Buffer.from('<img src="image.png">'), signal()),
  ).rejects.toBeDefined();
});
it("depth, source and warning limits reject oversized conversion", async () => {
  await expect(
    parse("html", "<div>".repeat(40) + "text" + "</div>".repeat(40)),
  ).rejects.toBeDefined();
  await expect(
    parse("markdown", "> ".repeat(40) + "text"),
  ).rejects.toBeDefined();
  await expect(
    parse("txt", new Uint8Array(8 * 1024 * 1024 + 1)),
  ).rejects.toBeDefined();
  await expect(
    parse("html", '<img src="https://example.invalid/a">'.repeat(1001)),
  ).rejects.toBeDefined();
});
it.each(["txt", "markdown", "html"] as const)(
  "%s shared staging success/failure/cancellation preserves source and active project",
  async (format) => {
    const dir = await root();
    const source = join(dir, "source");
    const destination = join(dir, "destination");
    const active = join(dir, "active");
    const bytes = await fixture(format === "markdown" ? "md" : format);
    await writeFile(source, bytes);
    await mkdir(destination);
    await createProject({
      projectPath: active,
      title: "Active",
      author: "Author",
      language: "en",
    });
    const original = await readFile(join(active, "project.json"));
    const importer = new TextManuscriptImporter(format);
    for (const phase of [
      "parsed",
      "staging",
      "staged",
      "writing",
      "before-commit",
    ] as const) {
      const abort = new AbortController();
      const options = {
        signal: abort.signal,
        checkpoint: async (at: string) => {
          if (at === phase) abort.abort();
        },
      };
      if (phase === "writing" || phase === "before-commit") {
        const stage = await StagedManuscriptImport.inspect(
          source,
          importer,
          options,
        );
        await expect(stage.commit(destination, options)).rejects.toMatchObject({
          code: "IMPORT_CANCELLED",
        });
      } else
        await expect(
          StagedManuscriptImport.inspect(source, importer, options),
        ).rejects.toMatchObject({ code: "IMPORT_CANCELLED" });
      expect(await readFile(source)).toEqual(bytes);
      expect(await readdir(destination)).toEqual([]);
    }
    await expect(
      StagedManuscriptImport.inspect(source, importer, {
        signal: signal(),
        writeBytes: async () => {
          throw new Error("disk");
        },
      }),
    ).rejects.toBeDefined();
    const failed = await StagedManuscriptImport.inspect(source, importer, {
      signal: signal(),
    });
    await expect(
      failed.commit(destination, {
        signal: signal(),
        writeJson: async () => {
          throw new Error("disk");
        },
      }),
    ).rejects.toBeDefined();
    expect(await readdir(destination)).toEqual([]);
    expect(await readFile(source)).toEqual(bytes);
    const stage = await StagedManuscriptImport.inspect(source, importer, {
      signal: signal(),
    });
    const expected = stage.preview.chapters;
    await stage.commit(destination, { signal: signal() });
    const project = await validateProjectFiles(destination);
    const chapters = await Promise.all(
      project.project.manuscript.order.map((chapterId) =>
        loadChapter({ projectPath: destination, chapterId }),
      ),
    );
    expect(chapters.map((c) => c.content)).toEqual(
      expected.map((c) => c.content),
    );
    expect(await readFile(source)).toEqual(bytes);
    expect(await readFile(join(active, "project.json"))).toEqual(original);
  },
);
