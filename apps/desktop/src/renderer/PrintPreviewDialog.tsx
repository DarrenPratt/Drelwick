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
  onClose,
  onRefresh,
  refreshing,
  error,
}: {
  preview: PrintPreview;
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
        if (!refreshing) onClose();
      }}
    >
      <h2 id="print-preview-title">Print preview</h2>
      <p>
        Saved PDF revision {preview.revision.slice(0, 12)} ·{" "}
        {preview.pages.length} pages. Refresh to include later changes.
      </p>
      <p>
        This is a layout preview; final export and publishing preflight are not
        yet available.
      </p>
      <button onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Rendering…" : "Refresh print preview"}
      </button>
      <button onClick={onClose} disabled={refreshing}>
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
      {!!preview.diagnostics.length && (
        <div role="alert">
          <p>Layout issues detected. Review these pages before publication.</p>
          <ul>
            {preview.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {diagnostic.code}
                {diagnostic.page
                  ? ` on page ${diagnostic.page}`
                  : ` in section ${preview.pages.findIndex((page) => page.chapterId === diagnostic.chapterId) + 1}`}
              </li>
            ))}
          </ul>
        </div>
      )}
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
