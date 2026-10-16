import {
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
  type Ref,
} from "react";
import {
  createAutosaveCoordinator,
  type AutosaveCoordinator,
} from "@drelwick/core/autosave";
import { ReferenceInputSchema } from "@drelwick/project-model";
import type {
  ReferenceInput,
  ReferenceRecord,
  ReferenceSaved,
  ReferenceSummary,
} from "@drelwick/shared";

type Kind = "canon" | "note";
type Record = Extract<ReferenceRecord, { kind: Kind }>;
type Draft = {
  title: string;
  category: Extract<ReferenceInput, { kind: "canon" }>["category"];
  statement: string;
  notes: string;
  body: string;
  source: string;
  tags: string[];
};
const categories = [
  "character",
  "technology",
  "location",
  "history",
  "relationship",
  "terminology",
  "other",
] as const;
const empty = (): Draft => ({
  title: "",
  category: "other",
  statement: "",
  notes: "",
  body: "",
  source: "",
  tags: [],
});
const toDraft = (record: Record): Draft => ({
  ...empty(),
  title: record.title,
  tags: [...record.tags],
  ...(record.kind === "canon"
    ? {
        category: record.category,
        statement: record.statement,
        notes: record.notes ?? "",
      }
    : { body: record.body, source: record.source ?? "" }),
});

export interface CanonResearchEditorHandle {
  isDirty(): boolean;
  flush(): Promise<boolean>;
}
export interface CanonResearchManagerProps {
  projectId: string;
  kind: Kind;
  execute?: typeof window.drelwick.references.execute;
  ref?: Ref<CanonResearchEditorHandle>;
  disabled?: boolean;
}

export function CanonResearchManager(props: CanonResearchManagerProps) {
  return (
    <CanonResearchEditor key={`${props.projectId}:${props.kind}`} {...props} />
  );
}

function CanonResearchEditor({
  projectId,
  kind,
  execute = window.drelwick.references.execute,
  ref,
  disabled = false,
}: CanonResearchManagerProps) {
  const label = kind === "canon" ? "Canon record" : "Research note";
  const plural = kind === "canon" ? "Canon records" : "Research notes";
  const initial = () => ({
    records: [] as ReferenceSummary[],
    record: null as Record | null,
    fingerprint: "",
    draft: empty(),
    baseline: JSON.stringify(empty()),
    generation: 0,
    loading: true,
    saving: false,
    navigating: false,
    readOnly: true,
    error: "",
    status: "",
    alive: false,
    loadRequest: 0,
  });
  const state = useRef<ReturnType<typeof initial>>(initial());
  const [view, setView] = useState(initial);
  const coordinator = useRef<AutosaveCoordinator | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const dirty = () =>
    JSON.stringify(state.current.draft) !== state.current.baseline;
  const notify = () => {
    if (state.current.alive) setView({ ...state.current });
  };
  const focusRequested = useRef(false);
  const focusTitle = () => {
    focusRequested.current = true;
  };
  useEffect(() => {
    if (!view.navigating && focusRequested.current) {
      focusRequested.current = false;
      titleInput.current?.focus();
    }
  }, [view]);
  const accept = (saved: ReferenceSaved) => {
    const s = state.current;
    if (saved.record.kind !== kind)
      throw new Error("Unexpected reference response");
    s.record = saved.record;
    s.fingerprint = saved.fingerprint;
    s.draft = toDraft(saved.record);
    s.baseline = JSON.stringify(s.draft);
  };
  const content = (): ReferenceInput => {
    const s = state.current;
    const shared = {
      title: s.draft.title,
      tags: [...s.draft.tags],
      links: s.record?.links ?? [],
    };
    return kind === "canon"
      ? {
          ...shared,
          kind,
          category: s.draft.category,
          statement: s.draft.statement,
          notes: s.draft.notes,
        }
      : { ...shared, kind, body: s.draft.body, source: s.draft.source };
  };

  async function save(): Promise<boolean> {
    const s = state.current;
    if (!dirty()) return true;
    if (s.loading || s.readOnly) return false;
    const captured = JSON.stringify(s.draft);
    const input = content();
    if (!ReferenceInputSchema.safeParse(input).success) {
      s.error =
        "Check the fields: title must be nonblank (up to 500 characters), prose up to 100,000 characters, source up to 2,000 characters, and tags unique and nonblank (up to 100 tags of 100 characters). Select a listed canon category. Invalid Unicode and NUL are not allowed.";
      notify();
      return false;
    }
    s.saving = true;
    s.error = "";
    s.status = "Saving…";
    notify();
    try {
      const result = await execute(
        s.record
          ? {
              operation: "update",
              projectId,
              kind,
              id: s.record.id,
              expectedRevision: s.record.revision,
              expectedFingerprint: s.fingerprint,
              content: input,
              generation: s.generation,
            }
          : {
              operation: "create",
              projectId,
              content: input,
              generation: s.generation,
            },
      );
      if (!result.ok) {
        s.error = result.error.message;
        return false;
      }
      if (
        result.value.type !== "record" ||
        result.value.value.record.kind !== kind
      ) {
        s.error =
          "Unable to confirm the reference save. Your edits remain available.";
        return false;
      }
      const saved = result.value.value;
      s.record = saved.record as Record;
      s.fingerprint = saved.fingerprint;
      // Acknowledge only the captured form; later keystrokes remain dirty.
      s.baseline = captured;
      const summary: ReferenceSummary = {
        id: s.record.id,
        kind,
        title: s.record.title,
        revision: s.record.revision,
        deletedAt: s.record.deletedAt,
      };
      s.records = [
        ...s.records.filter((entry) => entry.id !== summary.id),
        summary,
      ];
      s.status = result.value.warning ?? "Record saved.";
      return true;
    } catch {
      s.error =
        "Unable to save the reference. Your edits remain available; retry saving.";
      return false;
    } finally {
      s.saving = false;
      notify();
    }
  }

  async function flush(): Promise<boolean> {
    const s = state.current;
    // A read-only initial load cannot lose edits and must not veto shutdown.
    if (s.loading) return !dirty() && !s.saving;
    if (s.navigating) return false;
    return (await coordinator.current?.flush()) ?? !dirty();
  }
  useImperativeHandle(ref, () => ({
    isDirty: () => dirty() || state.current.saving || state.current.navigating,
    flush,
  }));

  async function read(id: string, request = state.current.loadRequest) {
    const s = state.current;
    const result = await execute({
      operation: "read",
      projectId,
      kind,
      id,
    });
    if (!s.alive || request !== s.loadRequest) return;
    if (!result.ok) {
      s.error = result.error.message;
      return;
    }
    if (result.value.type !== "record")
      throw new Error("Unexpected reference response");
    accept(result.value.value);
    s.status = "Record loaded.";
  }
  async function load() {
    const s = state.current;
    const request = ++s.loadRequest;
    s.loading = true;
    s.readOnly = true;
    s.error = "";
    notify();
    try {
      const result = await execute({
        operation: "list",
        projectId,
        includeDeleted: true,
      });
      if (!s.alive || request !== s.loadRequest) return;
      if (!result.ok) {
        s.error = result.error.message;
        return;
      }
      if (result.value.type !== "list")
        throw new Error("Unexpected reference response");
      s.readOnly = result.value.readOnly;
      s.records = result.value.records.filter((entry) => entry.kind === kind);
      if (result.value.diagnostics.length || s.readOnly)
        s.error =
          "Some story bible files need review. Available references can be read; changes are disabled while the store is read-only.";
      const recovery = await execute({
        operation: "recovery-list",
        projectId,
      });
      if (!s.alive || request !== s.loadRequest) return;
      if (
        !recovery.ok ||
        recovery.value.type !== "recovery" ||
        recovery.value.diagnostics.length ||
        recovery.value.candidates.some(
          (candidate) =>
            candidate.status === "pending" || candidate.status === "invalid",
        )
      ) {
        s.readOnly = true;
        s.error =
          "Story bible recovery needs review before editing. Preserve the project files for recovery; manuscript editing remains available.";
      }
      const first = s.records.find((entry) => entry.deletedAt === null);
      if (first) await read(first.id, request);
    } catch {
      if (!s.alive || request !== s.loadRequest) return;
      s.readOnly = true;
      s.error =
        "Unable to load references. Retry loading; your project files are unchanged.";
    } finally {
      if (request === s.loadRequest) {
        s.loading = false;
        notify();
      }
    }
  }

  async function navigate(id: string | null, discard = false) {
    const s = state.current;
    if (s.loading || s.navigating || s.saving) return;
    if (dirty() && !discard && !(await flush())) return;
    s.navigating = true;
    s.error = "";
    notify();
    try {
      if (id) await read(id);
      else {
        s.record = null;
        s.fingerprint = "";
        s.draft = empty();
        s.baseline = JSON.stringify(s.draft);
        s.status = "New reference.";
      }
      focusTitle();
    } catch {
      s.error =
        "Unable to open the reference. Your current edits remain available.";
    } finally {
      s.navigating = false;
      notify();
    }
  }
  async function removeOrRestore() {
    const s = state.current;
    if (!s.record || s.loading || s.navigating || s.saving || s.readOnly)
      return;
    if (dirty() && !(await flush())) return;
    const restoring = s.record.deletedAt !== null;
    if (
      !window.confirm(
        restoring
          ? "Restore this reference?"
          : "Delete this reference? Its saved content will remain available under Deleted records.",
      )
    )
      return;
    s.navigating = true;
    s.error = "";
    notify();
    try {
      const result = await execute({
        operation: restoring ? "restore" : "delete",
        projectId,
        kind,
        id: s.record.id,
        expectedRevision: s.record.revision,
        expectedFingerprint: s.fingerprint,
        generation: ++s.generation,
      });
      if (!result.ok) {
        s.error = result.error.message;
        return;
      }
      if (result.value.type !== "record")
        throw new Error("Unexpected reference response");
      accept(result.value.value);
      s.records = s.records.map((entry) =>
        entry.id === s.record!.id
          ? {
              ...entry,
              revision: s.record!.revision,
              deletedAt: s.record!.deletedAt,
            }
          : entry,
      );
      s.status = restoring
        ? "Record restored."
        : "Record deleted. Select it under Deleted records to restore it.";
    } catch {
      s.error =
        "Unable to change the reference. Retry after reviewing its saved state.";
    } finally {
      s.navigating = false;
      notify();
    }
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    const s = state.current;
    s.draft = { ...s.draft, [key]: value };
    s.generation++;
    s.status = "";
    s.error = "";
    coordinator.current?.edited();
    notify();
  }

  useEffect(() => {
    const s = state.current;
    s.alive = true;
    const autosave = createAutosaveCoordinator({ isDirty: dirty, save });
    coordinator.current = autosave;
    const blur = () => {
      void autosave.flush();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty() && !s.saving && !s.navigating) return;
      event.preventDefault();
      event.returnValue = "";
      void autosave.flush();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("beforeunload", unload);
    void load();
    return () => {
      s.alive = false;
      s.loadRequest++;
      autosave.dispose();
      window.removeEventListener("blur", blur);
      window.removeEventListener("beforeunload", unload);
    };
    // The keyed editor owns one project and a stable mutable session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind]);

  const orderedRecords = [...view.records].sort((a, b) => {
    const left = [...a.title];
    const right = [...b.title];
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const difference =
        left[index]!.codePointAt(0)! - right[index]!.codePointAt(0)!;
      if (difference) return difference;
    }
    return (
      left.length - right.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  });
  const locked = disabled || view.loading || view.navigating;
  const deleted = view.record?.deletedAt != null;
  return (
    <section
      className="story-bible-panel"
      aria-labelledby={`${kind}-bible-heading`}
      aria-busy={view.loading || view.saving || view.navigating}
    >
      <div className="tool-intro">
        <span className="section-label">STORY BIBLE</span>
        <h3 id={`${kind}-bible-heading`}>{plural}</h3>
        <p>
          {kind === "canon"
            ? "Record the facts and rules of your story."
            : "Keep research, general notes, organisation and technology information here. Source citations are plain text."}
        </p>
      </div>
      <div className="story-bible-toolbar">
        <label htmlFor={`${kind}-record`}>{label}</label>
        <select
          id={`${kind}-record`}
          value={view.record?.id ?? ""}
          disabled={locked || view.saving}
          onChange={(event) => void navigate(event.target.value || null)}
        >
          <option value="">New {label.toLowerCase()}</option>
          <optgroup label={plural}>
            {orderedRecords
              .filter((r) => r.deletedAt === null)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
          </optgroup>
          <optgroup label="Deleted records">
            {orderedRecords
              .filter((r) => r.deletedAt !== null)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} (deleted)
                </option>
              ))}
          </optgroup>
        </select>
        <button
          type="button"
          disabled={locked || view.saving || view.readOnly}
          onClick={() => void navigate(null)}
        >
          New
        </button>
      </div>
      {view.loading && <p role="status">Loading references…</p>}
      {!view.loading && view.readOnly && (
        <p>
          Records are read-only until story bible loading or recovery problems
          are resolved.
        </p>
      )}
      {view.error && (
        <p className="error-message" role="alert">
          {view.error}
        </p>
      )}
      {view.error && !(JSON.stringify(view.draft) !== view.baseline) && (
        <button
          type="button"
          disabled={locked || view.saving}
          onClick={() => void load()}
        >
          Retry loading
        </button>
      )}
      {!view.loading && !view.records.length && !view.error && (
        <p>No records yet. Create the first one below.</p>
      )}
      <form
        aria-label={`${view.record ? "Edit" : "New"} ${label.toLowerCase()}`}
        onSubmit={(event) => {
          event.preventDefault();
          void flush();
        }}
      >
        <fieldset disabled={locked || view.readOnly || deleted}>
          <legend>{label} details</legend>
          <label htmlFor={`${kind}-title`}>Title</label>
          <input
            ref={titleInput}
            id={`${kind}-title`}
            autoComplete="off"
            value={view.draft.title}
            onChange={(event) => update("title", event.target.value)}
          />
          {kind === "canon" ? (
            <>
              <label htmlFor="canon-category">Category</label>
              <select
                id="canon-category"
                value={view.draft.category}
                onChange={(event) =>
                  update("category", event.target.value as Draft["category"])
                }
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <label htmlFor="canon-statement">Statement</label>
              <textarea
                id="canon-statement"
                rows={4}
                value={view.draft.statement}
                onChange={(event) => update("statement", event.target.value)}
              />
              <label htmlFor="canon-notes">Notes</label>
              <textarea
                id="canon-notes"
                rows={4}
                value={view.draft.notes}
                onChange={(event) => update("notes", event.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor="note-body">Body</label>
              <textarea
                id="note-body"
                rows={8}
                value={view.draft.body}
                onChange={(event) => update("body", event.target.value)}
              />
              <label htmlFor="note-source">Source (plain-text citation)</label>
              <textarea
                id="note-source"
                rows={2}
                value={view.draft.source}
                onChange={(event) => update("source", event.target.value)}
              />
            </>
          )}
          <fieldset>
            <legend>Tags</legend>
            {view.draft.tags.map((tag, index) => (
              <div key={index}>
                <label htmlFor={`${kind}-tag-${index}`}>Tag {index + 1}</label>
                <textarea
                  id={`${kind}-tag-${index}`}
                  rows={1}
                  value={tag}
                  onChange={(event) =>
                    update(
                      "tags",
                      view.draft.tags.map((value, i) =>
                        i === index ? event.target.value : value,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove tag ${index + 1}`}
                  onClick={() => {
                    update(
                      "tags",
                      view.draft.tags.filter((_, i) => i !== index),
                    );
                    focusTitle();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update("tags", [...view.draft.tags, ""])}
            >
              Add tag
            </button>
          </fieldset>
          <button
            className="primary-button"
            type="submit"
            disabled={
              view.saving || !(JSON.stringify(view.draft) !== view.baseline)
            }
          >
            {view.saving ? "Saving…" : `Save ${label.toLowerCase()}`}
          </button>
        </fieldset>
        {view.record && (
          <button
            type="button"
            disabled={locked || view.saving || view.readOnly}
            onClick={() => void removeOrRestore()}
          >
            {deleted ? `Restore ${label.toLowerCase()}` : "Delete"}
          </button>
        )}
        {JSON.stringify(view.draft) !== view.baseline && (
          <button
            type="button"
            disabled={locked || view.saving}
            onClick={() => {
              if (window.confirm("Discard unsaved reference changes?"))
                void navigate(view.record?.id ?? null, true);
            }}
          >
            Discard changes
          </button>
        )}
        <p role="status">
          {view.saving
            ? "Saving…"
            : JSON.stringify(view.draft) !== view.baseline
              ? "Unsaved changes"
              : view.status}
        </p>
      </form>
    </section>
  );
}
