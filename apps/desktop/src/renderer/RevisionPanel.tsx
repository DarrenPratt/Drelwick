import { useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Selection } from "@tiptap/pm/state";
import { EditorialHistoryStep } from "@drelwick/core/editorial-history";
import {
  RevisionStateStep,
  normalizeRevision,
  type RevisionState,
} from "@drelwick/core/revisions";
import {
  decodeEditorialDocument,
  decodeEditorialSlice,
  revisionDocumentHash,
  type RevisionSlice,
} from "@drelwick/project-model";
import {
  revisionKey,
  type BlockedRevisionEdit,
} from "./components/RevisionTracking.js";
import type { RevisionAction } from "@drelwick/shared";

const text = (slice: RevisionSlice) =>
  decodeEditorialSlice(slice).content.textBetween(
    0,
    decodeEditorialSlice(slice).content.size,
    "\n",
    (node) => `[${node.type.name}]`,
  ) || "(empty)";
export function RevisionPanel({
  editor,
  projectId,
  chapterId,
  flush,
  onSaved,
  onBusyChange,
  onGuardChange,
}: {
  editor: Editor;
  projectId: string;
  chapterId: string;
  flush(): Promise<boolean>;
  onSaved(state: RevisionState): void;
  onBusyChange(value: boolean): void;
  onGuardChange(value: boolean): void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      revisionKey.getState(current.state) ?? null,
  });
  const [blocked, setBlocked] = useState<BlockedRevisionEdit | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    token: string;
    state: RevisionState;
    ids: string[];
    action: "accept" | "reject";
    title: string;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false),
    pending = useRef<RevisionAction | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const invoke = async <T,>(action: RevisionAction): Promise<T> => {
    const result = await window.drelwick.project.revisions(action);
    if (!result.ok)
      throw Object.assign(new Error(result.error.message), {
        code: result.error.code,
      });
    return result.value as T;
  };
  useEffect(() => {
    onBusyChange(busy || uncertain || blocked !== null);
    return () => onBusyChange(false);
  }, [busy, uncertain, blocked, onBusyChange]);
  useEffect(() => {
    onGuardChange(uncertain || blocked !== null);
    return () => onGuardChange(false);
  }, [uncertain, blocked, onGuardChange]);
  useEffect(() => {
    const handle = async (event: Event) => {
      const value = (event as CustomEvent<BlockedRevisionEdit>).detail;
      if (value.state !== revisionKey.getState(editor.state)) return;
      setError("");
      setBusy(true);
      try {
        // The previous review unit must have durable before-image evidence even
        // when the author combines it before the normal autosave timer fires.
        if (!(await flush()))
          throw new Error(
            "Save the pending revision before combining. Your previous text and draft were retained.",
          );
        if (value.state !== revisionKey.getState(editor.state))
          throw new Error(
            "The chapter changed while saving. Retry the edit and inspect a fresh combine preview.",
          );
        setBlocked(value);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to preserve the pending revision.",
        );
      } finally {
        setBusy(false);
      }
    };
    const invalid = () =>
      setError(
        "This edit could not be represented safely as a revision. The previous manuscript is retained; cancel or review pending changes first.",
      );
    window.addEventListener("drelwick:revision-combine", handle);
    window.addEventListener("drelwick:revision-error", invalid);
    return () => {
      window.removeEventListener("drelwick:revision-combine", handle);
      window.removeEventListener("drelwick:revision-error", invalid);
    };
  }, [editor, flush]);
  useEffect(() => {
    if (blocked || preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [blocked, preview]);
  const combine = () => {
    if (!blocked) return;
    try {
      const current = revisionKey.getState(editor.state);
      if (
        !current ||
        !editor.state.doc.eq(blocked.transaction.before) ||
        revisionDocumentHash(current) !== revisionDocumentHash(blocked.state)
      )
        throw new Error(
          "The chapter changed. Cancel this preview and retry the edit.",
        );
      const options = {
        ...blocked.options,
        tracking: true,
        combineIds: blocked.plan.affectedIds,
      };
      const plan = normalizeRevision(
        current,
        blocked.transaction.doc.toJSON() as Record<string, unknown>,
        options,
      );
      const transaction = closeHistory(editor.state.tr);
      for (const step of blocked.transaction.steps) transaction.step(step);
      transaction
        .setSelection(
          Selection.fromJSON(
            transaction.doc,
            blocked.transaction.selection.toJSON(),
          ),
        )
        .step(
          new RevisionStateStep(options.id, current, plan.state, {
            kind: "edit",
            options,
          }),
        );
      editor.view.dispatch(transaction);
      setBlocked(null);
      editor.commands.focus();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The pending edit changed.",
      );
    }
  };
  const plan = async (ids: string[], action: "accept" | "reject") => {
    setBusy(true);
    setError("");
    try {
      if (!(await flush()))
        throw new Error(
          "Pending edits could not be saved. The review decision was cancelled and drafts were retained.",
        );
      setPreview(
        await invoke({
          operation: "preview",
          projectId,
          chapterId,
          ids,
          action,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review unavailable.");
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    pending.current ??= {
      operation: "commit",
      projectId,
      token: preview.token,
      operationId: crypto.randomUUID(),
    };
    try {
      const saved = await invoke<{
        state: RevisionState;
        historyEventId: string;
      }>(pending.current);
      const before = preview.state;
      const transaction = closeHistory(editor.state.tr)
        .replaceWith(
          0,
          editor.state.doc.content.size,
          editor.schema.nodeFromJSON(saved.state.review.proposed).content,
        )
        .step(new EditorialHistoryStep(saved.historyEventId, "recorded"))
        .step(
          new RevisionStateStep(saved.historyEventId, before, saved.state, {
            kind: "recorded",
          }),
        )
        .setMeta("preventUpdate", true);
      editor.view.dispatch(transaction);
      onSaved(saved.state);
      pending.current = null;
      setUncertain(false);
      setPreview(null);
      editor.commands.focus();
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(
        cause instanceof Error
          ? cause.message
          : "Review outcome is unknown; retry the original decision or reopen for recovery.",
      );
      if (code === "EDITORIAL_STALE" || code === "EDITORIAL_NOT_COMMITTED") {
        pending.current = null;
        setUncertain(false);
      } else setUncertain(true);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (uncertain || busy) return;
    if (preview)
      await invoke({
        operation: "cancel",
        projectId,
        token: preview.token,
      }).catch(() => undefined);
    setPreview(null);
    setBlocked(null);
    editor.commands.focus();
  };
  if (!state) return null;
  return (
    <section aria-label="Revision tracking and review">
      <h3>Revision tracking</h3>
      <p role="status">
        Tracking {state.review.mode === "track" ? "on" : "off"} ·{" "}
        {state.review.pending.length} pending changes
      </p>
      <label>
        <input
          type="checkbox"
          checked={state.review.mode === "track"}
          disabled={busy || uncertain || blocked !== null}
          onChange={(event) => {
            const after = {
              ...state,
              review: {
                ...state.review,
                mode: event.target.checked
                  ? ("track" as const)
                  : ("off" as const),
              },
            };
            editor.view.dispatch(
              closeHistory(editor.state.tr).step(
                new RevisionStateStep(crypto.randomUUID(), state, after, {
                  kind: "mode",
                }),
              ),
            );
          }}
        />
        Track changes in this chapter
      </label>
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Review pending changes</summary>
        <p>
          Turning tracking off preserves pending changes. Ordinary edits cannot
          overwrite them.
        </p>
        {state.review.pending.length > 0 && (
          <>
            <button
              disabled={busy || uncertain}
              onClick={() =>
                void plan(
                  state.review.pending.map((group) => group.id),
                  "accept",
                )
              }
            >
              Review accept all {state.review.pending.length} changes in this
              chapter
            </button>
            <button
              disabled={busy || uncertain}
              onClick={() =>
                void plan(
                  state.review.pending.map((group) => group.id),
                  "reject",
                )
              }
            >
              Review reject all {state.review.pending.length} changes in this
              chapter
            </button>
          </>
        )}
        <ol aria-label="Pending revision changes">
          {state.review.pending.map((group) => (
            <li key={group.id}>
              <article aria-label={`Pending ${group.kind}`}>
                <h4>
                  {group.kind} · {group.authorLabel ?? "Local change"}
                </h4>
                <h5>Original</h5>
                <pre>{text(group.before)}</pre>
                {(group.kind === "delete" || group.kind === "replace") && (
                  <button
                    disabled={busy || uncertain}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("drelwick:comment-retained-revision", {
                          detail: { chapterId, groupId: group.id },
                        }),
                      )
                    }
                  >
                    Comment on original text
                  </button>
                )}
                <h5>Proposed</h5>
                <pre>{text(group.after)}</pre>
                <details>
                  <summary>Formatting and structure</summary>
                  <pre>
                    {JSON.stringify(
                      { before: group.before, after: group.after },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <button
                  disabled={busy || uncertain}
                  onClick={() => void plan([group.id], "accept")}
                >
                  Review accept change
                </button>
                <button
                  disabled={busy || uncertain}
                  onClick={() => void plan([group.id], "reject")}
                >
                  Review reject change
                </button>
              </article>
            </li>
          ))}
        </ol>
      </details>
      <dialog
        ref={dialog}
        aria-label={
          blocked ? "Combine affected changes" : "Confirm revision decision"
        }
        onCancel={(event) => {
          event.preventDefault();
          void cancel();
        }}
      >
        {blocked ? (
          <>
            <h3>Combine affected changes?</h3>
            <p>
              {blocked.plan.affectedIds.length} pending changes are touched by
              this edit.{" "}
              {blocked.plan.wholeChapter
                ? "This change affects the whole chapter."
                : ""}{" "}
              A new review unit will retain the superseded identities and their
              saved evidence.
            </p>
            <h4>Original proposed text</h4>
            <ul aria-label="Affected revision identities">
              {blocked.plan.affectedIds.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
            <pre>
              {
                decodeEditorialDocument(blocked.state.review.proposed)
                  .textContent
              }
            </pre>
            <h4>After this edit</h4>
            <pre>{blocked.transaction.doc.textContent}</pre>
            <details>
              <summary>Exact semantic formatting before and after</summary>
              <pre>
                {JSON.stringify(
                  {
                    before: blocked.state.review.proposed,
                    after: blocked.transaction.doc.toJSON(),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            {state.review.mode === "off" && (
              <p>
                Tracking is off. Enable tracking and combine, review affected
                changes first, or cancel this edit.
              </p>
            )}
            <button onClick={combine}>
              Enable tracking and combine affected changes
            </button>
            <button
              onClick={() => {
                setBlocked(null);
                setError(
                  "Edit cancelled. Review the affected pending changes below before editing again.",
                );
              }}
            >
              Review affected changes first
            </button>
            <button onClick={() => void cancel()}>Cancel edit</button>
          </>
        ) : preview ? (
          <>
            <h3>
              {preview.action === "accept" ? "Accept" : "Reject"}{" "}
              {preview.ids.length} selected changes in {preview.title}?
            </h3>
            <p>
              A verified whole-manuscript safety snapshot will preserve the
              current saved bundle first. This decision applies only to the
              exact selected identities.
            </p>
            <ul>
              {preview.state.review.pending
                .filter((group) => preview.ids.includes(group.id))
                .map((group) => (
                  <li key={group.id}>
                    {group.kind}: {text(group.before)} → {text(group.after)}
                  </li>
                ))}
            </ul>
            {error && <p role="alert">{error}</p>}
            <button disabled={busy} onClick={() => void commit()}>
              {uncertain
                ? "Retry original revision decision"
                : "Confirm revision decision"}
            </button>
            <button disabled={busy || uncertain} onClick={() => void cancel()}>
              Cancel revision decision
            </button>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
