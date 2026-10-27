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
import { compareTimelineEvents } from "@drelwick/core/timeline";
import { TimelineAssociations } from "./TimelineAssociations.js";
import { ReferenceInputSchema } from "@drelwick/project-model";
import type {
  ReferenceInput,
  ReferenceRecord,
  ReferenceSaved,
  ReferenceSummary,
} from "@drelwick/shared";

type Timeline = Extract<ReferenceRecord, { kind: "timeline" }>;
type Draft = {
  title: string;
  date: string;
  sequence: string;
  links: ReferenceInput["links"];
  description: string;
  notes: string;
  tags: string[];
};
const empty = (): Draft => ({
  title: "",
  date: "",
  sequence: "",
  links: [],
  description: "",
  notes: "",
  tags: [],
});
const toDraft = (record: Timeline): Draft => ({
  title: record.title,
  date: record.date ?? "",
  sequence: record.sequence?.toString() ?? "",
  links: record.links,
  description: record.description ?? "",
  notes: record.notes ?? "",
  tags: [...record.tags],
});

export interface TimelineEditorHandle {
  isDirty(): boolean;
  flush(): Promise<boolean>;
}
export interface TimelineManagerProps {
  onEdited?(): void;
  projectId: string;
  execute?: typeof window.drelwick.references.execute;
  ref?: Ref<TimelineEditorHandle>;
  disabled?: boolean;
  chapters: { id: string; title: string }[];
  onNavigateChapter: (id: string) => Promise<void>;
}

export function TimelineManager(props: TimelineManagerProps) {
  return <TimelineEditor key={props.projectId} {...props} />;
}

function TimelineEditor({
  onEdited,
  projectId,
  ref,
  disabled = false,
  execute = window.drelwick.references.execute,
  chapters,
  onNavigateChapter,
}: TimelineManagerProps) {
  const initial = () => ({
    records: [] as ReferenceSummary[],
    record: null as Timeline | null,
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
    if (saved.record.kind !== "timeline")
      throw new Error("Unexpected reference response");
    s.record = saved.record;
    s.fingerprint = saved.fingerprint;
    s.draft = toDraft(saved.record);
    s.baseline = JSON.stringify(s.draft);
  };
  const content = (): ReferenceInput => {
    const s = state.current;
    return {
      kind: "timeline",
      title: s.draft.title,
      date: s.draft.date === "" ? undefined : s.draft.date,
      sequence:
        s.draft.sequence === ""
          ? undefined
          : /^-?\d+$/.test(s.draft.sequence)
            ? Number(s.draft.sequence)
            : NaN,
      description: s.draft.description,
      notes: s.draft.notes,
      tags: [...s.draft.tags],
      links: s.draft.links,
    };
  };

  async function save(): Promise<boolean> {
    const s = state.current;
    if (!dirty()) return true;
    if (s.loading || s.readOnly) return false;
    const captured = JSON.stringify(s.draft);
    const input = content();
    if (!ReferenceInputSchema.safeParse(input).success) {
      s.error =
        "Check the event fields: title and optional date must be nonblank when supplied (up to 500 characters), notes and description up to 100,000 characters, and tags unique and nonblank (up to 100 tags of 100 characters). Sequence must be a safe integer or empty. Invalid Unicode and NUL are not allowed.";
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
              kind: "timeline",
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
        result.value.value.record.kind !== "timeline"
      ) {
        s.error =
          "Unable to confirm the timeline save. Your edits remain available.";
        return false;
      }
      const saved = result.value.value;
      s.record = saved.record as Timeline;
      s.fingerprint = saved.fingerprint;
      // Acknowledge only the captured form; later keystrokes remain dirty.
      // Core assigns new edge IDs. Reconcile those IDs into both the captured
      // baseline and any newer draft without acknowledging later keystrokes.
      const capturedDraft = JSON.parse(captured) as Draft;
      const reconcile = (links: Draft["links"]) =>
        links.map((link) => {
          if (link.id) return link;
          return (
            saved.record.links.find(
              (edge) =>
                edge.target.kind === link.target.kind &&
                edge.target.id === link.target.id,
            ) ?? link
          );
        });
      s.draft = { ...s.draft, links: reconcile(s.draft.links) };
      s.baseline = JSON.stringify({
        ...capturedDraft,
        links: reconcile(capturedDraft.links),
      });
      const summary: ReferenceSummary = {
        id: s.record.id,
        kind: "timeline",
        title: s.record.title,
        revision: s.record.revision,
        deletedAt: s.record.deletedAt,
        sequence: s.record.sequence,
      };
      s.records = [
        ...s.records.filter((entry) => entry.id !== summary.id),
        summary,
      ];
      s.status = result.value.warning ?? "Timeline saved.";
      return true;
    } catch {
      s.error =
        "Unable to save the timeline. Your edits remain available; retry saving.";
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
      kind: "timeline",
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
    s.status = "Timeline loaded.";
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
      s.records = result.value.records.filter(
        (entry) => entry.kind === "timeline",
      );
      if (result.value.diagnostics.length || s.readOnly)
        s.error =
          "Some story bible files need review. Available timeline events can be read; changes are disabled while the store is read-only.";
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
        "Unable to load timeline events. Retry loading; your project files are unchanged.";
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
        s.status = "New timeline.";
      }
      focusTitle();
    } catch {
      s.error =
        "Unable to open the timeline. Your current edits remain available.";
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
          ? "Restore this timeline?"
          : "Delete this timeline? Its saved content will remain available under Deleted timeline events.",
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
        kind: "timeline",
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
        ? "Timeline restored."
        : "Timeline deleted. Select it under Deleted timeline events to restore it.";
    } catch {
      s.error =
        "Unable to change the timeline. Retry after reviewing its saved state.";
    } finally {
      s.navigating = false;
      notify();
    }
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    const s = state.current;
    s.draft = { ...s.draft, [key]: value };
    s.generation++;
    onEdited?.();
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
  }, [projectId]);

  const orderedRecords = [...view.records].sort(compareTimelineEvents);
  const locked = disabled || view.loading || view.navigating;
  const deleted = view.record?.deletedAt != null;
  return (
    <section
      className="story-bible-panel"
      aria-labelledby="timeline-bible-heading"
      aria-busy={view.loading || view.saving || view.navigating}
    >
      <div className="tool-intro">
        <span className="section-label">STORY BIBLE</span>
        <h3 id="timeline-bible-heading">Timeline</h3>
        <p>
          Order local events by sequence; unsequenced events come last. Ties use
          stable IDs. Dates are free text and never change order.
        </p>
      </div>
      <div className="story-bible-toolbar">
        <label htmlFor="timeline-record">Timeline</label>
        <select
          id="timeline-record"
          value={view.record?.id ?? ""}
          disabled={locked || view.saving}
          onChange={(event) => void navigate(event.target.value || null)}
        >
          <option value="">New timeline</option>
          <optgroup label="Timeline events">
            {orderedRecords
              .filter((r) => r.deletedAt === null)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
          </optgroup>
          <optgroup label="Deleted timeline events">
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
      {view.loading && <p role="status">Loading timeline events…</p>}
      {!view.loading && view.readOnly && (
        <p>
          Timeline events are read-only until story bible loading or recovery
          problems are resolved.
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
        <p>No timeline events yet. Create the first one below.</p>
      )}
      {!view.loading && (
        <TimelineAssociations
          key={view.record?.id ?? "new"}
          projectId={projectId}
          execute={execute}
          record={view.record}
          links={view.draft.links}
          chapters={chapters}
          disabled={locked || view.saving || view.readOnly || deleted}
          onChange={(links) => update("links", links)}
          flush={flush}
          onNavigateChapter={onNavigateChapter}
        />
      )}
      <form
        aria-label={view.record ? "Edit timeline" : "New timeline"}
        onSubmit={(event) => {
          event.preventDefault();
          void flush();
        }}
      >
        <fieldset disabled={locked || view.readOnly || deleted}>
          <legend>Timeline details</legend>
          <label htmlFor="timeline-title">Title</label>
          <input
            ref={titleInput}
            id="timeline-title"
            autoComplete="off"
            value={view.draft.title}
            onChange={(event) => update("title", event.target.value)}
          />
          <label htmlFor="timeline-date">Date (optional, free text)</label>
          <input
            id="timeline-date"
            value={view.draft.date}
            onChange={(event) => update("date", event.target.value)}
          />
          <label htmlFor="timeline-sequence">Sequence (optional integer)</label>
          <input
            id="timeline-sequence"
            inputMode="numeric"
            value={view.draft.sequence}
            onChange={(event) => update("sequence", event.target.value)}
          />
          <label htmlFor="timeline-description">Description</label>
          <textarea
            id="timeline-description"
            rows={4}
            value={view.draft.description}
            onChange={(event) => update("description", event.target.value)}
          />
          <label htmlFor="timeline-notes">Notes</label>
          <textarea
            id="timeline-notes"
            rows={4}
            value={view.draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
          <fieldset>
            <legend>Tags</legend>
            {view.draft.tags.map((tag, index) => (
              <div key={index}>
                <label htmlFor={`timeline-tag-${index}`}>Tag {index + 1}</label>
                <textarea
                  id={`timeline-tag-${index}`}
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
            {view.saving ? "Saving…" : "Save event"}
          </button>
        </fieldset>
        {view.record && (
          <button
            type="button"
            disabled={locked || view.saving || view.readOnly}
            onClick={() => void removeOrRestore()}
          >
            {deleted ? "Restore event" : "Delete"}
          </button>
        )}
        {JSON.stringify(view.draft) !== view.baseline && (
          <button
            type="button"
            disabled={locked || view.saving}
            onClick={() => {
              if (window.confirm("Discard unsaved timeline changes?"))
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
