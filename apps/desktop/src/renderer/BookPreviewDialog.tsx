import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BookPreview } from "@drelwick/shared";

const diagnosticMessages: Record<string, string> = {
  "unsupported-node": "This content type is not supported.",
  "unsupported-mark": "This text formatting is not supported.",
  "invalid-structure": "This chapter has an invalid document structure.",
  "invalid-xml-text":
    "This chapter contains a character that cannot be published as XHTML.",
  "unsafe-url": "A link destination is unsafe and was omitted.",
  "unresolved-internal-link":
    "A link has no matching destination in this book; its label is shown as text.",
  "missing-asset": "A local image is missing. Restore or replace the image.",
  "invalid-asset":
    "A local image is damaged or unsupported. Restore or replace the image.",
  "unsafe-asset-reference": "A local image could not be displayed safely.",
};

export function BookPreviewDialog({
  preview,
  onClose,
  themeSelector,
  projectId,
  onRefresh,
  refreshing,
  error,
  dirty,
}: {
  preview: BookPreview;
  onClose(): void;
  themeSelector?: ReactNode;
  projectId: string;
  onRefresh(): void;
  refreshing: boolean;
  error: string;
  dirty: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [viewport, setViewport] = useState("reader");
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(800);
  const [landscape, setLandscape] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  const [presentation, setPresentation] = useState<{
    source: BookPreview;
    document: string;
  } | null>(null);
  const [simulationError, setSimulationError] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simulationRequest, setSimulationRequest] = useState({
    preview,
    fontSize,
    appearance,
  });
  if (
    simulationRequest.preview !== preview ||
    simulationRequest.fontSize !== fontSize ||
    simulationRequest.appearance !== appearance
  ) {
    setSimulationRequest({ preview, fontSize, appearance });
    setSimulationError("");
    setSimulating(fontSize !== 16 || appearance !== "light");
    if (fontSize === 16 && appearance === "light") setPresentation(null);
  }
  const [status, setStatus] = useState<{
    source: BookPreview;
    message: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (fontSize === 16 && appearance === "light") {
      return;
    }
    void window.drelwick.project
      .simulateBookPreview({
        projectId,
        revision: preview.revision,
        simulation: { fontSize, appearance },
      })
      .then((result) => {
        if (!active) return;
        if (result.ok)
          setPresentation({ source: preview, document: result.value.document });
        else setSimulationError(result.error.message);
      })
      .catch(() => {
        if (active)
          setSimulationError(
            "Unable to apply reader settings. The previous preview and your manuscript are preserved.",
          );
      })
      .finally(() => {
        if (active) setSimulating(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, preview, fontSize, appearance]);
  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || refreshing) return;
      checking = true;
      try {
        const result = await window.drelwick.project.bookPreviewStatus({
          projectId,
          revision: preview.revision,
        });
        if (active)
          setStatus({
            source: preview,
            message: result.ok
              ? result.value.stale
                ? "Stale preview — the project has changed. Refresh to include those changes."
                : "Saved revision checked. Later changes require Refresh."
              : "Preview currency could not be verified. Refresh after resolving project access or recovery problems.",
          });
      } catch {
        if (active)
          setStatus({
            source: preview,
            message:
              "Preview currency could not be verified. Refresh to retry.",
          });
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => void check(), 5000);
    window.addEventListener("focus", check);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [projectId, preview, refreshing]);
  const dimensions =
    viewport === "phone"
      ? [390, 844]
      : viewport === "tablet"
        ? [768, 1024]
        : viewport === "custom"
          ? [width, height]
          : [600, 800];
  const frameWidth = dimensions[landscape ? 1 : 0];
  const frameHeight = dimensions[landscape ? 0 : 1];
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="project-dialog book-preview"
      aria-labelledby="book-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!refreshing) onClose();
      }}
    >
      <h2 id="book-preview-title">Book preview</h2>
      <p>
        Reflowable ebook simulation. This is not a guarantee of rendering in
        Kindle, Kobo, Apple Books or another reader engine.
      </p>
      {themeSelector}
      <p role="status">
        {dirty
          ? "Stale preview — unsaved editor changes. Refresh saves pending edits first."
          : status?.source === preview
            ? status.message
            : "Captured saved revision. Refresh explicitly to include later changes."}
      </p>
      <p className="preview-revision">
        Revision {preview.revision.slice(0, 12)}
      </p>
      <button disabled={refreshing || simulating} onClick={onRefresh}>
        {refreshing ? "Refreshing preview…" : "Refresh preview"}
      </button>
      {(error || simulationError) && (
        <p role="alert">{error || simulationError}</p>
      )}
      <fieldset className="ebook-controls" disabled={refreshing || simulating}>
        <legend>Reader simulation only — does not change book settings</legend>
        <label>
          Viewport
          <select
            aria-label="Viewport"
            value={viewport}
            onChange={(event) => setViewport(event.target.value)}
          >
            <option value="phone">Phone (390 × 844)</option>
            <option value="reader">Reader (600 × 800)</option>
            <option value="tablet">Tablet (768 × 1024)</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {viewport === "custom" && (
          <>
            <label>
              Portrait width
              <input
                type="number"
                min="240"
                max="1600"
                value={width}
                onChange={(event) =>
                  setWidth(
                    Math.max(
                      240,
                      Math.min(1600, Number(event.target.value) || 240),
                    ),
                  )
                }
              />
            </label>
            <label>
              Portrait height
              <input
                type="number"
                min="240"
                max="1600"
                value={height}
                onChange={(event) =>
                  setHeight(
                    Math.max(
                      240,
                      Math.min(1600, Number(event.target.value) || 240),
                    ),
                  )
                }
              />
            </label>
          </>
        )}
        <label>
          Orientation
          <select
            aria-label="Orientation"
            value={landscape ? "landscape" : "portrait"}
            onChange={(event) =>
              setLandscape(event.target.value === "landscape")
            }
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label>
          Font size
          <select
            aria-label="Font size"
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
          >
            {[12, 16, 20, 24, 32].map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
        <label>
          Presentation
          <select
            aria-label="Presentation"
            value={appearance}
            onChange={(event) =>
              setAppearance(event.target.value as "light" | "dark")
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </fieldset>
      <p>
        Simulated viewport: {frameWidth} × {frameHeight} CSS pixels. Scroll
        within the book; Contents links navigate chapters and matter. Reader
        colour preferences may override exported styling.
      </p>
      {!preview.complete && (
        <p role="alert">
          This preview is incomplete. Resolve the reported content or asset
          problems before publishing.
        </p>
      )}
      {preview.diagnostics.length > 0 && (
        <ul aria-label="Rendering diagnostics">
          {preview.diagnostics.map((entry, index) => (
            <li key={index}>
              {diagnosticMessages[entry.code] ??
                "This content could not be rendered."}{" "}
              — chapter {entry.chapterId}, position{" "}
              {entry.path.join(".") || "root"}
            </li>
          ))}
        </ul>
      )}
      <div className="ebook-viewport" aria-busy={simulating}>
        <iframe
          title="Book manuscript"
          sandbox=""
          referrerPolicy="no-referrer"
          style={{ width: frameWidth, height: frameHeight }}
          srcDoc={
            presentation?.source === preview
              ? presentation.document
              : preview.document
          }
        />
      </div>
      <button disabled={refreshing} onClick={onClose}>
        Close preview
      </button>
    </dialog>
  );
}
