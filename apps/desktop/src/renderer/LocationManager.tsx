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

type Location = Extract<ReferenceRecord, { kind: "location" }>;
type Draft = {
  name: string;
  type: string;
  description: string;
  notes: string;
  tags: string[];
};
const empty = (): Draft => ({
  name: "",
  type: "",
  description: "",
  notes: "",
  tags: [],
});
const toDraft = (record: Location): Draft => ({
  name: record.name,
  type: record.type ?? "",
  description: record.description ?? "",
  notes: record.notes ?? "",
  tags: [...record.tags],
});

export interface LocationEditorHandle {
  isDirty(): boolean;
  flush(): Promise<boolean>;
}
export interface LocationManagerProps {
  projectId: string;
  execute?: typeof window.drelwick.references.execute;
  ref?: Ref<LocationEditorHandle>;
  disabled?: boolean;
}

export function LocationManager(props: LocationManagerProps) {
  return <LocationEditor key={props.projectId} {...props} />;
}

function LocationEditor({
  projectId,
  ref,
  disabled = false,
  execute = window.drelwick.references.execute,
}: LocationManagerProps) {
  const initial = () => ({
    records: [] as ReferenceSummary[],
    record: null as Location | null,
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
  const nameInput = useRef<HTMLInputElement>(null);
  const dirty = () =>
    JSON.stringify(state.current.draft) !== state.current.baseline;
  const notify = () => {
    if (state.current.alive) setView({ ...state.current });
  };
  const focusRequested = useRef(false);
  const focusName = () => {
    focusRequested.current = true;
  };
  useEffect(() => {
    if (!view.navigating && focusRequested.current) {
      focusRequested.current = false;
      nameInput.current?.focus();
    }
  }, [view]);
  const accept = (saved: ReferenceSaved) => {
    const s = state.current;
    if (saved.record.kind !== "location")
      throw new Error("Unexpected reference response");
    s.record = saved.record;
    s.fingerprint = saved.fingerprint;
    s.draft = toDraft(saved.record);
    s.baseline = JSON.stringify(s.draft);
  };
  const content = (): ReferenceInput => {
    const s = state.current;
    return {
      kind: "location",
      name: s.draft.name,
      type: s.draft.type === "" ? undefined : s.draft.type,
      description: s.draft.description,
      notes: s.draft.notes,
      tags: [...s.draft.tags],
      links: s.record?.links ?? [],
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
        "Check the location fields: name and optional type must be nonblank when supplied (up to 500 characters), notes and description up to 100,000 characters, and tags unique and nonblank (up to 100 tags of 100 characters). Invalid Unicode and NUL are not allowed.";
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
              kind: "location",
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
        result.value.value.record.kind !== "location"
      ) {
        s.error =
          "Unable to confirm the location save. Your edits remain available.";
        return false;
      }
      const saved = result.value.value;
      s.record = saved.record as Location;
      s.fingerprint = saved.fingerprint;
      // Acknowledge only the captured form; later keystrokes remain dirty.
      s.baseline = captured;
      const summary: ReferenceSummary = {
        id: s.record.id,
        kind: "location",
        title: s.record.name,
        revision: s.record.revision,
        deletedAt: s.record.deletedAt,
      };
      s.records = [
        ...s.records.filter((entry) => entry.id !== summary.id),
        summary,
      ];
      s.status = result.value.warning ?? "Location saved.";
      return true;
    } catch {
      s.error =
        "Unable to save the location. Your edits remain available; retry saving.";
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
      kind: "location",
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
    s.status = "Location loaded.";
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
        (entry) => entry.kind === "location",
      );
      if (result.value.diagnostics.length || s.readOnly)
        s.error =
          "Some story bible files need review. Available locations can be read; changes are disabled while the store is read-only.";
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
        "Unable to load locations. Retry loading; your project files are unchanged.";
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
        s.status = "New location.";
      }
      focusName();
    } catch {
      s.error =
        "Unable to open the location. Your current edits remain available.";
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
          ? "Restore this location?"
          : "Delete this location? Its saved content will remain available under Deleted locations.",
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
        kind: "location",
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
        ? "Location restored."
        : "Location deleted. Select it under Deleted locations to restore it.";
    } catch {
      s.error =
        "Unable to change the location. Retry after reviewing its saved state.";
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
  }, [projectId]);

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
      aria-labelledby="location-bible-heading"
      aria-busy={view.loading || view.saving || view.navigating}
    >
      <div className="tool-intro">
        <span className="section-label">STORY BIBLE</span>
        <h3 id="location-bible-heading">Locations</h3>
        <p>Keep places and their important features with your local project.</p>
      </div>
      <div className="story-bible-toolbar">
        <label htmlFor="location-record">Location</label>
        <select
          id="location-record"
          value={view.record?.id ?? ""}
          disabled={locked || view.saving}
          onChange={(event) => void navigate(event.target.value || null)}
        >
          <option value="">New location</option>
          <optgroup label="Locations">
            {orderedRecords
              .filter((r) => r.deletedAt === null)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
          </optgroup>
          <optgroup label="Deleted locations">
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
      {view.loading && <p role="status">Loading locations…</p>}
      {!view.loading && view.readOnly && (
        <p>
          Locations are read-only until story bible loading or recovery problems
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
        <p>No locations yet. Create the first one below.</p>
      )}
      <form
        aria-label={view.record ? "Edit location" : "New location"}
        onSubmit={(event) => {
          event.preventDefault();
          void flush();
        }}
      >
        <fieldset disabled={locked || view.readOnly || deleted}>
          <legend>Location details</legend>
          <label htmlFor="location-name">Name</label>
          <input
            ref={nameInput}
            id="location-name"
            autoComplete="off"
            value={view.draft.name}
            onChange={(event) => update("name", event.target.value)}
          />
          <label htmlFor="location-type">Type</label>
          <input
            id="location-type"
            value={view.draft.type}
            onChange={(event) => update("type", event.target.value)}
          />
          <label htmlFor="location-description">Description</label>
          <textarea
            id="location-description"
            rows={4}
            value={view.draft.description}
            onChange={(event) => update("description", event.target.value)}
          />
          <label htmlFor="location-notes">Notes</label>
          <textarea
            id="location-notes"
            rows={4}
            value={view.draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
          <fieldset>
            <legend>Tags</legend>
            {view.draft.tags.map((tag, index) => (
              <div key={index}>
                <label htmlFor={`location-tag-${index}`}>Tag {index + 1}</label>
                <textarea
                  id={`location-tag-${index}`}
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
                    focusName();
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
            {view.saving ? "Saving…" : "Save location"}
          </button>
        </fieldset>
        {view.record && (
          <button
            type="button"
            disabled={locked || view.saving || view.readOnly}
            onClick={() => void removeOrRestore()}
          >
            {deleted ? "Restore location" : "Delete"}
          </button>
        )}
        {JSON.stringify(view.draft) !== view.baseline && (
          <button
            type="button"
            disabled={locked || view.saving}
            onClick={() => {
              if (window.confirm("Discard unsaved location changes?"))
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
