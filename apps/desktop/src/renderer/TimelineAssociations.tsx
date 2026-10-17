import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ReferenceEdge,
  ReferenceInput,
  ReferenceRecord,
  ReferenceSummary,
  ReferenceTarget,
} from "@drelwick/shared";

interface Props {
  projectId: string;
  execute: typeof window.drelwick.references.execute;
  record: ReferenceRecord | null;
  links: ReferenceInput["links"];
  chapters: { id: string; title: string }[];
  disabled: boolean;
  onChange(links: ReferenceInput["links"]): void;
  flush(): Promise<boolean>;
  onNavigateChapter(id: string): Promise<void>;
}

/** Labels and resolution are derived; only stable targets are saved. */
export function TimelineAssociations({
  projectId,
  execute,
  record,
  links,
  chapters,
  disabled,
  onChange,
  flush,
  onNavigateChapter,
}: Props) {
  const [records, setRecords] = useState<ReferenceSummary[]>([]);
  const [edges, setEdges] = useState<ReferenceEdge[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ReferenceRecord | null>(null);
  const [selection, setSelection] = useState("");
  const request = useRef({ generation: 0 });
  const opener = useRef<HTMLButtonElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const id = record?.id;
  const revision = record?.revision;
  const refresh = useCallback(async () => {
    const generation = ++request.current.generation;
    setLoading(true);
    setError("");
    try {
      const list = await execute({
        operation: "list",
        projectId,
        includeDeleted: true,
      });
      const resolution = id
        ? await execute({
            operation: "links",
            projectId,
            target: { kind: "timeline", id },
          })
        : null;
      if (generation !== request.current.generation) return;
      if (
        !list.ok ||
        list.value.type !== "list" ||
        (resolution && (!resolution.ok || resolution.value.type !== "links"))
      ) {
        setError(
          "Unable to refresh associations. Existing links are retained; retry refreshing.",
        );
        return;
      }
      setRecords(list.value.records);
      setEdges(
        resolution?.ok && resolution.value.type === "links"
          ? resolution.value.outgoing
          : [],
      );
      if (
        list.value.diagnostics.length ||
        (resolution?.ok &&
          resolution.value.type === "links" &&
          resolution.value.diagnostics.length)
      )
        setError(
          "Some reference files need review. Association information may be incomplete; saved links are retained.",
        );
    } catch {
      if (generation === request.current.generation)
        setError(
          "Unable to refresh associations. Existing links are retained; retry refreshing.",
        );
    } finally {
      if (generation === request.current.generation) setLoading(false);
    }
  }, [projectId, id, execute]);
  useEffect(() => {
    const pending = request.current;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      pending.generation++;
    };
  }, [refresh, revision]);
  useEffect(() => {
    if (detail) detailHeading.current?.focus();
  }, [detail]);

  const choices = [
    ...chapters.map((chapter) => ({ ...chapter, kind: "chapter" as const })),
    ...records.filter(
      (entry) =>
        (entry.kind === "character" || entry.kind === "location") &&
        entry.deletedAt === null,
    ),
  ];
  const key = (target: ReferenceTarget) =>
    `${target.kind}:${target.id.toLowerCase()}`;
  const available = choices.filter(
    (target) => !links.some((link) => key(link.target) === key(target)),
  );
  const label = (target: ReferenceTarget) =>
    choices.find((choice) => key(choice) === key(target))?.title ??
    records.find((entry) => key(entry) === key(target))?.title ??
    target.id;

  async function open(target: ReferenceTarget, button: HTMLButtonElement) {
    if (!(await flush())) return;
    setError("");
    try {
      if (target.kind === "chapter") {
        await onNavigateChapter(target.id);
        return;
      }
      const result = await execute({
        operation: "read",
        projectId,
        kind: target.kind,
        id: target.id,
      });
      if (
        !result.ok ||
        result.value.type !== "record" ||
        result.value.value.record.deletedAt !== null
      ) {
        setError(
          "This target is no longer available. Refresh associations to review its status; the event link is retained.",
        );
        return;
      }
      opener.current = button;
      setDetail(result.value.value.record);
    } catch {
      setError(
        "Unable to open the associated record. The event link is retained.",
      );
    }
  }

  return (
    <section aria-label="Event associations" aria-busy={loading}>
      <h4>Associations</h4>
      <button type="button" disabled={loading} onClick={() => void refresh()}>
        Refresh associations
      </button>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={disabled || loading}>
        <legend>Associate an existing record</legend>
        <label htmlFor="timeline-association">
          Chapter, character or location
        </label>
        <select
          id="timeline-association"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">Choose a record</option>
          {(["chapter", "character", "location"] as const).map((kind) => (
            <optgroup key={kind} label={kind}>
              {available
                .filter((entry) => entry.kind === kind)
                .map((entry) => (
                  <option key={key(entry)} value={key(entry)}>
                    {entry.title} ({entry.id})
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          disabled={!available.some((entry) => key(entry) === selection)}
          onClick={() => {
            const target = available.find((entry) => key(entry) === selection);
            if (target)
              onChange([
                ...links,
                { target: { kind: target.kind, id: target.id } },
              ]);
            setSelection("");
          }}
        >
          Add association
        </button>
      </fieldset>
      <ul>
        {links.map((link) => {
          const edge = edges.find(
            (entry) =>
              entry.link.id === link.id &&
              key(entry.link.target) === key(link.target),
          );
          const status =
            edge?.status ?? (link.id ? "not checked" : "pending save");
          return (
            <li key={key(link.target)}>
              <span>
                {link.target.kind}: {label(link.target)} — {status}
              </span>{" "}
              <button
                type="button"
                disabled={
                  disabled ||
                  loading ||
                  (status !== "resolved" && status !== "pending save")
                }
                onClick={(event) => void open(link.target, event.currentTarget)}
              >
                Open {label(link.target)}
              </button>{" "}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove association to ${label(link.target)}`}
                onClick={() =>
                  onChange(links.filter((entry) => entry !== link))
                }
              >
                Remove association
              </button>
            </li>
          );
        })}
      </ul>
      {detail && (
        <section aria-label="Associated record">
          <h4 ref={detailHeading} tabIndex={-1}>
            {"name" in detail ? detail.name : detail.title}
          </h4>
          <p>
            {detail.kind} · Read-only record · {detail.id}
          </p>
          <dl>
            {Object.entries(detail)
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
            onClick={() => {
              setDetail(null);
              opener.current?.focus();
            }}
          >
            Back to event
          </button>
        </section>
      )}
    </section>
  );
}
