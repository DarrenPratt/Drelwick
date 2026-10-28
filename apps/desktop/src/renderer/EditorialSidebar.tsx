import type { Editor as TipTapEditor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { setEditorialDecorations } from "./components/EditorialDecorations.js";

interface EditorialAnchor {
  id: string;
  status: "attached" | "partial" | "orphaned" | "unverified";
  original: {
    slice: {
      content: Record<string, unknown>[];
      openStart: number;
      openEnd: number;
    };
  };
  segments: {
    chapterId: string;
    from: number;
    to: number;
    documentHash: string;
  }[];
  lost: { evidence: EditorialAnchor["original"] }[];
}
interface EditorialData {
  generation: number;
  anchors: EditorialAnchor[];
  annotations: {
    id: string;
    anchorId: string;
    threadId: string;
    kind: "comment" | "note" | "highlight";
    colour: "yellow" | "blue" | "green" | "pink" | null;
    deletedAt: string | null;
  }[];
  threads: {
    id: string;
    state: "open" | "resolved";
    deletedAt: string | null;
    comments: { id: string; body: string; deletedAt: string | null }[];
  }[];
}
interface EditorialSidebarProps {
  editor: TipTapEditor;
  projectId: string;
  chapterId: string;
  flushManuscript(): Promise<boolean>;
  onDirtyChange?(dirty: boolean): void;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function plainText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown };
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content)
    ? node.content.map(plainText).join("")
    : "";
}

async function documentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

export function EditorialSidebar({
  editor,
  projectId,
  chapterId,
  flushManuscript,
  onDirtyChange,
}: EditorialSidebarProps) {
  const [data, setData] = useState<EditorialData | null>(null);
  const [kind, setKind] = useState<"comment" | "note" | "highlight">("comment");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [editingComment, setEditingComment] = useState<{
    id: string;
    body: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [kindFilter, setKindFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("open");
  const [anchorFilter, setAnchorFilter] = useState("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const dirty =
    busy ||
    body.length > 0 ||
    editingComment !== null ||
    Object.values(reply).some((value) => value.length > 0);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.drelwick?.project?.editorial;
      if (!api)
        throw new Error("Local annotations are unavailable in this project.");
      const result = await api({ operation: "get", projectId, chapterId });
      if (!result.ok) {
        setMigrationRequired(result.error.code === "EDITORIAL_UNAVAILABLE");
        throw new Error(result.error.message);
      }
      setMigrationRequired(false);
      const next = result.value as EditorialData;
      setData(next);
      setError(null);
      const currentHash = await documentHash(editor.getJSON());
      const annotations = new Map(
        next.annotations.map((annotation) => [annotation.anchorId, annotation]),
      );
      setEditorialDecorations(
        editor,
        next.anchors.flatMap((anchor) => {
          const annotation = annotations.get(anchor.id);
          const segment = anchor.segments.find(
            (item) =>
              item.chapterId === chapterId && item.documentHash === currentHash,
          );
          return annotation &&
            !annotation.deletedAt &&
            segment &&
            (anchor.status === "attached" || anchor.status === "partial")
            ? [
                {
                  ...segment,
                  annotationId: annotation.id,
                  kind: annotation.kind,
                  colour: annotation.colour,
                },
              ]
            : [];
        }),
      );
    } catch (cause) {
      setData(null);
      setError(
        cause instanceof Error ? cause.message : "Unable to load annotations.",
      );
      setEditorialDecorations(editor, []);
    } finally {
      setLoading(false);
    }
  }, [chapterId, editor, projectId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const markStale = () => {
      setData((current) =>
        current
          ? {
              ...current,
              anchors: current.anchors.map((anchor) =>
                anchor.segments.some(
                  (segment) => segment.chapterId === chapterId,
                )
                  ? { ...anchor, status: "unverified" }
                  : anchor,
              ),
            }
          : current,
      );
      setStatus(
        "Manuscript text changed. Refresh or explicitly reattach before navigating.",
      );
    };
    editor.on("update", markStale);
    return () => {
      editor.off("update", markStale);
    };
  }, [chapterId, editor]);

  const perform = useCallback(
    async (action: Parameters<typeof window.drelwick.project.editorial>[0]) => {
      setBusy(true);
      setError(null);
      try {
        const api = window.drelwick?.project?.editorial;
        if (!api)
          throw new Error("Local annotations are unavailable in this project.");
        const result = await api(action);
        if (!result.ok) throw new Error(result.error.message);
        await refresh();
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to save the annotation.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const selectEvidence = useCallback(() => {
    const selection = editor.state.selection;
    if (selection.empty) throw new Error("Select manuscript text first.");
    const slice = selection.content().toJSON() as {
      content?: Record<string, unknown>[];
      openStart?: number;
      openEnd?: number;
    };
    return {
      from: selection.from,
      to: selection.to,
      evidence: {
        slice: {
          content: slice.content ?? [],
          openStart: slice.openStart ?? 0,
          openEnd: slice.openEnd ?? 0,
        },
        prefix: editor.state.doc
          .textBetween(
            Math.max(0, selection.from - 64),
            selection.from,
            " ",
            " ",
          )
          .slice(-64),
        suffix: editor.state.doc
          .textBetween(
            selection.to,
            Math.min(editor.state.doc.content.size, selection.to + 64),
            " ",
            " ",
          )
          .slice(0, 64),
      },
    };
  }, [editor]);

  const add = async () => {
    try {
      const selected = selectEvidence();
      if (!(await flushManuscript()))
        throw new Error("Save the chapter before adding an annotation.");
      const ok = await perform({
        operation: "create",
        projectId,
        chapterId,
        ...selected,
        kind,
        body: body || undefined,
        evidence: selected.evidence,
      });
      if (ok) {
        setBody("");
        setStatus("Annotation saved.");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create annotation.",
      );
    }
  };

  const attachedAnchor = useMemo(
    () => (anchorId: string) =>
      data?.anchors.find((item) => item.id === anchorId),
    [data],
  );
  const navigate = async (anchor: EditorialAnchor) => {
    const segment = anchor.segments.find(
      (item) => item.chapterId === chapterId,
    );
    if (
      !segment ||
      (anchor.status !== "attached" && anchor.status !== "partial")
    )
      return;
    if ((await documentHash(editor.getJSON())) !== segment.documentHash) {
      setError(
        "This location changed. Save or reattach the annotation before navigating.",
      );
      return;
    }
    editor.commands.setTextSelection({ from: segment.from, to: segment.to });
    editor.commands.scrollIntoView();
    editor.commands.focus();
  };

  const reattach = async (anchorId: string) => {
    try {
      const selected = selectEvidence();
      if (!(await flushManuscript()))
        throw new Error("Save the chapter before reattaching.");
      if (
        await perform({
          operation: "reattach",
          projectId,
          anchorId,
          chapterId,
          from: selected.from,
          to: selected.to,
        })
      )
        setStatus(
          "Annotation reattached. Its original evidence remains in the thread.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to reattach annotation.",
      );
    }
  };

  return (
    <aside className="editorial-sidebar" aria-label="Comments and annotations">
      <h3>Comments &amp; annotations</h3>
      {loading && <p role="status">Loading annotations…</p>}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {dirty && <p role="status">Annotation changes are unsaved.</p>}
      {dirty && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Discard unsaved comment, note and reply text in this sidebar?",
              )
            ) {
              setBody("");
              setReply({});
              setEditingComment(null);
            }
          }}
        >
          Discard annotation drafts
        </button>
      )}
      {migrationRequired && (
        <section aria-label="Enable local annotations">
          <p>
            This project needs a format upgrade before local annotations can be
            used. Drelwick will create and verify a complete backup first.
          </p>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => {
              if (
                window.confirm(
                  "Upgrade this project for local comments and annotations? A verified backup will be created before project files are changed.",
                )
              )
                void perform({ operation: "migrate", projectId });
            }}
          >
            Upgrade project for annotations
          </button>
        </section>
      )}
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={loading || busy}
      >
        Refresh annotations
      </button>
      <fieldset disabled={busy || loading || migrationRequired}>
        <legend>Add to selected text</legend>
        <label>
          Type
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="comment">Comment</option>
            <option value="note">Private note</option>
            <option value="highlight">Highlight</option>
          </select>
        </label>
        {kind !== "highlight" && (
          <label>
            Comment or note
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={100_000}
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || (kind !== "highlight" && !body.trim())}
        >
          Add annotation
        </button>
      </fieldset>
      {!loading &&
        data &&
        data.annotations.filter((item) => !item.deletedAt).length === 0 && (
          <p>No annotations in this chapter yet.</p>
        )}
      <fieldset>
        <legend>Filter annotations</legend>
        <label>
          Annotation type
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value)}
          >
            <option value="all">All types</option>
            <option value="comment">Comments</option>
            <option value="note">Private notes</option>
            <option value="highlight">Highlights</option>
          </select>
        </label>
        <label>
          Discussion state
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
          >
            <option value="all">All states</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        <label>
          Attachment state
          <select
            value={anchorFilter}
            onChange={(event) => setAnchorFilter(event.target.value)}
          >
            <option value="all">All attachments</option>
            <option value="attached">Attached</option>
            <option value="partial">Partial</option>
            <option value="orphaned">Orphaned</option>
            <option value="unverified">Unverified</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
          />
          Show deleted annotations
        </label>
      </fieldset>
      <ul className="editorial-list">
        {data?.annotations
          .filter((item) => showDeleted || !item.deletedAt)
          .map((annotation) => {
            const anchor = attachedAnchor(annotation.anchorId);
            const thread = data.threads.find(
              (item) => item.id === annotation.threadId,
            );
            if (
              !anchor ||
              !thread ||
              (!showDeleted && thread.deletedAt) ||
              (kindFilter !== "all" && annotation.kind !== kindFilter) ||
              (stateFilter !== "all" && thread.state !== stateFilter) ||
              (anchorFilter !== "all" && anchor.status !== anchorFilter)
            )
              return null;
            if (annotation.deletedAt || thread.deletedAt)
              return (
                <li key={annotation.id}>
                  <article aria-label="Deleted annotation">
                    <h4>Deleted {annotation.kind}</h4>
                    <p>
                      {anchor.original.slice.content.map(plainText).join("")}
                    </p>
                    {thread.comments.map((comment) => (
                      <p key={comment.id}>{comment.body}</p>
                    ))}
                  </article>
                </li>
              );
            const segment = anchor.segments.find(
              (item) => item.chapterId === chapterId,
            );
            return (
              <li key={annotation.id}>
                <article aria-label={`${annotation.kind}, ${thread.state}`}>
                  <h4>
                    {annotation.kind === "note"
                      ? "Private note"
                      : annotation.kind[0]!.toUpperCase() +
                        annotation.kind.slice(1)}{" "}
                    <span>{anchor.status}</span>
                  </h4>
                  {anchor.original.slice.content.length > 0 && (
                    <blockquote>
                      {anchor.original.slice.content.map(plainText).join("")}
                    </blockquote>
                  )}
                  {anchor.lost.length > 0 && (
                    <section aria-label="Retained lost text">
                      <h5>Text no longer attached</h5>
                      {anchor.lost.map((item, index) => (
                        <blockquote key={index}>
                          {item.evidence.slice.content.map(plainText).join("")}
                        </blockquote>
                      ))}
                    </section>
                  )}
                  {thread.comments
                    .filter((comment) => !comment.deletedAt)
                    .map((comment) => (
                      <div key={comment.id}>
                        {editingComment?.id === comment.id ? (
                          <>
                            <label>
                              Edit comment
                              <textarea
                                autoFocus
                                maxLength={100_000}
                                value={editingComment.body}
                                onChange={(event) =>
                                  setEditingComment({
                                    id: comment.id,
                                    body: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  await perform({
                                    operation: "update-comment",
                                    projectId,
                                    threadId: thread.id,
                                    commentId: comment.id,
                                    body: editingComment.body,
                                  })
                                )
                                  setEditingComment(null);
                              }}
                            >
                              Save comment
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setEditingComment(null)}
                            >
                              Cancel edit
                            </button>
                          </>
                        ) : (
                          <>
                            <p>{comment.body}</p>
                            <button
                              type="button"
                              disabled={busy || editingComment !== null}
                              onClick={() =>
                                setEditingComment({
                                  id: comment.id,
                                  body: comment.body,
                                })
                              }
                            >
                              Edit comment
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void perform({
                                  operation: "update-comment",
                                  projectId,
                                  threadId: thread.id,
                                  commentId: comment.id,
                                  body: null,
                                })
                              }
                            >
                              Delete comment
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  {segment && anchor.status !== "unverified" && (
                    <button type="button" onClick={() => void navigate(anchor)}>
                      Go to text
                    </button>
                  )}
                  {(!segment ||
                    anchor.status === "orphaned" ||
                    anchor.status === "unverified") && (
                    <button
                      type="button"
                      onClick={() => void reattach(anchor.id)}
                      disabled={busy}
                    >
                      Reattach to selected text
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void perform({
                        operation: "resolve",
                        projectId,
                        threadId: thread.id,
                        resolved: thread.state !== "resolved",
                      })
                    }
                    disabled={busy}
                  >
                    {thread.state === "resolved" ? "Reopen" : "Resolve"}
                  </button>
                  <label>
                    Reply
                    <textarea
                      value={reply[thread.id] ?? ""}
                      onChange={(event) =>
                        setReply((current) => ({
                          ...current,
                          [thread.id]: event.target.value,
                        }))
                      }
                      maxLength={100_000}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      const value = reply[thread.id]?.trim();
                      if (!value) return;
                      if (
                        await perform({
                          operation: "reply",
                          projectId,
                          threadId: thread.id,
                          body: value,
                        })
                      )
                        setReply((current) => ({
                          ...current,
                          [thread.id]: "",
                        }));
                    }}
                    disabled={busy || !reply[thread.id]?.trim()}
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void perform({
                        operation: "delete",
                        projectId,
                        annotationId: annotation.id,
                      })
                    }
                    disabled={busy}
                  >
                    Delete annotation
                  </button>
                </article>
              </li>
            );
          })}
      </ul>
    </aside>
  );
}
