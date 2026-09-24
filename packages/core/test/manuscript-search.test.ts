import { describe, expect, it } from "vitest";
import {
  replaceMatches,
  searchChapter,
  searchManuscript,
} from "../src/manuscript-search.js";

const text = (value: string, mark?: string) => ({
  type: "text",
  text: value,
  ...(mark ? { marks: [{ type: mark }] } : {}),
});
const paragraph = (...content: Record<string, unknown>[]) => ({
  type: "paragraph",
  content,
});
const doc = (...content: Record<string, unknown>[]) => ({
  type: "doc",
  content,
});
const options = (query: string, matchCase = false, wholeWord = false) => ({
  query,
  matchCase,
  wholeWord,
});

describe("semantic manuscript search", () => {
  it("counts empty text blocks using editor node sizes", () => {
    expect(
      searchChapter(
        "a",
        doc({ type: "paragraph" }, paragraph(text("moon"))),
        options("moon"),
      )[0]?.from,
    ).toBe(3);
  });
  it("returns canonical chapter order and selectable document positions/counts", () => {
    const matches = searchManuscript(
      [
        { id: "b", content: doc(paragraph(text("moon moon"))) },
        { id: "a", content: doc(paragraph(text("moon"))) },
      ],
      options("moon"),
    );
    expect(
      matches.map(({ chapterId, from, to }) => [chapterId, from, to]),
    ).toEqual([
      ["b", 1, 5],
      ["b", 6, 10],
      ["a", 1, 5],
    ]);
  });
  it("crosses plain/bold/italic and adjacent text nodes but preserves all structure", () => {
    const original = doc(
      paragraph(
        text("The quick "),
        text("brown", "bold"),
        text(" fox", "italic"),
      ),
      { type: "sceneBreak" },
      paragraph(text("tail", "italic")),
    );
    const found = searchChapter("a", original, options("quick brown fox"));
    expect(found).toHaveLength(1);
    expect(
      replaceMatches(
        "a",
        original,
        options("quick brown fox"),
        found,
        "銀色 🌙",
      ),
    ).toEqual(
      doc(
        paragraph(text("The "), text("銀色 🌙")),
        { type: "sceneBreak" },
        paragraph(text("tail", "italic")),
      ),
    );
    expect(original.content[0]).toEqual(
      paragraph(
        text("The quick "),
        text("brown", "bold"),
        text(" fox", "italic"),
      ),
    );
    expect(
      searchChapter(
        "a",
        doc(paragraph(text("si"), text("lver"))),
        options("silver"),
      ),
    ).toHaveLength(1);
  });
  it.each(["bold", "italic"])(
    "inherits first character's %s mark and keeps unrelated marks",
    (mark) => {
      const original = doc(
        paragraph(
          text("quick", mark),
          text(" brown", "italic"),
          text(" tail", "bold"),
        ),
      );
      const found = searchChapter("a", original, options("quick brown"));
      expect(
        replaceMatches("a", original, options("quick brown"), found, "new"),
      ).toEqual(doc(paragraph(text("new", mark), text(" tail", "bold"))));
    },
  );
  it("preserves links without searching URLs or other attributes", () => {
    const link = {
      type: "text",
      text: "link",
      marks: [{ type: "link", attrs: { href: "https://example.test/hidden" } }],
    };
    const original = doc(paragraph(link), {
      type: "epigraph",
      attrs: { attribution: "hidden" },
      content: [paragraph(text("visible"))],
    });
    expect(searchChapter("a", original, options("hidden"))).toHaveLength(0);
    expect(
      replaceMatches(
        "a",
        original,
        options("link"),
        searchChapter("a", original, options("link")),
        "new",
      ).content,
    ).toEqual([paragraph({ ...link, text: "new" }), original.content[1]]);
  });
  it.each([
    [paragraph(text("the")), paragraph(text(" beginning"))],
    [
      { type: "heading", attrs: { level: 1 }, content: [text("the")] },
      paragraph(text(" beginning")),
    ],
    [
      paragraph(text("the")),
      { type: "sceneBreak" },
      paragraph(text(" beginning")),
    ],
    [
      { type: "blockquote", content: [paragraph(text("the"))] },
      paragraph(text(" beginning")),
    ],
    [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph(text("the"))] },
          { type: "listItem", content: [paragraph(text(" beginning"))] },
        ],
      },
    ],
    [paragraph(text("the"), { type: "hardBreak" }, text(" beginning"))],
  ])("does not cross structural boundaries (%j)", (...blocks) => {
    expect(
      searchChapter("a", doc(...blocks), options("the beginning")),
    ).toEqual([]);
  });
  it("never crosses chapters", () => {
    expect(
      searchManuscript(
        [
          { id: "a", content: doc(paragraph(text("the "))) },
          { id: "b", content: doc(paragraph(text("beginning"))) },
        ],
        options("the beginning"),
      ),
    ).toEqual([]);
  });
  it("uses deterministic Unicode case and word boundaries", () => {
    const original = doc(
      paragraph(text("Café café cafés naïve “café”—café 東京 東京都 foo_bar")),
    );
    expect(searchChapter("a", original, options("café"))).toHaveLength(5);
    expect(searchChapter("a", original, options("café", true))).toHaveLength(4);
    expect(
      searchChapter("a", original, options("café", false, true)),
    ).toHaveLength(4);
    expect(
      searchChapter("a", original, options("東京", false, true)),
    ).toHaveLength(1);
    expect(
      searchChapter("a", original, options("foo", false, true)),
    ).toHaveLength(0);
  });
  it.each([
    "café",
    "naïve",
    "“quotes”",
    "em—dash",
    "en–dash",
    "日本語",
    "العربية",
    "🌙",
    "e\u0301",
  ])("finds/replaces Unicode %s without normalization", (value) => {
    const original = doc(paragraph(text(value)));
    const found = searchChapter("a", original, options(value));
    expect(found).toHaveLength(1);
    expect(
      replaceMatches("a", original, options(value), found, "銀🌙e\u0301"),
    ).toEqual(doc(paragraph(text("銀🌙e\u0301"))));
  });
  it("rejects partial graphemes/surrogates and does not normalize", () => {
    const original = doc(paragraph(text("e\u0301 👩‍💻 🌙")));
    for (const query of ["e", "é", "👩", "\ud83c"])
      expect(searchChapter("a", original, options(query))).toEqual([]);
  });
  it("supports deletion, identical replacement, no matches and rejects stale/duplicate offsets", () => {
    const original = doc(paragraph(text("moon moon")));
    const found = searchChapter("a", original, options("moon"));
    expect(
      replaceMatches("a", original, options("moon"), found, "moon"),
    ).toEqual(original);
    expect(replaceMatches("a", original, options("moon"), found, "")).toEqual(
      doc(paragraph(text(" "))),
    );
    expect(replaceMatches("a", original, options("none"), [], "x")).toEqual(
      original,
    );
    expect(() =>
      replaceMatches(
        "a",
        doc(paragraph(text("sun"))),
        options("moon"),
        found,
        "x",
      ),
    ).toThrow("Search results changed");
    expect(() =>
      replaceMatches("a", original, options("moon"), [...found, ...found], "x"),
    ).toThrow();
  });
});
