import { EditorialHistoryStep } from "@drelwick/core/editorial-history";
import { closeHistory } from "@tiptap/pm/history";
import type {
  ProjectWorkspace,
  EditorialExpectedFiles,
} from "@drelwick/shared";
import type { Editor as TipTapEditor } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { setEditorialDecorations } from "./components/EditorialDecorations.js";

interface EditorialAnchor {
  id: string;
  status: "attached" | "partial" | "orphaned" | "unverified";
  original: {
    chapterId: string;
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
  chapters?: { id: string; title: string }[];
  documentIdentity?: { storedHash: string; editorHash: string };
  expectedFiles?: EditorialExpectedFiles;
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
  projectOnly?: boolean;
  refreshKey?: number;
  projectId: string;
  chapterId: string;
  flushManuscript(): Promise<boolean>;
  onDirtyChange?(dirty: boolean): void;
  onBusyChange?(busy: boolean): void;
  onRecovered?(workspace: ProjectWorkspace): void;
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
  projectOnly = false,
  refreshKey,
  projectId,
  chapterId,
  flushManuscript,
  onDirtyChange,
  onBusyChange,
  onRecovered,
}: EditorialSidebarProps) {
  const sidebar = useRef<HTMLElement>(null);
  const refreshGeneration = useRef(0);
  const pendingCommand = useRef<{
    key: string;
    request: Parameters<typeof window.drelwick.project.editorial>[0];
    body: string;
    reply: Record<string, string>;
    editing: { id: string; body: string } | null;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [drafts, setDrafts] = useState<
    { draftId: string; baseGeneration: number; editorGeneration: number }[]
  >([]);
  const [invalidDrafts, setInvalidDrafts] = useState(false);
  const [draftPreview, setDraftPreview] = useState<{
    draftId: string;
    operationId: string;
    chapters: { title: string; text: string }[];
    comments: string[];
  } | null>(null);
  const [data, setData] = useState<EditorialData | null>(null);
  const [kind, setKind] = useState<"comment" | "note" | "highlight">("comment");
  const [colour, setColour] = useState<"yellow" | "blue" | "green" | "pink">(
    "yellow",
  );
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
  const [hasSelection, setHasSelection] = useState(
    !editor.state.selection.empty,
  );
  useEffect(() => {
    const report = () => setHasSelection(!editor.state.selection.empty);
    editor.on("selectionUpdate", report);
    return () => {
      editor.off("selectionUpdate", report);
    };
  }, [editor]);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [kindFilter, setKindFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("open");
  const [anchorFilter, setAnchorFilter] = useState("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const dirty =
    busy ||
    uncertain ||
    body.length > 0 ||
    editingComment !== null ||
    Object.values(reply).some((value) => value.length > 0);
  useLayoutEffect(() => {
    onBusyChange?.(busy || uncertain);
    return () => onBusyChange?.(false);
  }, [busy, uncertain, onBusyChange]);
  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useLayoutEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const api = window.drelwick?.project?.editorial;
      if (!api)
        throw new Error("Local annotations are unavailable in this project.");
      const read = async (request: Parameters<typeof api>[0]) => {
        for (let attempt = 0; ; attempt++) {
          const result = await api(request);
          if (
            result.ok ||
            result.error.code !== "PROJECT_BUSY" ||
            attempt === 5
          )
            return result;
          await new Promise((resolve) => window.setTimeout(resolve, 50));
          if (generation !== refreshGeneration.current || editor.isDestroyed)
            return result;
        }
      };
      const result = await read(
        projectOnly
          ? { operation: "get-project", projectId }
          : { operation: "get", projectId, chapterId },
      );
      if (!result.ok) {
        setMigrationRequired(result.error.code === "EDITORIAL_UNAVAILABLE");
        if (result.error.code === "EDITORIAL_UNAVAILABLE") {
          setData(null);
          setError(null);
          setEditorialDecorations(editor, []);
          return;
        }
        throw new Error(result.error.message);
      }
      if (generation !== refreshGeneration.current || editor.isDestroyed)
        return;
      setMigrationRequired(false);
      const next = result.value as EditorialData;
      const offers = await read({ operation: "drafts", projectId });
      if (
        offers.ok &&
        offers.value &&
        typeof offers.value === "object" &&
        "candidates" in offers.value
      ) {
        setDrafts(
          (
            offers.value as {
              candidates: {
                draftId: string;
                baseGeneration: number;
                editorGeneration: number;
              }[];
            }
          ).candidates,
        );
        setInvalidDrafts(
          "diagnostics" in offers.value &&
            Array.isArray(offers.value.diagnostics) &&
            offers.value.diagnostics.length > 0,
        );
      }
      if (generation !== refreshGeneration.current || editor.isDestroyed)
        return;
      const captured = editor.getJSON();
      const currentHash = await documentHash(captured);
      if (
        generation !== refreshGeneration.current ||
        editor.isDestroyed ||
        canonical(captured) !== canonical(editor.getJSON())
      )
        return;
      setData(next);
      setError(null);
      const verifiedHash =
        next.documentIdentity?.editorHash === currentHash
          ? next.documentIdentity.storedHash
          : currentHash;
      const annotations = new Map(
        next.annotations.map((annotation) => [annotation.anchorId, annotation]),
      );
      setEditorialDecorations(
        editor,
        next.anchors.flatMap((anchor) => {
          const annotation = annotations.get(anchor.id);
          if (
            !annotation ||
            annotation.deletedAt ||
            (anchor.status !== "attached" && anchor.status !== "partial")
          )
            return [];
          return anchor.segments
            .filter(
              (item) =>
                item.chapterId === chapterId &&
                item.documentHash === verifiedHash,
            )
            .map((segment) => ({
              ...segment,
              annotationId: annotation.id,
              kind: annotation.kind,
              colour: annotation.colour,
            }));
        }),
      );
    } catch (cause) {
      if (generation !== refreshGeneration.current || editor.isDestroyed)
        return;
      setData(null);
      setError(
        cause instanceof Error ? cause.message : "Unable to load annotations.",
      );
      setEditorialDecorations(editor, []);
    } finally {
      setLoading(false);
    }
  }, [chapterId, editor, projectId, projectOnly]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh, refreshKey]);
  useEffect(() => {
    const markStale = () => {
      refreshGeneration.current++;
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
        const focused = document.activeElement;
        let request = action;
        const commandKey = JSON.stringify(action);
        if (pendingCommand.current) {
          if (pendingCommand.current.key !== commandKey)
            throw new Error(
              "Retry the interrupted annotation save before starting another change.",
            );
          request = pendingCommand.current.request;
        } else if (
          [
            "change-colour",
            "create",
            "update-comment",
            "reply",
            "resolve",
            "delete",
            "reattach",
            "restore-annotation",
          ].includes(action.operation)
        ) {
          if (!(await flushManuscript()))
            throw new Error(
              "Save manuscript edits before changing a discussion.",
            );
          let captured = data;
          if (
            action.operation === "create" ||
            action.operation === "reattach"
          ) {
            const latest = await api({
              operation: "get",
              projectId,
              chapterId,
            });
            if (!latest.ok) throw new Error(latest.error.message);
            captured = latest.value as EditorialData;
          }
          if (!captured)
            throw new Error(
              "Refresh annotations before changing a discussion.",
            );
          request = {
            ...action,
            operationId: crypto.randomUUID(),
            expectedGeneration: captured.generation,
            expectedFiles: captured.expectedFiles,
          } as typeof action;
        }
        const mutating =
          "operationId" in request &&
          request.operationId !== undefined &&
          "expectedGeneration" in request;
        if (mutating && !pendingCommand.current)
          pendingCommand.current = {
            key: commandKey,
            request,
            body,
            reply: structuredClone(reply),
            editing: editingComment ? { ...editingComment } : null,
          };
        const result = await api(request);
        if (!result.ok) {
          if (
            ([
              "EDITORIAL_STALE",
              "PROJECT_BUSY",
              "EDITORIAL_INPUT_INVALID",
              "EDITORIAL_INVALID",
              "EDITORIAL_LIMIT",
              "EDITORIAL_UNSUPPORTED",
              "PROJECT_SCHEMA_INVALID",
              "PROJECT_ORDER_INVALID",
              "PROJECT_FILE_MISSING",
              "EDITORIAL_RANGE_INVALID",
              "EDITORIAL_EVIDENCE_STALE",
              "EDITORIAL_NOT_FOUND",
              "CHAPTER_NOT_FOUND",
              "EDITORIAL_COMMENT_REQUIRED",
            ].includes(result.error.code) &&
              !uncertain) ||
            result.error.code === "EDITORIAL_NOT_COMMITTED"
          ) {
            pendingCommand.current = null;
            setUncertain(false);
            if (result.error.code === "EDITORIAL_NOT_COMMITTED")
              await refresh();
          } else if (mutating) setUncertain(true);
          throw new Error(result.error.message);
        }
        pendingCommand.current = null;
        setUncertain(false);
        const value = result.value as { historyEventId?: unknown } | null;
        if (!projectOnly && value && typeof value.historyEventId === "string")
          editor.view.dispatch(
            closeHistory(editor.state.tr).step(
              new EditorialHistoryStep(value.historyEventId, "recorded"),
            ),
          );
        await refresh();
        window.requestAnimationFrame(() => {
          const target =
            focused instanceof HTMLElement &&
            focused.isConnected &&
            !focused.hasAttribute("disabled")
              ? focused
              : sidebar.current?.querySelector<HTMLElement>(
                  "button:not(:disabled)",
                );
          target?.focus();
        });
        return true;
      } catch (cause) {
        if (pendingCommand.current) setUncertain(true);
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
    [
      refresh,
      data,
      projectId,
      chapterId,
      body,
      reply,
      editingComment,
      uncertain,
      flushManuscript,
      projectOnly,
      editor,
    ],
  );

  const selectEvidence = useCallback(() => {
    const selection = editor.state.selection;
    if (selection.empty) throw new Error("Select manuscript text first.");
    const slice = editor.state.doc
      .slice(selection.from, selection.to)
      .toJSON() as {
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
        prefix: [
          ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(
            editor.state.doc.textBetween(0, selection.from, " ", " "),
          ),
        ]
          .slice(-32)
          .map((part) => part.segment)
          .join(""),
        suffix: [
          ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(
            editor.state.doc.textBetween(
              selection.to,
              editor.state.doc.content.size,
              " ",
              " ",
            ),
          ),
        ]
          .slice(0, 32)
          .map((part) => part.segment)
          .join(""),
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
        ...(kind === "highlight" ? { colour } : {}),
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
    const expectedHash =
      data?.documentIdentity?.storedHash === segment.documentHash
        ? data.documentIdentity.editorHash
        : segment.documentHash;
    if ((await documentHash(editor.getJSON())) !== expectedHash) {
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

  const previewDraft = async (draftId: string) => {
    setBusy(true);
    try {
      const result = await window.drelwick.project.editorial({
        operation: "preview-draft",
        projectId,
        draftId,
      });
      if (!result.ok) throw new Error(result.error.message);
      const candidate = result.value as {
        files: { path: string; document: Record<string, unknown> }[];
      };
      const chapters = candidate.files
        .filter((file) => file.path.startsWith("manuscript/"))
        .map((file) => ({
          title: String(file.document["title"] ?? "Chapter"),
          text: plainText(file.document["content"]),
        }));
      const editorial = candidate.files.find(
        (file) => file.path === "editorial/state.json",
      )?.document;
      const threads = (editorial?.["threads"] ?? []) as {
        comments: { body: string }[];
      }[];
      setDraftPreview({
        draftId,
        operationId: crypto.randomUUID(),
        chapters,
        comments: threads.flatMap((thread) =>
          thread.comments.map((comment) => comment.body),
        ),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to preview the draft.",
      );
    } finally {
      setBusy(false);
    }
  };
  const recoverDraft = async () => {
    if (!draftPreview || !onRecovered || dirty) return;
    if (
      !window.confirm(
        "Recover this complete manuscript and annotation draft? Recovery requires its original saved version; divergent work will be preserved and recovery refused.",
      )
    )
      return;
    const wasEditable = editor.isEditable;
    setBusy(true);
    editor.setEditable(false, false);
    try {
      if (!(await flushManuscript()))
        throw new Error(
          "Save current manuscript edits before recovering a draft.",
        );
      const result = await window.drelwick.project.editorial({
        operation: "recover-draft",
        projectId,
        draftId: draftPreview.draftId,
        operationId: draftPreview.operationId,
      });
      if (!result.ok) throw new Error(result.error.message);
      setDrafts((current) =>
        current.filter((item) => item.draftId !== draftPreview.draftId),
      );
      setDraftPreview(null);
      onRecovered((result.value as { workspace: ProjectWorkspace }).workspace);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to recover the draft. Current work is preserved.",
      );
    } finally {
      if (!editor.isDestroyed) editor.setEditable(wasEditable, false);
      setBusy(false);
    }
  };

  return (
    <aside
      ref={sidebar}
      className="editorial-sidebar"
      aria-label="Comments and annotations"
    >
      <h3>Comments &amp; annotations</h3>
      {projectOnly && (
        <p>
          Create a chapter to attach or reattach retained discussions to
          manuscript text.
        </p>
      )}
      {loading && <p role="status">Loading annotations…</p>}
      {error && <p role="alert">{error}</p>}
      {invalidDrafts && (
        <p role="alert">
          Some retained drafts could not be verified. Their files are preserved;
          keep a project backup before investigating recovery.
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {drafts.length > 0 && (
        <section aria-label="Recoverable editorial drafts">
          <h4>Recoverable drafts</h4>
          <p>
            A previous save was interrupted. Preview a draft before choosing
            recovery or discard.
          </p>
          {drafts.map((draft) => (
            <button
              key={draft.draftId}
              type="button"
              disabled={busy || loading}
              onClick={() => void previewDraft(draft.draftId)}
            >
              Preview draft from saved version {draft.baseGeneration}
            </button>
          ))}
        </section>
      )}
      {draftPreview && (
        <section aria-label="Draft preview">
          <h4>Draft preview</h4>
          {draftPreview.chapters.map((chapter, index) => (
            <article key={index}>
              <h5>{chapter.title}</h5>
              <p style={{ whiteSpace: "pre-wrap" }}>{chapter.text}</p>
            </article>
          ))}
          {draftPreview.comments.map((comment, index) => (
            <blockquote key={index}>{comment}</blockquote>
          ))}
          <button
            type="button"
            disabled={busy || dirty || !onRecovered}
            onClick={() => void recoverDraft()}
          >
            Recover draft
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={async () => {
              if (
                !window.confirm(
                  "Discard this draft recovery offer? Its retained safety files will remain available.",
                )
              )
                return;
              if (
                await perform({
                  operation: "discard-draft",
                  projectId,
                  draftId: draftPreview.draftId,
                })
              )
                setDraftPreview(null);
            }}
          >
            Discard recoverable draft
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => setDraftPreview(null)}
          >
            Cancel draft preview
          </button>
        </section>
      )}
      {uncertain && (
        <p role="status">
          Resolve the interrupted annotation save before editing manuscript
          text.
        </p>
      )}
      {uncertain && (
        <button
          type="button"
          disabled={busy || loading}
          onClick={async () => {
            const pending = pendingCommand.current;
            if (
              !pending ||
              !(await perform(
                JSON.parse(pending.key) as Parameters<
                  typeof window.drelwick.project.editorial
                >[0],
              ))
            )
              return;
            const action = pending.request;
            if (action.operation === "create")
              setBody((current) => (current === pending.body ? "" : current));
            if (action.operation === "reply")
              setReply((current) =>
                current[action.threadId] === pending.reply[action.threadId]
                  ? { ...current, [action.threadId]: "" }
                  : current,
              );
            if (action.operation === "update-comment")
              setEditingComment((current) =>
                JSON.stringify(current) === JSON.stringify(pending.editing)
                  ? null
                  : current,
              );
          }}
        >
          Retry interrupted annotation save
        </button>
      )}
      {dirty && <p role="status">Annotation changes are unsaved.</p>}
      {dirty && (
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => {
            if (uncertain) {
              setError(
                "Retry the interrupted annotation save to establish its outcome before discarding drafts.",
              );
              return;
            }
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
      <fieldset disabled={busy || loading || migrationRequired || projectOnly}>
        <legend>Add to selected text</legend>
        <p role="status">
          {hasSelection
            ? "Text selected for annotation."
            : "Select manuscript text to add an annotation."}
        </p>
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
        {kind === "highlight" && (
          <label>
            Highlight colour
            <select
              value={colour}
              onChange={(event) =>
                setColour(event.target.value as typeof colour)
              }
            >
              {(["yellow", "blue", "green", "pink"] as const).map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "highlight" && (
          <label>
            Comment or note
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={200_000}
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
            aria-label="Discussion state"
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
                    <p>
                      Chapter:{" "}
                      {data.chapters?.find(
                        (item) => item.id === anchor.original.chapterId,
                      )?.title ?? "Deleted or unavailable chapter"}
                    </p>
                    <h4>Deleted {annotation.kind}</h4>
                    <p>
                      {anchor.original.slice.content.map(plainText).join("")}
                    </p>
                    {thread.comments.map((comment) => (
                      <p key={comment.id}>{comment.body}</p>
                    ))}
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() =>
                        void perform({
                          operation: "restore-annotation",
                          projectId,
                          annotationId: annotation.id,
                        })
                      }
                    >
                      Restore annotation
                    </button>
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
                  <p>
                    Chapter:{" "}
                    {[
                      ...new Set(
                        anchor.segments.length
                          ? anchor.segments.map((item) => item.chapterId)
                          : [anchor.original.chapterId],
                      ),
                    ]
                      .map(
                        (id) =>
                          data.chapters?.find((item) => item.id === id)
                            ?.title ?? "Deleted or unavailable chapter",
                      )
                      .join(", ")}
                  </p>
                  {annotation.kind === "highlight" && (
                    <label>
                      Highlight colour
                      <select
                        disabled={busy || loading}
                        value={annotation.colour ?? "yellow"}
                        onChange={(event) =>
                          void perform({
                            operation: "change-colour",
                            projectId,
                            annotationId: annotation.id,
                            colour: event.target.value as typeof colour,
                          })
                        }
                      >
                        {(["yellow", "blue", "green", "pink"] as const).map(
                          (value) => (
                            <option key={value} value={value}>
                              {value.charAt(0).toUpperCase() + value.slice(1)}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
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
                                maxLength={200_000}
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
                              disabled={busy || loading}
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
                                  setEditingComment((current) =>
                                    current?.id === editingComment.id &&
                                    current.body === editingComment.body
                                      ? null
                                      : current,
                                  );
                              }}
                            >
                              Save comment
                            </button>
                            <button
                              type="button"
                              disabled={busy || loading}
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
                              disabled={busy || loading}
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
                      disabled={busy || projectOnly}
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
                    disabled={busy || loading}
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
                      maxLength={200_000}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      const value = reply[thread.id];
                      if (!value?.trim()) return;
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
                          [thread.id]:
                            current[thread.id] === reply[thread.id]
                              ? ""
                              : (current[thread.id] ?? ""),
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
                    disabled={busy || loading}
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
