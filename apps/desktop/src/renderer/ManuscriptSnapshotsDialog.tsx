import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectWorkspace,
  SnapshotAction,
  SnapshotListing,
  SnapshotSummary,
  SnapshotInspection,
  SnapshotRestorePreview,
} from "@drelwick/shared";

type ConflictCollection = {
  id: string;
  sourceGeneration: number;
  entries: {
    annotation: { id: string; kind: string };
    anchor: unknown;
    thread: { comments: { id: string; body: string }[] };
    reason: string;
    disposition: string;
  }[];
};
let snapshotQueue: Promise<unknown> = Promise.resolve();
function invoke<T>(action: SnapshotAction): Promise<T> {
  const operation = snapshotQueue.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const result = await window.drelwick.project.snapshots(action);
      if (result.ok) return result.value as T;
      if (result.error.code !== "PROJECT_BUSY" || attempt >= 10)
        throw new Error(result.error.message);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  });
  snapshotQueue = operation.catch(() => undefined);
  return operation;
}

function prose(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { type?: string; text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  if (node.type === "image") return "[Image]";
  return (node.content ?? [])
    .map(prose)
    .join(node.type === "doc" ? "\n\n" : "");
}
export function ManuscriptSnapshotsDialog({
  projectId,
  flush,
  onClose,
  onRestored,
  onChanged,
  onUncertain,
  onConflictCount,
  target,
}: {
  projectId: string;
  flush(): Promise<boolean>;
  onClose(): void;
  onRestored(workspace: ProjectWorkspace): void;
  onChanged(): void;
  onUncertain(): void;
  onConflictCount(count: number): void;
  target?: { chapterId: string; from: number; to: number };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<SnapshotAction | null>(null);
  const planning = useRef(false);
  const [planningAction, setPlanningAction] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<SnapshotAction | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [listing, setListing] = useState<SnapshotListing | null>(null),
    [label, setLabel] = useState("");
  const [showDeleted, setShowDeleted] = useState(false),
    [inspection, setInspection] = useState<SnapshotInspection | null>(null);
  const [preview, setPreview] = useState<SnapshotRestorePreview | null>(null),
    [chapterId, setChapterId] = useState("");
  const previewRef = useRef<SnapshotRestorePreview | null>(null);
  const [collections, setCollections] = useState<ConflictCollection[]>([]),
    [status, setStatus] = useState("");
  const [showResolvedConflicts, setShowResolvedConflicts] = useState(false);
  const refresh = useCallback(async () => {
    const value = await invoke<SnapshotListing>({
      operation: "list",
      projectId,
    });
    setListing(value);
    onConflictCount(value.conflicts);
    setCollections(
      await invoke<ConflictCollection[]>({ operation: "conflicts", projectId }),
    );
    return value;
  }, [projectId, onConflictCount]);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      focused?.focus();
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Unable to list snapshots.",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const cancelPreview = async () => {
    const token = previewRef.current?.token;
    if (token) await invoke({ operation: "cancel-preview", projectId, token });
    previewRef.current = null;
    setPreview(null);
  };
  const close = async () => {
    if (busy) return;
    if (pending.current) {
      if (
        !window.confirm(
          "This operation needs recovery or receipt verification. Close this panel and reopen the project before editing? Your current editor and recovery evidence will be retained.",
        )
      )
        return;
      onUncertain();
    }
    await cancelPreview().catch(() => undefined);
    onClose();
  };
  const run = async (action: SnapshotAction, mutating = false) => {
    if (busy || (mutating && pending.current)) return;
    setBusy(true);
    setError("");
    if (mutating) {
      pending.current = action;
      setPendingRequest(action);
    }
    try {
      if (action.operation === "inspect") await cancelPreview();
      const value = await invoke<unknown>(action);
      if (mutating) {
        pending.current = null;
        setPendingRequest(null);
        if (action.operation === "restore") {
          const restored = value as {
            workspace: ProjectWorkspace;
            receipt: { conflicts: number };
          };
          onConflictCount(restored.receipt.conflicts);
          onRestored(restored.workspace);
          setStatus(
            "Manuscript restored. The before-restore safety snapshot preserves the previous manuscript.",
          );
          await cancelPreview();
        } else {
          if (action.operation !== "capture") onChanged();
          setStatus(
            action.operation === "capture"
              ? "Named manuscript snapshot saved."
              : "Snapshot operation saved. Original evidence is retained.",
          );
        }
        await refresh();
      } else if (action.operation === "inspect") {
        setInspection(value as SnapshotInspection);
        setChapterId((value as SnapshotInspection).chapters[0]?.id ?? "");
      } else if (action.operation === "preview") {
        const next = value as SnapshotRestorePreview;
        previewRef.current = next;
        setPreview(next);
        setInspection(next.snapshot);
        setChapterId(next.snapshot.chapters[0]?.id ?? "");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The operation could not be confirmed. Preserve current work and reopen for recovery.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveSnapshot = async () => {
    await cancelPreview();
    if (!(await flush())) {
      setError(
        "Pending edits could not be saved. Snapshot capture was cancelled; your drafts remain available.",
      );
      return;
    }
    const current = await refresh();
    await run(
      {
        operation: "capture",
        projectId,
        operationId: crypto.randomUUID(),
        label,
        expected: current.source,
      },
      true,
    );
  };
  const changeDeletion = async (snapshot: SnapshotSummary) => {
    if (
      !window.confirm(
        snapshot.deleted
          ? `Undelete “${snapshot.label}”?`
          : `Delete “${snapshot.label}” from the active list? All captured bytes remain recoverable in Deleted snapshots.`,
      )
    )
      return;
    await cancelPreview();
    if (!(await flush())) {
      setError("Save pending edits before changing snapshot retention.");
      return;
    }
    const current = await refresh();
    await run(
      {
        operation: "delete",
        projectId,
        operationId: crypto.randomUUID(),
        expected: current.source,
        snapshotId: snapshot.snapshotId,
        manifestHash: snapshot.manifestHash,
        deleted: !snapshot.deleted,
      },
      true,
    );
  };
  const showPreview = async (snapshot: SnapshotSummary) => {
    await cancelPreview();
    if (!(await flush())) {
      setError(
        "Pending edits could not be saved. Restore preview was cancelled.",
      );
      return;
    }
    await run({
      operation: "preview",
      projectId,
      snapshotId: snapshot.snapshotId,
      manifestHash: snapshot.manifestHash,
    });
  };
  const restore = async () => {
    if (
      !preview?.token ||
      !window.confirm(
        `Restore “${preview.snapshot.snapshot.label}”? A verified safety snapshot will preserve the current full manuscript first. Current-only and divergent discussions will be retained in restore conflicts.`,
      )
    )
      return;
    if (!(await flush())) {
      setError("Pending edits could not be saved. Nothing was restored.");
      return;
    }
    await run(
      {
        operation: "restore",
        projectId,
        operationId: crypto.randomUUID(),
        token: preview.token,
      },
      true,
    );
  };
  const resolve = async (
    collectionId: string,
    annotationId: string,
    action: "copy" | "reattach" | "discard",
  ) => {
    if (
      !window.confirm(
        action === "discard"
          ? "Mark this conflict discarded? Its original payload will remain retained."
          : action === "reattach"
            ? "Copy this discussion with new identities and attach the copy to the selected manuscript text? The restored discussion will remain unchanged."
            : "Copy this retained discussion with new identities into orphaned annotations? The original conflict payload will remain retained.",
      )
    )
      return;
    await cancelPreview();
    if (!(await flush())) return;
    const current = await refresh();
    await run(
      {
        operation: "resolve-conflict",
        projectId,
        operationId: crypto.randomUUID(),
        expected: current.source,
        collectionId,
        annotationId,
        action,
        ...(action === "reattach" && target ? { target } : {}),
      },
      true,
    );
  };
  const safely = (operation: () => Promise<void>) => {
    if (planning.current || busy) return;
    planning.current = true;
    setPlanningAction(true);
    void operation()
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Save or refresh before retrying.",
        ),
      )
      .finally(() => {
        planning.current = false;
        setPlanningAction(false);
      });
  };
  const busyUi = busy || planningAction;
  const selected = inspection?.chapters.find(
    (chapter) => chapter.id === chapterId,
  );
  return (
    <dialog
      ref={dialog}
      aria-labelledby="manuscript-snapshots-title"
      className="manuscript-snapshots-dialog"
      onCancel={(event) => {
        event.preventDefault();
        safely(close);
      }}
    >
      <h2 id="manuscript-snapshots-title">Manuscript snapshots</h2>
      <p>
        Named checkpoints preserve the complete saved manuscript, discussions,
        publication settings and required images. Story Bible data and periodic
        Chapter History are excluded. No automatic pruning occurs.
      </p>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {pendingRequest && (
        <p role="alert">
          An operation is awaiting verification. Retry the original request or
          reopen the project for recovery.
        </p>
      )}
      <fieldset disabled={busyUi || pendingRequest !== null}>
        <legend>Capture a checkpoint</legend>
        <label>
          Snapshot name
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={1000}
          />
        </label>
        <button
          disabled={!label.trim() || [...label].length > 500 || !listing}
          onClick={() => safely(saveSnapshot)}
        >
          Capture named snapshot
        </button>
      </fieldset>
      <button
        disabled={busyUi}
        onClick={() =>
          safely(async () => {
            await refresh();
          })
        }
      >
        Refresh snapshots
      </button>
      {pendingRequest && (
        <button
          disabled={busyUi}
          onClick={() => {
            const action = pending.current!;
            pending.current = null;
            setPendingRequest(null);
            void run(action, true);
          }}
        >
          Retry original snapshot operation
        </button>
      )}
      <label>
        <input
          type="checkbox"
          checked={showDeleted}
          onChange={(event) => setShowDeleted(event.target.checked)}
        />
        Deleted snapshots
      </label>
      <ul
        aria-label={
          showDeleted
            ? "Deleted manuscript snapshots"
            : "Saved manuscript snapshots"
        }
      >
        {listing?.snapshots
          .filter((snapshot) => snapshot.deleted === showDeleted)
          .map((snapshot) => (
            <li key={snapshot.snapshotId}>
              <strong>{snapshot.label}</strong>{" "}
              <span>
                {snapshot.created} · {snapshot.chapters} chapters · saved
                version {snapshot.generation} · {snapshot.reason}
              </span>
              <button
                disabled={busyUi}
                onClick={() =>
                  void run({
                    operation: "inspect",
                    projectId,
                    snapshotId: snapshot.snapshotId,
                    manifestHash: snapshot.manifestHash,
                  })
                }
              >
                Inspect {snapshot.label}
              </button>
              {!snapshot.deleted && (
                <button
                  disabled={busyUi || pendingRequest !== null}
                  onClick={() => safely(() => showPreview(snapshot))}
                >
                  Preview restore {snapshot.label}
                </button>
              )}
              <button
                disabled={busyUi || pendingRequest !== null}
                onClick={() => safely(() => changeDeletion(snapshot))}
              >
                {snapshot.deleted ? "Undelete" : "Delete"} {snapshot.label}
              </button>
            </li>
          ))}
      </ul>
      {listing?.diagnostics.map((item) => (
        <p key={item.snapshotId} role="status">
          Incomplete or unavailable snapshot {item.snapshotId}. Its retained
          staging files are preserved for independent recovery.
        </p>
      ))}
      {inspection && (
        <section aria-label="Snapshot inspection">
          <h3>{inspection.snapshot.label}</h3>
          <p>Snapshot ID: {inspection.snapshot.snapshotId}</p>
          <p>Verified SHA-256: {inspection.snapshot.manifestHash}</p>
          <label>
            Captured chapter
            <select
              value={chapterId}
              onChange={(event) => setChapterId(event.target.value)}
            >
              {inspection.chapters.map((chapter) => (
                <option value={chapter.id} key={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <h4>Captured manuscript</h4>
              <pre>{prose(selected.document)}</pre>
              <details>
                <summary>Saved formatting and images</summary>
                <pre>{JSON.stringify(selected.document, null, 2)}</pre>
              </details>
            </>
          )}
          <details>
            <summary>Saved discussions</summary>
            <pre>{JSON.stringify(inspection.editorial, null, 2)}</pre>
          </details>
          <details>
            <summary>Publication and appearance</summary>
            <pre>{JSON.stringify(inspection.publication, null, 2)}</pre>
          </details>
          <details>
            <summary>Verified inventory and excluded scope</summary>
            <pre>
              {JSON.stringify(
                {
                  files: inspection.files,
                  absent: inspection.absent,
                  exclusions: inspection.exclusions,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      )}
      {preview && (
        <section aria-label="Restore preview">
          <h3>Restore preview</h3>
          <p>
            Current saved version {preview.current.generation}. Restore will
            create a new saved version and a mandatory before-restore safety
            snapshot.
          </p>
          <p>
            {preview.conflicts} current-only or divergent discussions will be
            retained as restore conflicts.
          </p>
          <p>
            Current chapter order:{" "}
            {preview.currentChapters
              .map((chapter) => chapter.title)
              .join(" → ")}
          </p>
          <p>
            Restored chapter order:{" "}
            {preview.snapshot.chapters
              .map((chapter) => chapter.title)
              .join(" → ")}
          </p>
          <h4>Current manuscript at this chapter</h4>
          <pre>
            {prose(
              preview.currentChapters.find(
                (chapter) => chapter.id === chapterId,
              )?.document,
            ) || "Chapter is absent from the current manuscript."}
          </pre>
          <details>
            <summary>Current publication and appearance</summary>
            <pre>{JSON.stringify(preview.currentContext, null, 2)}</pre>
          </details>
          <button
            disabled={busyUi || pendingRequest !== null}
            onClick={() => safely(restore)}
          >
            Restore selected manuscript snapshot
          </button>
          <button disabled={busyUi} onClick={() => safely(cancelPreview)}>
            Cancel restore preview
          </button>
        </section>
      )}
      <section aria-label="Restore conflicts">
        <h3>Restore conflicts</h3>
        <p>
          {listing?.conflicts ?? 0} unresolved discussions. Original payloads
          remain retained after every choice.
        </p>
        <label>
          <input
            type="checkbox"
            checked={showResolvedConflicts}
            onChange={(event) => setShowResolvedConflicts(event.target.checked)}
          />
          Show retained conflict decisions
        </label>
        {collections.map((collection) =>
          collection.entries
            .filter(
              (entry) =>
                showResolvedConflicts || entry.disposition === "unresolved",
            )
            .map((entry) => (
              <article key={`${collection.id}:${entry.annotation.id}`}>
                <p>Decision: {entry.disposition}</p>
                <h4>
                  {entry.reason === "current-only"
                    ? "Current-only discussion"
                    : "Divergent discussion"}{" "}
                  from saved version {collection.sourceGeneration}
                </h4>
                {entry.thread.comments.map((comment) => (
                  <p key={comment.id}>{comment.body}</p>
                ))}
                <details>
                  <summary>Original attachment evidence</summary>
                  <pre>{JSON.stringify(entry.anchor, null, 2)}</pre>
                </details>
                <button
                  disabled={
                    busyUi ||
                    pendingRequest !== null ||
                    entry.disposition !== "unresolved"
                  }
                  onClick={() =>
                    safely(() =>
                      resolve(collection.id, entry.annotation.id, "copy"),
                    )
                  }
                >
                  Copy discussion to orphaned annotations
                </button>
                <button
                  disabled={
                    busyUi ||
                    pendingRequest !== null ||
                    entry.disposition !== "unresolved" ||
                    !target ||
                    target.from === target.to
                  }
                  onClick={() =>
                    safely(() =>
                      resolve(collection.id, entry.annotation.id, "reattach"),
                    )
                  }
                >
                  Reattach copy to selected manuscript text
                </button>
                <button
                  disabled={
                    busyUi ||
                    pendingRequest !== null ||
                    entry.disposition !== "unresolved"
                  }
                  onClick={() =>
                    safely(() =>
                      resolve(collection.id, entry.annotation.id, "discard"),
                    )
                  }
                >
                  Discard conflict while retaining evidence
                </button>
              </article>
            )),
        )}
      </section>
      <button disabled={busyUi} onClick={() => safely(close)}>
        Close manuscript snapshots
      </button>
    </dialog>
  );
}
