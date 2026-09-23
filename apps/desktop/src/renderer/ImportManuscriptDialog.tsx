import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ImportInspection,
  ImportReview,
  ProjectWorkspace,
  ProjectOperationResult,
} from "@sarel/shared";
interface Props {
  beforeOpen(): Promise<boolean>;
  onCancel(message?: string): void;
  onOpened(project: ProjectWorkspace, warning?: string): void;
}
function blockText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: string; type?: string; content?: unknown[] };
  if (node.type === "hardBreak") return "\n";
  if (node.type === "sceneBreak") return "[Scene break]";
  if (node.type === "image") return "[Image]";
  if (node.text !== undefined) return node.text;
  const separator = [
    "doc",
    "blockquote",
    "bulletList",
    "orderedList",
    "listItem",
    "epigraph",
  ].includes(node.type ?? "")
    ? "\n"
    : "";
  return node.content?.map(blockText).join(separator) || "[Empty block]";
}
export function ImportManuscriptDialog({
  beforeOpen,
  onCancel,
  onOpened,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const started = useRef(false);
  const operationId = useRef(crypto.randomUUID());
  const pending = useRef(false);
  const cancelled = useRef(false);
  const cancellation = useRef<Promise<ProjectOperationResult<null>> | null>(
    null,
  );
  const [preview, setPreview] = useState<ImportInspection | null>(null);
  const [boundaries, setBoundaries] = useState<ImportReview["boundaries"]>([]);
  const [accepted, setAccepted] = useState<number[]>([]);
  const [status, setStatus] = useState(
    "Inspecting document and preparing preview...",
  );
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [opening, setOpening] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [page, setPage] = useState(0);
  const [block, setBlock] = useState(0);
  const [committed, setCommitted] = useState(false);
  const [commitWarning, setCommitWarning] = useState<string>();
  const finishCancellation = useCallback(
    async (message?: string) => {
      try {
        const result = await cancellation.current;
        if (result && !result.ok && result.error.code !== "IMPORT_EXPIRED") {
          setError(result.error.message);
          setExpired(true);
        } else onCancel(message);
      } catch {
        setError("Unable to confirm cancellation. Please retry Cancel import.");
        cancelled.current = false;
      } finally {
        setCancelling(false);
      }
    },
    [onCancel],
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    pending.current = true;
    void window.sarel.imports
      .inspect({ operationId: operationId.current, importer: "docx" })
      .then(async (result) => {
        if (!result.ok) {
          if (cancelled.current && result.error.code === "IMPORT_CANCELLED") {
            await finishCancellation();
            return;
          }
          setError(result.error.message);
          setExpired(true);
        } else if (cancelled.current) await finishCancellation();
        else if (!result.value) onCancel();
        else {
          setPreview(result.value);
          let offset = 0;
          setBoundaries(
            result.value.chapters
              .map((chapter) => {
                const boundary = { block: offset, title: chapter.title };
                offset += Array.isArray(chapter.content.content)
                  ? chapter.content.content.length
                  : 0;
                return boundary;
              })
              .filter(
                (boundary, index, all) =>
                  index === 0 || boundary.block !== all[index - 1]?.block,
              ),
          );
        }
      })
      .catch(() => {
        cancelled.current = false;
        setError(
          "Unable to inspect the document. Cancel this import and try again.",
        );
      })
      .finally(() => {
        pending.current = false;
        setStatus("");
        setCancelling(false);
      });
  }, [onCancel, finishCancellation]);
  async function cancel() {
    if (opening) return;
    if (cancelled.current && !expired && !committed) return;
    if (committed || expired) {
      onCancel(
        committed
          ? "Imported project retained in the selected folder. Use Open project to validate and open it later."
          : undefined,
      );
      return;
    }
    cancelled.current = true;
    setCancelling(true);
    cancellation.current = window.sarel.imports.cancel(operationId.current);
    // In-flight inspection/commit waits for this acknowledgement before closing.
    void cancellation.current.catch(() => undefined);
    if (!pending.current) await finishCancellation();
  }
  async function openCommitted(warning = commitWarning) {
    setOpening(true);
    setStatus("Validating and opening project...");
    try {
      if (!(await beforeOpen())) {
        setError(
          "Unable to save the current chapter. Your edits remain open. Save successfully before opening the imported project.",
        );
        return;
      }
      const result = await window.sarel.imports.open(operationId.current);
      if (!result.ok)
        setError(
          `${result.error.message} The imported folder is retained; the previous project remains open.`,
        );
      else if (result.value)
        onOpened(
          result.value,
          [warning, result.warning].filter(Boolean).join(" ") || undefined,
        );
    } catch {
      setError(
        "Unable to open the imported project. Preserve the selected folder and retry opening it. The previous manuscript remains available.",
      );
    } finally {
      setOpening(false);
      setStatus("");
    }
  }
  async function commit() {
    if (
      pending.current ||
      !preview ||
      expired ||
      accepted.length !== preview.warnings.length
    )
      return;
    pending.current = true;
    setError("");
    setStatus("Choose a new empty folder, then stage and write the project...");
    try {
      // Reuse the active editor's autosave coordinator before any destination writes.
      const saved = await beforeOpen();
      if (cancelled.current) {
        await finishCancellation();
        return;
      }
      if (!saved) {
        setError(
          "Unable to save the current chapter. Your edits remain open; save successfully before importing.",
        );
        return;
      }
      const result = await window.sarel.imports.commit(operationId.current, {
        boundaries,
        acceptedWarnings: accepted,
      });
      if (!result.ok) {
        if (cancelled.current && result.error.code === "IMPORT_CANCELLED") {
          await finishCancellation();
          return;
        }
        setError(result.error.message);
        setExpired(
          result.error.code !== "IMPORT_REVIEW_REQUIRED" &&
            result.error.code !== "IMPORT_INPUT_INVALID",
        );
      } else if (result.value) {
        setCommitted(true);
        setCommitWarning(result.warning);
        if (cancelled.current)
          await finishCancellation(
            "Import finished before cancellation. The project is retained in the selected folder and has not been opened.",
          );
        else await openCommitted(result.warning);
      } else if (cancelled.current) await finishCancellation();
    } catch {
      cancelled.current = false;
      setError(
        "Unable to confirm import completion. Preserve the selected folder and cancel this review before retrying.",
      );
    } finally {
      pending.current = false;
      setStatus("");
      setCancelling(false);
    }
  }
  const blocks = useMemo(
    () =>
      preview?.chapters.flatMap((chapter) =>
        Array.isArray(chapter.content.content) ? chapter.content.content : [],
      ) ?? [],
    [preview],
  );
  return (
    <dialog
      ref={dialog}
      className="project-dialog import-dialog"
      aria-labelledby="import-title"
      onCancel={(event) => {
        event.preventDefault();
        void cancel();
      }}
    >
      <h2 id="import-title">Import manuscript</h2>
      <p>
        Review the semantic conversion before creating a project. Your source
        DOCX stays unchanged.
      </p>
      {status && (
        <p role="status">
          {cancelling ? "Cancelling import and cleaning up..." : status}
        </p>
      )}
      {commitWarning && <p role="status">{commitWarning}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {preview && !committed && (
        <fieldset disabled={Boolean(status) || expired || cancelling}>
          <legend>Conversion preview</legend>
          <h3>Imported metadata</h3>
          <dl>
            {Object.entries(preview.metadata).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === "object"
                    ? `${value.name}${value.number ? ` (${value.number})` : ""}`
                    : value}
                </dd>
              </div>
            ))}
          </dl>
          <h3>Proposed chapters</h3>
          <p>
            All blocks stay in reading order. Remove a boundary to join
            chapters, or choose a block to start another chapter.
          </p>
          <ol>
            {boundaries.map((boundary, index) => (
              <li key={boundary.block}>
                <label>
                  Chapter {index + 1} title
                  <input
                    maxLength={200}
                    value={boundary.title}
                    onChange={(event) =>
                      setBoundaries((current) =>
                        current.map((item) =>
                          item.block === boundary.block
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <p>
                  Starts at block {boundary.block + 1}:{" "}
                  {blockText(blocks[boundary.block]).slice(0, 200)}
                </p>
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setBoundaries((current) =>
                        current.filter((item) => item !== boundary),
                      )
                    }
                  >
                    Remove boundary before {boundary.title}
                  </button>
                )}
              </li>
            ))}
          </ol>
          <label>
            Start a chapter at block
            <input
              type="number"
              min={1}
              max={Math.max(1, blocks.length)}
              value={block + 1}
              onChange={(event) =>
                setBlock(
                  Math.max(
                    0,
                    Math.min(blocks.length - 1, Number(event.target.value) - 1),
                  ),
                )
              }
            />
          </label>
          <p>{blockText(blocks[block]).slice(0, 300)}</p>
          <button
            type="button"
            disabled={
              blocks.length === 0 ||
              boundaries.length >= 1000 ||
              boundaries.some((item) => item.block === block)
            }
            onClick={() =>
              setBoundaries((current) =>
                [
                  ...current,
                  { block, title: `Chapter ${current.length + 1}` },
                ].sort((a, b) => a.block - b.block),
              )
            }
          >
            Add chapter boundary
          </button>
          <details>
            <summary>
              Manuscript text and reading order ({blocks.length} blocks;{" "}
              {preview.assets.length} images)
            </summary>
            <p>
              Blocks {Math.min(page * 50 + 1, blocks.length)}-
              {Math.min((page + 1) * 50, blocks.length)}
            </p>
            <ol start={page * 50 + 1}>
              {blocks.slice(page * 50, (page + 1) * 50).map((value, index) => (
                <li key={index}>{blockText(value)}</li>
              ))}
            </ol>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous blocks
            </button>
            <button
              type="button"
              disabled={(page + 1) * 50 >= blocks.length}
              onClick={() => setPage((value) => value + 1)}
            >
              Next blocks
            </button>
          </details>
          <h3>Conversion warnings</h3>
          <p>
            Each warning requires your approval of the described conversion.
            Cancel import if any conversion is unacceptable. Locations refer to
            the original proposal.
          </p>
          {preview.warnings.length === 0 && <p>No conversion warnings.</p>}
          <ul>
            {preview.warnings.map((warning, index) => (
              <li key={index}>
                <p>
                  <strong>{warning.location.label}</strong>
                  {warning.location.chapter === undefined
                    ? ""
                    : ` - proposed chapter ${warning.location.chapter + 1}`}
                  {warning.location.block === undefined
                    ? ""
                    : ` - source block ${warning.location.block + 1}`}
                </p>
                <p>{warning.message}</p>
                <label>
                  <input
                    type="checkbox"
                    checked={accepted.includes(index)}
                    onChange={(event) =>
                      setAccepted((current) =>
                        event.target.checked
                          ? [...current, index]
                          : current.filter((item) => item !== index),
                      )
                    }
                  />
                  I approve this conversion ({index + 1})
                </label>
              </li>
            ))}
          </ul>
          <p>
            {preview.warnings.length - accepted.length} decisions remaining.
          </p>
        </fieldset>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          disabled={opening || cancelling}
          onClick={() => void cancel()}
        >
          {committed || expired ? "Close import" : "Cancel import"}
        </button>
        {committed ? (
          <button
            type="button"
            disabled={Boolean(status)}
            onClick={() => void openCommitted()}
          >
            Retry opening imported project
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={
              !preview ||
              Boolean(status) ||
              expired ||
              cancelling ||
              accepted.length !== preview.warnings.length ||
              boundaries.some((item) => !item.title.trim())
            }
            onClick={() => void commit()}
          >
            Choose destination and import
          </button>
        )}
      </div>
    </dialog>
  );
}
