import { useRef, useState, type ReactNode } from "react";
import { WorkspaceIcon as Icon } from "./WorkspaceIcon.js";
import { sampleParagraphs } from "./workspace-sample.js";

type Panel =
  | "preview"
  | "format"
  | "details"
  | "search"
  | "history"
  | "export"
  | "canon-research"
  | "timeline"
  | "locations"
  | "story-bible";
const panelNames: Record<Panel, string> = {
  preview: "Book preview",
  format: "Book design",
  details: "Book details",
  search: "Find in manuscript",
  history: "Version history",
  export: "Export your book",
  "canon-research": "Canon and research",
  timeline: "Timeline",
  locations: "Story bible locations",
  "story-bible": "Story bible",
};

export interface WorkspaceLayoutProps {
  title: string;
  author: string;
  navigator: ReactNode;
  editor: ReactNode;
  status: ReactNode;
  library: ReactNode;
  notice?: ReactNode;
  bookPreviewAction?: ReactNode;
  bookDesign?: ReactNode;
  publicationAction?: ReactNode;
  exportAction?: ReactNode;
  canonResearch?: ReactNode;
  timeline?: ReactNode;
  locations?: ReactNode;
  storyBible?: ReactNode;
}

/** Presentation shell only: mock controls never call persistence or export APIs. */
export function WorkspaceLayout({
  title,
  author,
  navigator,
  editor,
  status,
  library,
  notice,
  bookPreviewAction,
  bookDesign,
  publicationAction,
  exportAction,
  canonResearch,
  timeline,
  locations,
  storyBible,
}: WorkspaceLayoutProps) {
  const [panel, setPanel] = useState<Panel | null>("preview");
  const [canonResearchVisited, setCanonResearchVisited] = useState(false);
  const [timelineVisited, setTimelineVisited] = useState(false);
  const [locationsVisited, setLocationsVisited] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(
    () => window.innerWidth > 850,
  );
  const [device, setDevice] = useState("E-reader");
  const [theme, setTheme] = useState("Literary");
  const [size, setSize] = useState(16);
  const [samplePage, setSamplePage] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  const selectPanel = (next: Panel) => {
    if (next === "canon-research") setCanonResearchVisited(true);
    if (next === "timeline") setTimelineVisited(true);
    if (next === "locations") setLocationsVisited(true);
    setPanel(next);
  };
  const samplePreview = (
    <>
      <div className="preview-options">
        <label>
          View
          <select
            value={device}
            onChange={(event) => setDevice(event.target.value)}
          >
            <option>E-reader</option>
            <option>Tablet</option>
            <option>Print page</option>
          </select>
        </label>
        <label>
          Typeface
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
          >
            <option>Literary</option>
            <option>Classic</option>
            <option>Modern</option>
          </select>
        </label>
      </div>
      <div
        className={`preview-stage ${device === "Print page" ? "print-stage" : ""}`}
      >
        <div
          className={`device-frame ${device === "Tablet" ? "tablet-frame" : ""}`}
        >
          <div
            className={`sample-page theme-${theme.toLowerCase()}`}
            style={{ fontSize: size }}
          >
            <span className="running-title">THE LIGHT BETWEEN TIDES</span>
            <div className="chapter-ornament" aria-hidden="true">
              ✧
            </div>
            <span className="sample-chapter-number">CHAPTER ONE</span>
            <h3>The returning light</h3>
            {sampleParagraphs
              .slice(samplePage, samplePage + 3)
              .map((paragraph, index) => (
                <p
                  key={paragraph}
                  className={
                    index === 0 && samplePage === 0 ? "drop-cap" : undefined
                  }
                >
                  {paragraph}
                </p>
              ))}
            <span className="sample-page-number">{samplePage + 1}</span>
          </div>
        </div>
      </div>
      <div className="preview-pagination">
        <button
          disabled={samplePage === 0}
          onClick={() => setSamplePage(0)}
          aria-label="Previous sample page"
        >
          ←
        </button>
        <span>Sample page {samplePage + 1} of 2</span>
        <button
          disabled={samplePage === 1}
          onClick={() => setSamplePage(1)}
          aria-label="Next sample page"
        >
          →
        </button>
      </div>
      <p className="preview-disclaimer">
        Illustrative sample text. Not a rendering of your manuscript or a final
        EPUB/PDF.
      </p>
    </>
  );

  return (
    <main
      className={`workspace-shell ${navigationOpen ? "" : "navigation-closed"} ${panel ? "" : "inspector-closed"}`}
    >
      <header className="workspace-topbar">
        <div className="workspace-identity">
          <span className="brand-mark">
            <Icon name="book" />
          </span>
          <div>
            <h1 title={title}>{title}</h1>
            <span>LOCAL PROJECT</span>
          </div>
        </div>
        <nav className="workspace-modes" aria-label="Workspace mode">
          <button
            className={panel !== "format" ? "selected" : ""}
            aria-pressed={panel !== "format"}
            onClick={() => setPanel("preview")}
          >
            Writing
          </button>
          <button
            className={panel === "format" ? "selected" : ""}
            aria-pressed={panel === "format"}
            onClick={() => setPanel("format")}
          >
            Formatting <span className="mode-mock">Mock</span>
          </button>
        </nav>
        <div className="workspace-top-actions">
          <details className="project-library">
            <summary>
              Projects <span aria-hidden="true">⌄</span>
            </summary>
            <div className="library-popover">{library}</div>
          </details>
          <button
            className="export-button"
            onClick={() => selectPanel("export")}
          >
            <Icon name="export" />
            <span>Export</span>
            {!exportAction && <span className="mode-mock">Mock</span>}
          </button>
          {canonResearch && (
            <button
              className="text-button"
              type="button"
              aria-pressed={panel === "canon-research"}
              onClick={() => selectPanel("canon-research")}
            >
              Canon &amp; research
            </button>
          )}
          {timeline && (
            <button
              className="text-button"
              type="button"
              aria-pressed={panel === "timeline"}
              onClick={() => selectPanel("timeline")}
            >
              Timeline
            </button>
          )}
          {locations && (
            <button
              className="text-button"
              aria-pressed={panel === "locations"}
              onClick={() => selectPanel("locations")}
            >
              Locations
            </button>
          )}
          {storyBible && (
            <button
              className="text-button"
              aria-pressed={panel === "story-bible"}
              onClick={() => selectPanel("story-bible")}
            >
              Story bible
            </button>
          )}
        </div>
      </header>
      <div className="workspace-context">
        <button
          className="text-button"
          onClick={() => setNavigationOpen(!navigationOpen)}
          aria-expanded={navigationOpen}
          aria-controls="book-navigation"
        >
          <Icon name="panel" />
          {navigationOpen ? "Hide" : "Show"} outline
        </button>
        <span>Your manuscript stays on this device</span>
        <span className="local-indicator">
          <span />
          Local workspace
        </span>
      </div>
      <aside
        id="book-navigation"
        className="workspace-navigator"
        hidden={!navigationOpen}
      >
        <div className="outline-heading">
          <span>MANUSCRIPT</span>
          <Icon name="book" />
        </div>
        {publicationAction ?? (
          <div className="matter-group">
            <span className="section-label">
              FRONT MATTER <span className="mock-tag">Planned</span>
            </span>
            {["Title page", "Copyright", "Contents"].map((name) => (
              <button
                key={name}
                className="matter-item"
                onClick={() => selectPanel("details")}
              >
                <Icon name="page" />
                {name}
                <span className="matter-dot" />
              </button>
            ))}
          </div>
        )}
        {navigator}
        {!publicationAction && (
          <div className="matter-group back-matter">
            <span className="section-label">
              BACK MATTER <span className="mock-tag">Planned</span>
            </span>
            <button
              className="matter-item"
              onClick={() => selectPanel("details")}
            >
              <Icon name="page" />
              About the author
              <span className="matter-dot" />
            </button>
          </div>
        )}
        <div className="outline-bottom">
          <Icon name="book" />
          <span>
            {author || "Your book"}
            <small>A little progress, every day.</small>
          </span>
        </div>
      </aside>
      <section className="workspace-writing" aria-label="Manuscript workspace">
        {notice && <div className="workspace-notice">{notice}</div>}
        <div className="manuscript-surface">{editor}</div>
        <footer className="workspace-status">{status}</footer>
      </section>
      <aside
        className="workspace-inspector"
        hidden={!panel}
        aria-label={panelNames[panel ?? "preview"]}
      >
        <header className="inspector-heading">
          <div>
            <h2>{panelNames[panel ?? "preview"]}</h2>
            <span className="mock-tag">
              {panel === "preview"
                ? bookPreviewAction
                  ? "Manuscript"
                  : "Layout mock"
                : panel === "format" && bookDesign
                  ? "Presentation"
                  : panel === "details" && publicationAction
                    ? "Publication"
                    : panel === "export" && exportAction
                      ? "Local DOCX"
                      : panel === "canon-research" && canonResearch
                        ? "Private · local"
                        : panel === "timeline" && timeline
                          ? "Private · local"
                          : panel === "locations" && locations
                            ? "Private · local"
                            : "Feature mock"}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="Close tool panel"
            onClick={() => {
              setPanel(null);
              rail.current
                ?.querySelector<HTMLButtonElement>(`[data-panel="${panel}"]`)
                ?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="inspector-scroll">
          {panel === "preview" && (bookPreviewAction ?? samplePreview)}
          {panel === "format" &&
            (bookDesign ?? (
              <>
                <div className="tool-intro">
                  <span className="section-label">MAKE IT YOURS</span>
                  <h3>A style for your story.</h3>
                  <p>
                    Try a direction for the sample page. These settings are
                    temporary and do not change your book.
                  </p>
                </div>
                <div className="theme-choices">
                  {["Literary", "Classic", "Modern"].map((name) => (
                    <button
                      key={name}
                      className={`theme-choice theme-${name.toLowerCase()}`}
                      aria-pressed={theme === name}
                      onClick={() => setTheme(name)}
                    >
                      <span>Aa</span>
                      <strong>{name}</strong>
                      <small>
                        {name === "Literary"
                          ? "Quiet & considered"
                          : name === "Classic"
                            ? "Timeless & familiar"
                            : "Clean & contemporary"}
                      </small>
                    </button>
                  ))}
                </div>
                <label className="sample-size">
                  Sample type size <span>{size}px</span>
                  <input
                    type="range"
                    min="13"
                    max="20"
                    value={size}
                    onChange={(event) => setSize(Number(event.target.value))}
                  />
                </label>
                {samplePreview}
              </>
            ))}
          {panel === "story-bible" && storyBible}
          {panel === "details" &&
            (publicationAction ?? (
              <div className="tool-intro">
                <span className="section-label">YOUR BOOK</span>
                <h3>{title}</h3>
                <p>{author}</p>
                <div className="planned-card">
                  <Icon name="page" />
                  <h3>A place for every page.</h3>
                  <p>
                    Publication details, your cover, and front and back matter
                    will live here.
                  </p>
                  <p className="mock-explanation">
                    Not available yet. The outline entries show the planned
                    structure, not saved pages.
                  </p>
                </div>
              </div>
            ))}
          {panel === "export" &&
            (exportAction ? (
              <div className="tool-intro">
                <h3>Local publishing exports</h3>
                <p>
                  Export from one saved manuscript revision. Pending edits are
                  saved first and the project remains authoritative.
                </p>
                {exportAction}
                <p>
                  EPUB is reflowable and DOCX preserves manuscript content, not
                  exact page layout.
                </p>
              </div>
            ) : (
              <div className="tool-intro">
                <h3>From manuscript to book.</h3>
                <p>
                  Planned local exports. Your manuscript will remain your
                  original.
                </p>
                {[
                  ["EPUB", "A reflowable ebook for digital readers"],
                  ["Print PDF", "A carefully typeset print interior"],
                  ["DOCX", "An editable copy of your manuscript"],
                ].map(([name, description]) => (
                  <div className="export-option" key={name}>
                    <Icon name="page" />
                    <div>
                      <strong>{name}</strong>
                      <p>{description}</p>
                    </div>
                    <span className="mock-tag">Planned</span>
                  </div>
                ))}
                <button disabled className="primary-button planned-export">
                  Export unavailable
                </button>
                <p className="mock-explanation">
                  This is a layout mock. No file will be created.
                </p>
              </div>
            ))}
          <div hidden={panel !== "canon-research"}>
            {canonResearchVisited && canonResearch}
          </div>
          <div hidden={panel !== "timeline"}>{timelineVisited && timeline}</div>
          <div hidden={panel !== "locations"}>
            {locationsVisited &&
              (locations ?? (
                <div className="tool-intro">
                  <h3>Story bible locations</h3>
                  <p>Location records are not available for this project.</p>
                </div>
              ))}
          </div>
          {panel === "search" && (
            <div className="tool-intro">
              <h3>Find the right words.</h3>
              <label className="planned-field">
                Search manuscript
                <input disabled placeholder="A word, a place, a character…" />
              </label>
              <p className="mock-explanation">
                Manuscript search and replace are planned. This field is not
                active yet.
              </p>
            </div>
          )}
          {panel === "history" && (
            <div className="tool-intro">
              <h3>Room to try another draft.</h3>
              <p>
                Chapter history browsing and explicit restore will live here.
              </p>
              <p className="mock-explanation">
                This panel is a mock. Local snapshots and startup crash recovery
                already work; this history browser is not available yet.
              </p>
            </div>
          )}
        </div>
      </aside>
      <div
        className="workspace-toolrail"
        role="toolbar"
        aria-label="Workspace tools"
        aria-orientation="vertical"
        ref={rail}
      >
        {(
          [
            ["preview", "preview"],
            ["format", "settings"],
            ["details", "book"],
            ["search", "search"],
            ["history", "history"],
            ["export", "export"],
            ["locations", "book"],
            ["timeline", "book"],
            ["canon-research", "book"],
          ] as const
        ).map(([name, icon]) => (
          <button
            key={name}
            data-panel={name}
            className="rail-button"
            aria-label={
              name === "details" && publicationAction
                ? "Book details"
                : name === "format" && bookDesign
                  ? "Book design"
                  : name === "preview" && bookPreviewAction
                    ? "Open book preview panel"
                    : name === "export" && exportAction
                      ? "Export your book"
                      : name === "canon-research" && canonResearch
                        ? "Canon and research"
                        : name === "timeline" && timeline
                          ? "Story bible timeline"
                          : name === "locations" && locations
                            ? "Story bible locations"
                            : `${panelNames[name]} (mock)`
            }
            title={
              name === "details" && publicationAction
                ? "Book details"
                : name === "format" && bookDesign
                  ? "Book design"
                  : name === "preview" && bookPreviewAction
                    ? "Book preview"
                    : name === "export" && exportAction
                      ? "Export your book"
                      : name === "canon-research" && canonResearch
                        ? "Canon and research"
                        : name === "timeline" && timeline
                          ? "Story bible timeline"
                          : name === "locations" && locations
                            ? "Story bible locations"
                            : `${panelNames[name]} · mock`
            }
            aria-pressed={panel === name}
            onClick={() =>
              panel === name ? setPanel(null) : selectPanel(name)
            }
          >
            <Icon name={icon} />
          </button>
        ))}
        <span className="rail-local" title="Local-first workspace">
          <Icon name="check" />
        </span>
      </div>
    </main>
  );
}
