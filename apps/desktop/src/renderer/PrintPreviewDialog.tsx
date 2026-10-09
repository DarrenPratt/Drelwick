import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PrintPreview } from "@drelwick/shared";

GlobalWorkerOptions.workerSrc = workerUrl;
function PdfPage({ pdf, number }: { pdf: PDFDocumentProxy; number: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let rendering:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    void pdf
      .getPage(number)
      .then(async (page) => {
        if (cancelled || !canvas.current) return;
        const viewport = page.getViewport({ scale: 1 });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        rendering = page.render({ canvas: canvas.current, viewport });
        await rendering.promise;
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [pdf, number]);
  return (
    <figure>
      {error ? (
        <p role="alert">Page could not be displayed.</p>
      ) : (
        <canvas ref={canvas} aria-label={`PDF page ${number}`} />
      )}
      <figcaption>Page {number}</figcaption>
    </figure>
  );
}

export function PrintPreviewDialog({
  preview,
  projectId,
  onClose,
  onRefresh,
  refreshing,
  error,
}: {
  preview: PrintPreview;
  projectId: string;
  onClose(): void;
  onRefresh(): void;
  refreshing: boolean;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<{
    source: PrintPreview;
    pdf: PDFDocumentProxy;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [acceptedRevision, setAcceptedRevision] = useState("");
  const findings = preview.export?.findings ?? [];
  const blocking =
    !preview.export || findings.some((f) => f.severity === "error");
  const warnings = findings.some((f) => f.severity === "warning");
  useEffect(() => {
    if (!exporting) return;
    let active = true;
    const timer = setInterval(() => {
      void window.drelwick.project
        .printExportStatus({ projectId })
        .then((result) => {
          if (active && result.ok && result.value)
            setExportStatus(result.value);
        })
        .catch(() => {});
    }, 300);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [exporting, projectId]);
  async function exportPdf() {
    setExporting(true);
    setExportStatus("Checking preview revision and preflight...");
    try {
      const result = await window.drelwick.project.exportPrint({
        projectId,
        revision: preview.revision,
        acceptWarnings: acceptedRevision === preview.revision,
      });
      setExportStatus(
        result.ok
          ? result.value.created
            ? `PDF exported from revision ${result.value.revision.slice(0, 12)}.${result.value.cleanupWarning ? " Temporary-file cleanup failed; check the destination folder." : ""}`
            : "PDF export cancelled. The previous destination is preserved."
          : result.error.message,
      );
    } catch {
      setExportStatus(
        "PDF export failed. Retry after checking project and destination access.",
      );
    } finally {
      setExporting(false);
    }
  }
  const [failed, setFailed] = useState(false);
  const [facing, setFacing] = useState(true);
  const [page, setPage] = useState(1);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const task = getDocument({
      data: Uint8Array.from(preview.pdf),
      useSystemFonts: false,
      isEvalSupported: false,
    });
    void task.promise
      .then((document) => {
        if (!cancelled) {
          setLoaded({ source: preview, pdf: document });
          setPage(1);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [preview]);
  const first = facing && page > 1 ? page - (page % 2) : page;
  const visible =
    facing && first > 1 && first < preview.pages.length
      ? [first, first + 1]
      : [first];
  return (
    <dialog
      ref={dialog}
      className="print-preview-dialog"
      aria-labelledby="print-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!refreshing && !exporting) onClose();
      }}
    >
      <h2 id="print-preview-title">Print preview</h2>
      <p>
        Saved PDF revision {preview.revision.slice(0, 12)} ·{" "}
        {preview.pages.length} pages. Refresh to include later changes.
      </p>
      <p>
        Export saves these exact PDF pages after basic preflight. Changed
        sources require refresh. Review the proof; automated checks cannot
        detect every layout problem.
      </p>
      <button onClick={onRefresh} disabled={refreshing || exporting}>
        {refreshing ? "Rendering…" : "Refresh print preview"}
      </button>
      <button onClick={onClose} disabled={refreshing || exporting}>
        Close print preview
      </button>
      <label>
        <input
          type="checkbox"
          checked={facing}
          onChange={(event) => setFacing(event.target.checked)}
        />
        Facing pages
      </label>
      <label>
        Page{" "}
        <input
          type="number"
          min={1}
          max={preview.pages.length}
          value={page}
          onChange={(event) =>
            setPage(
              Math.max(
                1,
                Math.min(preview.pages.length, Number(event.target.value) || 1),
              ),
            )
          }
        />
      </label>
      <button
        disabled={page <= 1}
        onClick={() => setPage(Math.max(1, first - (facing ? 2 : 1)))}
      >
        Previous pages
      </button>
      <button
        disabled={visible.at(-1) === preview.pages.length}
        onClick={() =>
          setPage(Math.min(preview.pages.length, visible.at(-1)! + 1))
        }
      >
        Next pages
      </button>
      {(error || failed) && (
        <p role="alert">
          {error || "The PDF could not be displayed. Retry the preview."}
        </p>
      )}
      <section aria-label="PDF preflight">
        <h3>Basic preflight</h3>
        <p>
          {preview.pages.length} pages -{" "}
          {blocking ? "Export blocked" : "No blocking findings"}
        </p>
        <ul>
          {findings.map((finding, index) => (
            <li key={index}>
              <strong>
                {finding.severity === "error" ? "Error" : "Warning"}:{" "}
              </strong>
              {finding.chapterId &&
                `${preview.export?.chapters.find((c) => c.id === finding.chapterId)?.title ?? "Chapter"}: `}
              {finding.setting && `${finding.setting}: `}
              {finding.message}
              {finding.page && (
                <>
                  {" "}
                  <button onClick={() => setPage(finding.page!)}>
                    Review page {finding.page}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {warnings && (
          <label>
            <input
              type="checkbox"
              checked={acceptedRevision === preview.revision}
              disabled={exporting}
              onChange={(event) =>
                setAcceptedRevision(
                  event.target.checked ? preview.revision : "",
                )
              }
            />
            I reviewed the warnings for this revision
          </label>
        )}
        <button
          onClick={() => void exportPdf()}
          disabled={
            refreshing ||
            exporting ||
            failed ||
            loaded?.source !== preview ||
            blocking ||
            (warnings && acceptedRevision !== preview.revision)
          }
        >
          Export PDF
        </button>
        {exporting && (
          <button
            onClick={() => {
              setExportStatus("Cancelling before publication...");
              void window.drelwick.project
                .cancelPrintExport({ projectId })
                .catch(() =>
                  setExportStatus(
                    "Cancellation could not be sent; wait for the export result.",
                  ),
                );
            }}
          >
            Cancel PDF export
          </button>
        )}
        {exportStatus && <p role="status">{exportStatus}</p>}
      </section>
      <div className="print-pdf-pages">
        {facing && first === 1 && <div aria-hidden="true" />}
        {loaded?.source === preview &&
          !failed &&
          visible.map((number) => (
            <PdfPage
              key={`${preview.revision}-${number}`}
              pdf={loaded.pdf}
              number={number}
            />
          ))}
        {facing && first > 1 && visible.length === 1 && (
          <div aria-hidden="true" />
        )}
      </div>
    </dialog>
  );
}
