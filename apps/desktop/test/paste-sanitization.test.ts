// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizePastedHtml } from "../src/renderer/components/Editor.js";

describe("rich text paste sanitization", () => {
  it("retains supported structure and marks while removing styles and attributes", () => {
    const sanitized = sanitizePastedHtml(`
      <div style="margin: 20px" onclick="alert('x')">
        Clean <b style="color: red">bold</b> and
        <i class="external">italic</i>
        <blockquote cite="https://example.test">quoted</blockquote>
      </div>
    `);

    expect(sanitized).toContain("<p>");
    expect(sanitized).toContain("<strong>bold</strong>");
    expect(sanitized).toContain("<em>italic</em>");
    expect(sanitized).toContain("<blockquote>quoted</blockquote>");
    expect(sanitized).not.toContain("style");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("cite");
  });

  it("drops executable elements and preserves plain prose from unsupported wrappers", () => {
    const sanitized = sanitizePastedHtml(
      '<span data-id="1">Before</span><script>alert("x")</script><a href="javascript:alert(1)">After</a>',
    );

    expect(sanitized).toBe("BeforeAfter");
    expect(sanitized).not.toContain("alert");
    expect(sanitized).not.toContain("javascript:");
  });

  it("retains supported semantic publishing elements and safe link attributes", () => {
    const sanitized = sanitizePastedHtml(`
      <h2 style="font-family: fantasy">A heading</h2>
      <ul><li>Parent<ol start="4"><li>Nested</li></ol></li></ul>
      <p><a href="https://example.invalid/r%C3%A9f" title="Reference" target="_blank">Linked prose</a></p>
      <aside data-epigraph data-attribution="&#931;&#945;&#960;&#966;&#974;"><p>Unicode &#8212; &#26143;</p></aside>
    `);

    expect(sanitized).toContain("<h2>A heading</h2>");
    expect(sanitized).toContain('<ol start="4"><li>Nested</li></ol>');
    expect(sanitized).toContain(
      '<a href="https://example.invalid/r%C3%A9f" title="Reference">Linked prose</a>',
    );
    expect(sanitized).toContain(
      '<aside data-epigraph="true" data-attribution="\u03a3\u03b1\u03c0\u03c6\u03ce">',
    );
    expect(sanitized).not.toContain("font-family");
    expect(sanitized).not.toContain("target");
  });
});
