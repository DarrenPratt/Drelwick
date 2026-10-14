import { useEffect, useState } from "react";
import type {
  ReferenceInput,
  ReferenceRecord,
  ReferenceSummary,
} from "@drelwick/shared";

type Location = Extract<ReferenceRecord, { kind: "location" }>;
type LocationDraft = {
  name: string;
  type: string;
  description: string;
  notes: string;
  tags: string;
};

const emptyDraft = (): LocationDraft => ({
  name: "",
  type: "",
  description: "",
  notes: "",
  tags: "",
});

function toDraft(location: Location): LocationDraft {
  return {
    name: location.name,
    type: location.type ?? "",
    description: location.description ?? "",
    notes: location.notes ?? "",
    tags: location.tags.join(", "),
  };
}

function toContent(draft: LocationDraft): ReferenceInput {
  const optional = (value: string) => {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };
  return {
    kind: "location",
    name: draft.name.trim(),
    type: optional(draft.type),
    description: optional(draft.description),
    notes: optional(draft.notes),
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    links: [],
  };
}

export interface LocationManagerProps {
  projectId: string;
}

export function LocationManager({ projectId }: LocationManagerProps) {
  const [records, setRecords] = useState<ReferenceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [record, setRecord] = useState<Location | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);

  async function openRecord(id: string) {
    const result = await window.drelwick.references.execute({
      operation: "read",
      projectId,
      kind: "location",
      id,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (
      result.value.type !== "record" ||
      result.value.value.record.kind !== "location"
    )
      return;
    setSelectedId(id);
    setRecord(result.value.value.record);
    setFingerprint(result.value.value.fingerprint);
    const nextDraft = toDraft(result.value.value.record);
    setDraft(nextDraft);
    setDirty(false);
    setCreating(false);
    setStatus("");
  }

  function startCreate(confirmDirty = true) {
    if (
      confirmDirty &&
      dirty &&
      !window.confirm("Discard unsaved location changes?")
    )
      return;
    setSelectedId(null);
    setRecord(null);
    setFingerprint(null);
    const nextDraft = emptyDraft();
    setDraft(nextDraft);
    setDirty(false);
    setCreating(true);
    setStatus("");
    setError("");
  }

  async function loadList() {
    setLoading(true);
    setError("");
    const result = await window.drelwick.references.execute({
      operation: "list",
      projectId,
    });
    if (!result.ok) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    if (result.value.type !== "list") {
      setError("Unable to list locations.");
      setLoading(false);
      return;
    }
    const locations = result.value.records.filter(
      (entry) => entry.kind === "location" && entry.deletedAt === null,
    );
    setRecords(locations);
    setLoading(false);
    if (locations[0]) await openRecord(locations[0].id);
    else startCreate(false);
  }

  function updateDraft<K extends keyof LocationDraft>(
    key: K,
    value: LocationDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setStatus("");
  }

  async function save() {
    if (!draft.name.trim()) {
      setError("Enter a name before saving the location.");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const content = toContent(draft);
      const result = await window.drelwick.references.execute(
        creating
          ? { operation: "create", projectId, content, generation: 1 }
          : {
              operation: "update",
              projectId,
              kind: "location",
              id: record!.id,
              expectedRevision: record!.revision,
              expectedFingerprint: fingerprint!,
              content,
              generation: record!.revision + 1,
            },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (
        result.value.type !== "record" ||
        result.value.value.record.kind !== "location"
      )
        return;
      const saved = result.value.value.record;
      setRecords((current) =>
        creating
          ? [
              ...current,
              {
                id: saved.id,
                kind: saved.kind,
                title: saved.name,
                revision: saved.revision,
                deletedAt: saved.deletedAt,
              },
            ]
          : current.map((entry) =>
              entry.id === saved.id
                ? {
                    ...entry,
                    title: saved.name,
                    revision: saved.revision,
                  }
                : entry,
            ),
      );
      setSelectedId(saved.id);
      setRecord(saved);
      setFingerprint(result.value.value.fingerprint);
      setCreating(false);
      const nextDraft = toDraft(saved);
      setDraft(nextDraft);
      setDirty(false);
      setStatus("Location saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the location.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !record ||
      !fingerprint ||
      !window.confirm(
        `Delete ${record.name}? It can be recovered from the project files.`,
      )
    )
      return;
    setDeleting(true);
    setError("");
    const result = await window.drelwick.references.execute({
      operation: "delete",
      projectId,
      kind: "location",
      id: record.id,
      expectedRevision: record.revision,
      expectedFingerprint: fingerprint,
      generation: record.revision + 1,
    });
    if (!result.ok) setError(result.error.message);
    else {
      setRecords((current) =>
        current.filter((entry) => entry.id !== record.id),
      );
      startCreate(false);
      setStatus("Location deleted.");
    }
    setDeleting(false);
  }

  useEffect(() => {
    // Loading from the privileged project API updates this component asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList();
    // Project identity is the lifetime of this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <section
      className="story-bible-panel"
      aria-labelledby="location-bible-heading"
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
          value={creating ? "" : (selectedId ?? "")}
          onChange={(event) => {
            if (event.target.value) {
              if (dirty && !window.confirm("Discard unsaved location changes?"))
                return;
              void openRecord(event.target.value);
            }
          }}
          disabled={loading || saving || deleting || creating}
        >
          <option value="">New location</option>
          {records.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title || "Unnamed location"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => startCreate()}
          disabled={saving || deleting}
        >
          New
        </button>
      </div>
      {loading && <p role="status">Loading locations…</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!loading && records.length === 0 && (
        <p className="story-bible-empty">
          No locations yet. Create the first one below.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        aria-label={
          creating ? "New location" : `Edit ${record?.name ?? "location"}`
        }
      >
        <label htmlFor="location-name">Name</label>
        <input
          id="location-name"
          value={draft.name}
          onChange={(event) => updateDraft("name", event.target.value)}
          autoComplete="off"
        />
        <label htmlFor="location-type">Type</label>
        <input
          id="location-type"
          value={draft.type}
          onChange={(event) => updateDraft("type", event.target.value)}
          placeholder="City, vessel, building…"
        />
        <label className="story-bible-field" htmlFor="location-description">
          Description
          <textarea
            id="location-description"
            value={draft.description}
            onChange={(event) => updateDraft("description", event.target.value)}
            rows={4}
          />
        </label>
        <label className="story-bible-field" htmlFor="location-notes">
          Notes
          <textarea
            id="location-notes"
            value={draft.notes}
            onChange={(event) => updateDraft("notes", event.target.value)}
            rows={4}
          />
        </label>
        <label htmlFor="location-tags">Tags</label>
        <input
          id="location-tags"
          value={draft.tags}
          onChange={(event) => updateDraft("tags", event.target.value)}
          placeholder="Comma-separated tags"
        />
        <div className="story-bible-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={saving || deleting || !dirty}
          >
            {saving ? "Saving…" : "Save location"}
          </button>
          {record && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving || deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
        {dirty ? (
          <p className="story-bible-status" role="status">
            Unsaved changes
          </p>
        ) : (
          status && (
            <p className="success-message" role="status">
              {status}
            </p>
          )
        )}
      </form>
    </section>
  );
}
