// A named package import exercises both declaration and runtime resolution.
// Keep the import in emitted JavaScript so Node also verifies the workspace link.
import * as shared from "@drelwick/shared";
import {
  renderBook,
  getBookTheme,
  generateThemeStyles,
} from "@drelwick/renderer";

// Execute the publishing entry under plain Node: no Electron or DOM globals.
export const rendered = renderBook(
  {
    projectId: "00000000-0000-4000-8000-000000000001",
    revision: "smoke",
    title: "Smoke",
    language: "en",
    assets: [],
    chapters: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        type: "chapter",
        title: "Chapter",
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Safe <text>" }],
            },
          ],
        },
      },
    ],
  },
  { resolveAsset: () => undefined },
);
if (!rendered.ok || !rendered.chapters[0]?.xhtml.includes("Safe &lt;text&gt;"))
  throw new Error("Semantic renderer workspace smoke failed");

export { shared };

export const theme = generateThemeStyles(getBookTheme("classic"), "ebook");
if (!theme.css.includes(".chapter-title") || theme.requiredAssets.length !== 0)
  throw new Error("Community theme workspace smoke failed");
