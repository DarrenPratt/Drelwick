import { useState } from "react";
import { countDocumentWords } from "@bookeditor/shared";
import { Editor } from "./Editor.js";
import { WorkspaceLayout } from "./WorkspaceLayout.js";
import { sampleChapters, sampleDocument } from "./workspace-sample.js";

/** Isolated, in-memory demo; no preload API or real project state is used. */
export function WorkspaceDemo({ onExit }: { onExit(): void }) {
  const [chapter, setChapter] = useState(0);
  const [documents, setDocuments] = useState(() =>
    sampleChapters.map((_, index) => sampleDocument(index)),
  );
  const content = documents[chapter]!;
  return (
    <WorkspaceLayout
      demo
      title="The Light Between Tides"
      author="Alex Morgan"
      library={
        <>
          <h2>Sample workspace</h2>
          <p>
            Explore freely. Sample edits last only until you leave this demo.
          </p>
          <button onClick={onExit}>Exit demo</button>
        </>
      }
      navigator={
        <nav aria-label="Chapter navigator">
          <div className="navigator-heading">
            <h3>BODY</h3>
            <span>{sampleChapters.length} chapters</span>
          </div>
          <ol className="chapter-navigator">
            {sampleChapters.map((title, index) => (
              <li
                key={title}
                className={chapter === index ? "active-chapter" : ""}
              >
                <button
                  className="chapter-select"
                  aria-current={chapter === index ? "page" : undefined}
                  onClick={() => setChapter(index)}
                >
                  <span>
                    <span className="chapter-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {title}
                  </span>
                  <small>Sample chapter</small>
                </button>
              </li>
            ))}
          </ol>
          <p className="demo-outline-note">Sample outline · not saved</p>
        </nav>
      }
      editor={
        <Editor
          title={sampleChapters[chapter] ?? "Sample"}
          chapterLabel={`CHAPTER ${String(chapter + 1).padStart(2, "0")} · SAMPLE`}
          key={chapter}
          content={content}
          onChange={(value) =>
            setDocuments((current) =>
              current.map((document, index) =>
                index === chapter ? value : document,
              ),
            )
          }
        />
      }
      status={
        <>
          <span className="demo-status">Sample session · not saved</span>
          <span>{countDocumentWords(content)} words</span>
          <button onClick={onExit}>Exit demo</button>
        </>
      }
    />
  );
}
