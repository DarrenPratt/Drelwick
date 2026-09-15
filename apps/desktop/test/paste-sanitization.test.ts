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
      '<span data-id="1">Before</span><script>alert("x")</script><a href="https://evil.test">After</a>',
    );

    expect(sanitized).toBe("BeforeAfter");
    expect(sanitized).not.toContain("alert");
    expect(sanitized).not.toContain("https://");
  });
});
