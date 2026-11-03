import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  CapturedComparisonSource,
  ComparisonAction,
  ComparisonV1,
  SnapshotSummary,
} from "@drelwick/shared";

async function invoke<T>(action: ComparisonAction): Promise<T> {
  const result = await window.drelwick.project.comparison(action);
  if (!result.ok) throw new Error(result.error.message);
  return result.value as T;
}
function excerpt(value: unknown): string {
  if (value === null) return "None";
  // Semantic JSON makes marks, list starts, atom attributes and link targets
  // inspectable as inert text, alongside the actual text in the slice.
  const text = JSON.stringify(value, null, 2);
  return text.length > 8000
    ? `${text.slice(0, 8000)}\n… Display excerpt; full change retained in memory.`
    : text;
}
function semanticContent(value: unknown) {
  let remaining = 8000,
    nodes = 500;
  const render = (item: unknown, key: number): ReactNode => {
    if (--nodes < 0 || remaining <= 0) return null;
    if (!item || typeof item !== "object") return null;
    const node = item as {
      type?: string;
      text?: string;
      content?: unknown[];
      attrs?: Record<string, unknown>;
      marks?: { type: string; attrs?: Record<string, unknown> }[];
    };
    if (node.type === "text") {
      const shown = (node.text ?? "").slice(0, remaining);
      remaining -= shown.length;
      let text: ReactNode = shown;
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = <strong>{text}</strong>;
        else if (mark.type === "italic") text = <em>{text}</em>;
        else if (mark.type === "underline") text = <u>{text}</u>;
        else if (mark.type === "strike") text = <s>{text}</s>;
        else if (mark.type === "code") text = <code>{text}</code>;
        else if (mark.type === "link")
          text = (
            <span>
              {text} [Link: {String(mark.attrs?.["href"] ?? "")}]
            </span>
          );
      }
      return <span key={key}>{text}</span>;
    }
    const children = (node.content ?? []).slice(0, 500).map(render);
    if (node.type === "hardBreak")
      return (
        <span key={key}>
          {" "}
          [Line break]
          <br />
        </span>
      );
    if (node.type === "sceneBreak" || node.type === "horizontalRule")
      return <p key={key}>[Scene break: {node.type}]</p>;
    if (node.type === "image")
      return (
        <p key={key}>
          [Image: {String(node.attrs?.["alt"] ?? "")} ·{" "}
          {String(node.attrs?.["size"] ?? "")} ·{" "}
          {String(node.attrs?.["assetId"] ?? "")}]
        </p>
      );
    if (node.type === "paragraph") return <p key={key}>{children}</p>;
    if (node.type === "heading")
      return (
        <p key={key}>
          <strong>
            Heading {String(node.attrs?.["level"])}: {children}
          </strong>
        </p>
      );
    if (node.type === "blockquote" || node.type === "epigraph")
      return (
        <blockquote key={key}>
          {children}
          {node.attrs?.["attribution"] ? (
            <p>—{String(node.attrs["attribution"])}</p>
          ) : null}
        </blockquote>
      );
    if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
    if (node.type === "orderedList")
      return (
        <ol key={key} start={Number(node.attrs?.["start"] ?? 1)}>
          {children}
        </ol>
      );
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    if (node.type === "codeBlock") return <pre key={key}>{children}</pre>;
    return <div key={key}>{children}</div>;
  };
  if (!value || typeof value !== "object") return <p>None</p>;
  const record = value as {
    type?: string;
    value?: { content?: unknown[]; document?: unknown };
  };
  if (record.type === "slice")
    return (
      <div>
        {(record.value?.content ?? []).slice(0, 500).map(render)}
        {(remaining <= 0 || nodes <= 0) && (
          <p>
            Display excerpt. Use chapter and change navigation to inspect other
            changes.
          </p>
        )}
      </div>
    );
  if (record.value?.document)
    return <div>{render(record.value.document, 0)}</div>;
  return <pre>{excerpt(record.value)}</pre>;
}
export function ManuscriptComparison({
  projectId,
  snapshots,
  flush,
}: {
  projectId: string;
  snapshots: SnapshotSummary[];
  flush(): Promise<boolean>;
}) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState("current");
  const [leftProjection, setLeftProjection] = useState<"accepted" | "proposed">(
      "proposed",
    ),
    [rightProjection, setRightProjection] = useState<"accepted" | "proposed">(
      "proposed",
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<ComparisonV1 | null>(null),
    [stale, setStale] = useState(false);
  const [chapterId, setChapterId] = useState("all"),
    [ordinal, setOrdinal] = useState(0);
  const generation = useRef(0),
    requestId = useRef<string | null>(null),
    captured = useRef<CapturedComparisonSource[]>([]);
  const mounted = useRef(true),
    view = useRef<HTMLElement>(null);
  const release = async () => {
    const inputs = captured.current.splice(0);
    await Promise.all(
      inputs.map((input) =>
        invoke({ operation: "release", projectId, token: input.token }).catch(
          () => undefined,
        ),
      ),
    );
  };
  const cancel = async () => {
    generation.current++;
    if (requestId.current)
      await invoke({
        operation: "cancel",
        projectId,
        requestId: requestId.current,
      }).catch(() => undefined);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Cleanup intentionally invalidates the latest query, not the mount-time value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      if (requestId.current)
        void window.drelwick.project.comparison({
          operation: "cancel",
          projectId,
          requestId: requestId.current,
        });
      // Release the live token list, including captures completed after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const input of captured.current.splice(0))
        void window.drelwick.project.comparison({
          operation: "release",
          projectId,
          token: input.token,
        });
    };
  }, [projectId]);
  useEffect(() => {
    if (!result) return;
    let disposed = false,
      checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const inputs = captured.current.filter(
          (input) => input.source.kind === "captured-current",
        );
        for (const input of inputs) {
          const status = await invoke<{ stale: boolean }>({
            operation: "status",
            projectId,
            token: input.token,
          });
          if (!disposed && status.stale) setStale(true);
        }
      } catch {
        if (!disposed) setStale(true);
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), 5000);
    window.addEventListener("focus", check);
    void check();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [projectId, result]);
  const compare = async () => {
    if (busy) return;
    const query = ++generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    setStale(false);
    try {
      await release();
      if ((left === "current" || right === "current") && !(await flush()))
        throw new Error(
          "Pending edits could not be saved. Comparison cancelled; drafts were retained.",
        );
      if (query !== generation.current) return;
      for (const [selection, projection] of [
        [left, leftProjection],
        [right, rightProjection],
      ] as const) {
        const snapshot = snapshots.find(
          (item) => item.snapshotId === selection,
        );
        if (selection !== "current" && !snapshot)
          throw new Error("Select an available snapshot for each side.");
        const input = await invoke<CapturedComparisonSource>({
          operation: "capture",
          projectId,
          source: snapshot
            ? {
                kind: "snapshot",
                snapshotId: snapshot.snapshotId,
                manifestHash: snapshot.manifestHash,
                projection,
              }
            : { kind: "captured-current", projection },
        });
        if (!mounted.current || query !== generation.current) {
          await invoke({ operation: "release", projectId, token: input.token });
          return;
        }
        captured.current.push(input);
      }
      const id = crypto.randomUUID();
      requestId.current = id;
      const value = await invoke<ComparisonV1>({
        operation: "compare",
        projectId,
        requestId: id,
        left: captured.current[0]!.token,
        right: captured.current[1]!.token,
      });
      if (mounted.current && query === generation.current) {
        setResult(value);
        setChapterId("all");
        setOrdinal(0);
      }
    } catch (cause) {
      if (mounted.current && query === generation.current)
        setError(
          cause instanceof Error ? cause.message : "Comparison unavailable.",
        );
    } finally {
      requestId.current = null;
      if (query !== generation.current || !mounted.current) await release();
      if (mounted.current) setBusy(false);
    }
  };
  const changes =
    result?.changes.filter(
      (change) =>
        chapterId === "all" ||
        (chapterId === "metadata"
          ? change.chapterId === null
          : change.chapterId === chapterId),
    ) ?? [];
  const index = Math.max(
      0,
      changes.findIndex((change) => change.ordinal === ordinal),
    ),
    change = changes[index];
  const navigate = (next: number) => {
    setOrdinal(changes[next]!.ordinal);
    view.current?.focus();
  };
  return (
    <section
      className="manuscript-comparison"
      aria-labelledby="manuscript-comparison-title"
    >
      <h3 id="manuscript-comparison-title">Compare manuscript revisions</h3>
      <p>
        Read-only comparison of saved versions. Current manuscript capture saves
        pending edits first. Choose accepted or proposed text explicitly;
        comparison cannot apply changes.
      </p>
      <fieldset className="comparison-sources" disabled={busy}>
        <legend>Comparison sources</legend>
        {(["left", "right"] as const).map((side) => (
          <div key={side}>
            <label>
              {side === "left" ? "Before version" : "After version"}
              <select
                aria-label={
                  side === "left" ? "Before version" : "After version"
                }
                value={side === "left" ? left : right}
                onChange={(event) => {
                  (side === "left" ? setLeft : setRight)(event.target.value);
                  setResult(null);
                  void release();
                }}
              >
                <option value="">Choose a snapshot</option>
                <option value="current">Saved current manuscript</option>
                {snapshots
                  .filter((snapshot) => !snapshot.deleted)
                  .map((snapshot) => (
                    <option
                      key={snapshot.snapshotId}
                      value={snapshot.snapshotId}
                    >
                      {snapshot.label} · {snapshot.created} · generation{" "}
                      {snapshot.generation} · {snapshot.snapshotId}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {side === "left" ? "Before projection" : "After projection"}
              <select
                aria-label={
                  side === "left" ? "Before projection" : "After projection"
                }
                value={side === "left" ? leftProjection : rightProjection}
                onChange={(event) => {
                  (side === "left" ? setLeftProjection : setRightProjection)(
                    event.target.value as "accepted" | "proposed",
                  );
                  setResult(null);
                  void release();
                }}
              >
                <option value="accepted">Accepted text</option>
                <option value="proposed">Proposed text</option>
              </select>
            </label>
          </div>
        ))}
        <button
          type="button"
          disabled={!left || !right}
          onClick={() => void compare()}
        >
          Compare versions
        </button>
      </fieldset>
      {busy && (
        <>
          <p role="status">Comparing saved manuscript versions…</p>
          <button type="button" onClick={() => void cancel()}>
            Cancel comparison
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p role="status">
            {result.complete
              ? `${result.changes.length} changes. Comparison complete.`
              : "Comparison incomplete. Unavailable chapters must not be treated as unchanged."}
          </p>
          {stale && (
            <p role="status">
              The current manuscript changed or is unavailable. This comparison
              is stale; its captured versions remain unchanged. Compare again to
              refresh.
            </p>
          )}
          <dl>
            {(["left", "right"] as const).map((side) => (
              <div key={side}>
                <dt>{side === "left" ? "Before" : "After"}</dt>
                <dd>
                  {result[side].label} · {result[side].created} · generation{" "}
                  {result[side].generation} · {result[side].projection} ·{" "}
                  {result[side].id}
                </dd>
              </div>
            ))}
          </dl>
          {result.diagnostics.length > 0 && (
            <ul aria-label="Comparison diagnostics">
              {result.diagnostics.map((diagnostic, i) => (
                <li key={i}>
                  {diagnostic.source}: {diagnostic.code} ·{" "}
                  {diagnostic.chapterId ?? "Manuscript"}{" "}
                  {diagnostic.assetId ?? ""}
                </li>
              ))}
            </ul>
          )}
          <label>
            Comparison chapter
            <select
              aria-label="Comparison chapter"
              value={chapterId}
              onChange={(event) => {
                setChapterId(event.target.value);
                setOrdinal(0);
              }}
            >
              <option value="all">All chapters</option>
              <option value="metadata">Book metadata and assets</option>
              {result.chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </label>
          {change ? (
            <>
              <label>
                Comparison change
                <select
                  aria-label="Comparison change"
                  value={change.ordinal}
                  onChange={(event) => setOrdinal(Number(event.target.value))}
                >
                  {changes.map((item) => (
                    <option key={item.ordinal} value={item.ordinal}>
                      {item.ordinal + 1}: {item.kind} ·{" "}
                      {result.chapters.find(
                        (chapter) => chapter.id === item.chapterId,
                      )?.title ?? "Book metadata / assets"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => navigate(index - 1)}
              >
                Previous change
              </button>
              <button
                type="button"
                disabled={index === changes.length - 1}
                onClick={() => navigate(index + 1)}
              >
                Next change
              </button>
              <article
                ref={view}
                tabIndex={-1}
                aria-label="Selected comparison change"
              >
                <h4>
                  {change.ordinal + 1}: {change.kind}
                </h4>
                <p>
                  {result.chapters.find(
                    (chapter) => chapter.id === change.chapterId,
                  )?.title ?? "Book metadata / assets"}
                </p>
                <div className="comparison-sides">
                  <section aria-label="Before change">
                    <h5>Before</h5>
                    {semanticContent(change.before)}
                    <details>
                      <summary>Before semantic details</summary>
                      <p>{excerpt(change.oldLocation)}</p>
                      <pre>{excerpt(change.before)}</pre>
                    </details>
                  </section>
                  <section aria-label="After change">
                    <h5>After</h5>
                    {semanticContent(change.after)}
                    <details>
                      <summary>After semantic details</summary>
                      <p>{excerpt(change.newLocation)}</p>
                      <pre>{excerpt(change.after)}</pre>
                    </details>
                  </section>
                </div>
              </article>
            </>
          ) : (
            <p>
              {result.complete
                ? "No differences in the selected scope."
                : "No completed differences in this scope; check unavailable diagnostics."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
