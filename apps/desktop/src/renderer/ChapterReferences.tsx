import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
} from "react";
import type {
  ReferenceEdge,
  ReferenceSaved,
  ReferenceSummary,
} from "@drelwick/shared";

export interface ChapterReferencesHandle {
  isBusy(): boolean;
}

export interface ChapterReferencesProps {
  ref?: Ref<ChapterReferencesHandle>;
  projectId: string;
  chapterId: string | null;
  chapters: { id: string; title: string }[];
  execute: typeof window.drelwick.references.execute;
  disabled: boolean;
  flush(): Promise<boolean>;
  navigate(id: string): Promise<void>;
}

/** One authoritative edge on the reference record supplies both navigation views. */
export function ChapterReferences({
  ref,
  projectId,
  chapterId,
  chapters,
  execute,
  disabled,
  flush,
  navigate,
}: ChapterReferencesProps) {
  const [records, setRecords] = useState<ReferenceSummary[]>([]);
  const [incoming, setIncoming] = useState<ReferenceEdge[]>([]);
  const [outgoing, setOutgoing] = useState<ReferenceEdge[]>([]);
  const [detail, setDetail] = useState<ReferenceSaved | null>(null);
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const generation = useRef({ value: 0 });
  const working = useRef(false);
  useImperativeHandle(ref, () => ({ isBusy: () => working.current || busy }));
  const heading = useRef<HTMLHeadingElement>(null);
  const chooser = useRef<HTMLSelectElement>(null);
  const detailId = detail?.record.id;
  const detailKind = detail?.record.kind;
  const refresh = useCallback(async () => {
    const current = ++generation.current.value;
    setBusy(true);
    setReadOnly(true);
    setError("");
    try {
      const list = await execute({
        operation: "list",
        projectId,
        includeDeleted: true,
      });
      const links = chapterId
        ? await execute({
            operation: "links",
            projectId,
            target: { kind: "chapter", id: chapterId },
            includeDeleted: true,
          })
        : null;
      const record =
        detailId && detailKind
          ? await execute({
              operation: "read",
              projectId,
              kind: detailKind,
              id: detailId,
            })
          : null;
      const related =
        detailId && detailKind
          ? await execute({
              operation: "links",
              projectId,
              target: { kind: detailKind, id: detailId },
              includeDeleted: true,
            })
          : null;
      if (current !== generation.current.value) return;
      if (
        !list.ok ||
        list.value.type !== "list" ||
        (links && (!links.ok || links.value.type !== "links")) ||
        (record && (!record.ok || record.value.type !== "record")) ||
        (related && (!related.ok || related.value.type !== "links"))
      ) {
        throw new Error("Unavailable");
      }
      setRecords(list.value.records);
      setIncoming(
        links?.ok && links.value.type === "links" ? links.value.incoming : [],
      );
      if (record?.ok && record.value.type === "record")
        setDetail(record.value.value);
      setOutgoing(
        related?.ok && related.value.type === "links"
          ? related.value.outgoing.filter(
              (edge) => edge.link.target.kind === "chapter",
            )
          : [],
      );
      const incomplete =
        list.value.readOnly ||
        list.value.diagnostics.length > 0 ||
        (links?.ok &&
          links.value.type === "links" &&
          links.value.diagnostics.length > 0) ||
        (related?.ok &&
          related.value.type === "links" &&
          related.value.diagnostics.length > 0);
      setReadOnly(Boolean(incomplete));
      if (incomplete)
        setError(
          "Some reference files need review. Links may be incomplete; saved links are retained and changes are disabled.",
        );
    } catch {
      if (current === generation.current.value)
        setError(
          "Unable to refresh chapter links. Saved links are retained. Retry refreshing before making changes.",
        );
    } finally {
      if (current === generation.current.value) setBusy(false);
    }
  }, [chapterId, detailId, detailKind, execute, projectId]);
  useEffect(() => {
    const request = generation.current;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      request.value++;
    };
  }, [refresh, chapters]);
  useEffect(() => {
    if (detailId) heading.current?.focus();
  }, [detailId]);

  async function open(id: string) {
    if (working.current || busy || disabled) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await flush())) {
        setError(
          "Save failed. Your current edits remain open. Retry saving or cancel linked navigation by continuing to edit.",
        );
        return;
      }
      const summary = records.find((record) => record.id === id);
      if (!summary) return;
      const result = await execute({
        operation: "read",
        projectId,
        kind: summary.kind,
        id,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.value.type !== "record") throw new Error("Unavailable");
      const related = await execute({
        operation: "links",
        projectId,
        target: { kind: summary.kind, id },
        includeDeleted: true,
      });
      if (!related.ok || related.value.type !== "links")
        throw new Error("Unavailable");
      setDetail(result.value.value);
      setOutgoing(
        related.value.outgoing.filter(
          (edge) => edge.link.target.kind === "chapter",
        ),
      );
      setStatus("");
    } catch {
      setError(
        "Unable to open this reference. Your chapter and links are unchanged.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function change(
    operation: "link-attach" | "link-remove" | "link-retarget",
    linkId?: string,
  ) {
    if (!detail || busy || disabled || readOnly || working.current) return;
    if (operation !== "link-remove" && !chapterId) return;
    working.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!(await flush())) {
        setError(
          "Save current edits before changing chapter links. Your edits and links are retained.",
        );
        return;
      }
      const base = {
        projectId,
        kind: detail.record.kind,
        id: detail.record.id,
        expectedRevision: detail.record.revision,
        expectedFingerprint: detail.fingerprint,
        generation: detail.record.revision + 1,
      };
      const result = await execute(
        operation === "link-attach"
          ? { ...base, operation, chapterId: chapterId! }
          : operation === "link-remove"
            ? { ...base, operation, linkId: linkId! }
            : { ...base, operation, chapterId: chapterId!, linkId: linkId! },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.value.type !== "record") throw new Error("Unavailable");
      setDetail(result.value.value);
      await refresh();
      setStatus(result.value.warning ?? "Chapter links saved.");
      heading.current?.focus();
    } catch {
      setError(
        "Unable to save chapter links. Refresh to review the saved state; previous valid data and recovery copies are retained.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function openChapter(id: string) {
    if (busy || disabled || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (await flush())
        await navigate(
          chapters.find(
            (chapter) => chapter.id.toLowerCase() === id.toLowerCase(),
          )?.id ?? id,
        );
      else
        setError(
          "Save failed. Your current edits remain open. Retry saving or continue editing to cancel navigation.",
        );
    } catch {
      setError(
        "Unable to open the linked chapter. Your current edits remain available.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const title = (id: string) =>
    records.find((record) => record.id === id)?.title ?? id;
  const chapterTitle = (id: string) =>
    chapters.find((chapter) => chapter.id.toLowerCase() === id.toLowerCase())
      ?.title ?? id;
  const attached = outgoing.some(
    (edge) => edge.link.target.id.toLowerCase() === chapterId?.toLowerCase(),
  );
  const locked = busy || disabled;
  return (
    <section aria-label="Chapter references" aria-busy={busy}>
      <h3>Chapter references</h3>
      <p>
        Explicit Story Bible links. Reference details are read-only here; use
        the Story Bible editors to change them.
      </p>
      <button type="button" disabled={locked} onClick={() => void refresh()}>
        Refresh chapter links
      </button>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <h4>References linked to this chapter</h4>
      {!incoming.length && <p>No linked references.</p>}
      <ul>
        {incoming.map((edge) => {
          const source = records.find((record) => record.id === edge.sourceId);
          return (
            <li key={edge.link.id}>
              {source?.kind ?? edge.sourceKind}: {title(edge.sourceId)}
              {source?.deletedAt
                ? "  -  deleted reference (link retained)"
                : ""}
              <button
                type="button"
                disabled={locked || !source}
                onClick={() => void open(edge.sourceId)}
              >
                Open {title(edge.sourceId)}
              </button>
            </li>
          );
        })}
      </ul>
      <label htmlFor="chapter-reference-picker">Story Bible record</label>
      <select
        ref={chooser}
        id="chapter-reference-picker"
        value={selection}
        disabled={locked}
        onChange={(event) => setSelection(event.target.value)}
      >
        <option value="">Choose a reference</option>
        {records.map((record) => (
          <option key={record.id} value={record.id}>
            {record.kind}: {record.title} ({record.id})
            {record.deletedAt ? "  -  deleted" : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={locked || !selection}
        onClick={() => void open(selection)}
      >
        View reference and linked chapters
      </button>
      {detail && (
        <section aria-label="Linked reference details">
          <h4 ref={heading} tabIndex={-1}>
            {"name" in detail.record ? detail.record.name : detail.record.title}
          </h4>
          <p>
            {detail.record.kind} - {detail.record.id}
            {detail.record.deletedAt
              ? "  -  Deleted reference; restore it in its Story Bible editor before changing links."
              : ""}
          </p>
          <dl>
            {Object.entries(detail.record)
              .filter(
                ([field]) =>
                  ![
                    "schemaVersion",
                    "kind",
                    "id",
                    "projectId",
                    "created",
                    "modified",
                    "revision",
                    "deletedAt",
                    "links",
                    "name",
                    "title",
                  ].includes(field),
              )
              .map(([field, value]) => (
                <div key={field}>
                  <dt>{field}</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>
                    {Array.isArray(value)
                      ? value.join(", ")
                      : String(value ?? "")}
                  </dd>
                </div>
              ))}
          </dl>
          <button
            type="button"
            disabled={
              locked ||
              readOnly ||
              !!detail.record.deletedAt ||
              !chapterId ||
              attached
            }
            onClick={() => void change("link-attach")}
          >
            Attach current chapter
          </button>
          <h4>Linked chapters</h4>
          {!outgoing.length && <p>No linked chapters.</p>}
          <ul>
            {outgoing.map((edge) => (
              <li key={edge.link.id}>
                {chapterTitle(edge.link.target.id)} - {edge.status}
                <button
                  type="button"
                  disabled={locked || edge.status !== "resolved"}
                  onClick={() => void openChapter(edge.link.target.id)}
                >
                  Open chapter {chapterTitle(edge.link.target.id)}
                </button>
                <button
                  type="button"
                  disabled={locked || readOnly || !!detail.record.deletedAt}
                  aria-label={`Remove chapter link to ${chapterTitle(edge.link.target.id)}`}
                  onClick={() => void change("link-remove", edge.link.id)}
                >
                  Remove chapter link
                </button>
                {edge.status !== "resolved" && (
                  <button
                    type="button"
                    disabled={
                      locked ||
                      readOnly ||
                      !!detail.record.deletedAt ||
                      !chapterId ||
                      attached
                    }
                    onClick={() => {
                      if (
                        window.confirm(
                          "Retarget this unresolved link to the current chapter?",
                        )
                      )
                        void change("link-retarget", edge.link.id);
                    }}
                  >
                    Retarget to current chapter
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              setDetail(null);
              setOutgoing([]);
              chooser.current?.focus();
            }}
          >
            Back to chapter links
          </button>
        </section>
      )}
    </section>
  );
}
