import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type {
  ChapterHistory,
  HistoryPreview,
  HistoryRequest,
  HistorySelection,
} from "@drelwick/shared";
import { createManuscriptExtensions } from "./components/manuscript-extensions.js";

export function HistoryPreviewContent({
  content,
}: {
  content: Record<string, unknown>;
}) {
  const editor = useEditor({
    extensions: createManuscriptExtensions(),
    content,
    editable: false,
    editorProps: {
      attributes: { "aria-label": "Snapshot preview", role: "document" },
      handleClick: () => true,
    },
  });
  return (
    <div onClick={(event) => event.preventDefault()}>
      <EditorContent editor={editor} />
    </div>
  );
}

export function ChapterHistoryDialog({
  request,
  revision,
  onClose,
  onRestore,
}: {
  request: HistoryRequest;
  revision: number;
  onClose(): void;
  onRestore(
    selection: HistorySelection,
    preview: HistoryPreview,
  ): Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<ChapterHistory | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { projectId, chapterId } = request;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (busy || confirming) return;
    let active = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const result = await window.drelwick.project.listHistory({
          projectId,
          chapterId,
        });
        if (!active) return;
        if (!result.ok) {
          setError(result.error.message);
          setHistory(null);
        } else {
          setHistory(result.value);
          setSelected((current) =>
            result.value.entries.some((entry) => entry.id === current)
              ? current
              : null,
          );
        }
      } catch {
        if (active) {
          setError("Unable to load Chapter History. Refresh to retry.");
          setHistory(null);
        }
      } finally {
        reading = false;
        if (active) setLoading(false);
      }
    };
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, chapterId, revision, refresh, busy, confirming]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void window.drelwick.project
      .previewHistory({ projectId, chapterId, snapshotId: selected })
      .then((result) => {
        if (!active) return;
        if (result.ok) setPreview(result.value);
        else setError(result.error.message);
      })
      .catch(() => {
        if (active) setError("This snapshot is unavailable. Refresh history.");
      });
    return () => {
      active = false;
    };
  }, [projectId, chapterId, selected, refresh]);
  const entry = history?.entries.find((value) => value.id === selected);
  async function restore() {
    if (!entry || !preview || busy) return;
    setBusy(true);
    const failure = await onRestore(
      { projectId, chapterId, snapshotId: entry.id },
      preview,
    );
    setBusy(false);
    setConfirming(false);
    if (failure) setError(failure);
    else {
      setSelected(null);
      setPreview(null);
      setRefresh((value) => value + 1);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="project-dialog chapter-history"
      aria-labelledby="chapter-history-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="chapter-history-title">Chapter History</h2>
      <p>
        {history
          ? history.title
            ? `Current title: ${history.title}`
            : "Missing or deleted chapter"
          : "Chapter snapshots"}
      </p>
      <small>Chapter ID: {chapterId}</small>
      <p>
        Local snapshots, newest first. Previewing does not change your chapter.
        Titles and status are not stored in snapshots.
      </p>
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert">{error}</p>}
      {!!history?.unavailable && (
        <p role="status">
          {history.unavailable} invalid or unsupported snapshots omitted.
        </p>
      )}
      {history && !history.title && (
        <p role="status">
          This chapter no longer exists. Preview is available; in-place restore
          is disabled.
        </p>
      )}
      <div className="history-columns">
        <ol aria-label="Snapshots">
          {history?.entries.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={busy || confirming}
                aria-pressed={item.id === selected}
                onClick={() => {
                  setError("");
                  if (selected !== item.id) setPreview(null);
                  setSelected(item.id);
                }}
              >
                <time dateTime={item.created}>
                  {new Date(item.created).toLocaleString()}
                </time>
                <small>Snapshot {item.id}</small>
              </button>
            </li>
          ))}
        </ol>
        <section aria-label="History preview">
          {entry && (
            <p>
              Snapshot from{" "}
              <time dateTime={entry.created}>
                {new Date(entry.created).toLocaleString()}
              </time>
            </p>
          )}
          {entry && preview ? (
            <HistoryPreviewContent
              key={`${entry.id}:${preview.fingerprint}`}
              content={preview.content}
            />
          ) : (
            <p>
              {entry ? "Loading preview…" : "Select a snapshot to preview."}
            </p>
          )}
          <p>
            Image references are preserved. Images are not loaded in this
            preview; missing project assets remain unavailable after restore.
          </p>
        </section>
      </div>
      {history?.entries.length === 0 && (
        <p>No available snapshots for this chapter.</p>
      )}
      {confirming && (
        <div role="group" aria-label="Confirm restore">
          <p>
            The selected historical snapshot will become this chapter’s current
            content. Your current content, including unsaved edits, will first
            be saved and preserved as a new snapshot. The chapter ID, current
            title and status stay the same.
          </p>
          <button disabled={busy} onClick={() => setConfirming(false)}>
            Cancel restore
          </button>
          <button disabled={busy} onClick={() => void restore()}>
            {busy ? "Restoring…" : "Confirm restore"}
          </button>
        </div>
      )}
      <div className="dialog-actions">
        <button disabled={busy} onClick={onClose}>
          Close history
        </button>
        <button
          disabled={busy || confirming}
          onClick={() => {
            setLoading(true);
            setPreview(null);
            setRefresh((value) => value + 1);
          }}
        >
          Refresh history
        </button>
        <button
          disabled={busy || confirming || !history?.title || !entry || !preview}
          onClick={() => setConfirming(true)}
        >
          Restore snapshot
        </button>
      </div>
    </dialog>
  );
}
