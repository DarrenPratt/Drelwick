import { useEffect, useRef, useState } from "react";
import type {
  ReferenceInput,
  ReferenceRecord,
  ReferenceSummary,
} from "@drelwick/shared";

type Character = Extract<ReferenceRecord, { kind: "character" }>;
type Draft = {
  name: string;
  aliases: string[];
  role: string;
  description: string;
  appearance: string;
  personality: string;
  background: string;
  notes: string;
  tags: string;
};

const emptyDraft = (): Draft => ({
  name: "",
  aliases: [],
  role: "",
  description: "",
  appearance: "",
  personality: "",
  background: "",
  notes: "",
  tags: "",
});

function toDraft(character: Character): Draft {
  return {
    name: character.name,
    aliases: character.aliases,
    role: character.role ?? "",
    description: character.description ?? "",
    appearance: character.appearance ?? "",
    personality: character.personality ?? "",
    background: character.background ?? "",
    notes: character.notes ?? "",
    tags: character.tags.join(", "),
  };
}

function toContent(draft: Draft): ReferenceInput {
  const optional = (value: string) => {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };
  return {
    kind: "character",
    name: draft.name.trim(),
    aliases: draft.aliases.map((alias) => alias.trim()).filter(Boolean),
    role: optional(draft.role),
    description: optional(draft.description),
    appearance: optional(draft.appearance),
    personality: optional(draft.personality),
    background: optional(draft.background),
    notes: optional(draft.notes),
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    links: [],
  };
}

export interface CharacterManagerProps {
  projectId: string;
  execute?: typeof window.drelwick.references.execute;
}

export function CharacterManager({
  projectId,
  execute = window.drelwick.references.execute,
}: CharacterManagerProps) {
  const [records, setRecords] = useState<ReferenceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [record, setRecord] = useState<Character | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const draftRef = useRef(draft);
  const savedDraftRef = useRef("");

  const draftKey = JSON.stringify(draft);
  draftRef.current = draft;
  const dirty = draftKey !== savedDraftRef.current;

  async function loadList(selectFirst = true) {
    setLoading(true);
    setError("");
    const result = await execute({
      operation: "list",
      projectId,
    });
    if (!result.ok) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    if (result.value.type !== "list") {
      setError("Unable to list characters.");
      setLoading(false);
      return;
    }
    const characters = result.value.records.filter(
      (entry) => entry.kind === "character" && entry.deletedAt === null,
    );
    setRecords(characters);
    setLoading(false);
    if (
      selectFirst &&
      selectedId &&
      characters.some((entry) => entry.id === selectedId)
    )
      await openRecord(selectedId);
    else if (selectFirst && characters[0]) await openRecord(characters[0].id);
    else if (selectFirst) startCreate(false);
  }

  async function openRecord(id: string) {
    const result = await execute({
      operation: "read",
      projectId,
      kind: "character",
      id,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (
      result.value.type !== "record" ||
      result.value.value.record.kind !== "character"
    )
      return;
    setSelectedId(id);
    setRecord(result.value.value.record);
    setFingerprint(result.value.value.fingerprint);
    const nextDraft = toDraft(result.value.value.record);
    setDraft(nextDraft);
    savedDraftRef.current = JSON.stringify(nextDraft);
    setCreating(false);
    setStatus("");
  }

  function startCreate(confirmDirty = true) {
    if (
      confirmDirty &&
      dirty &&
      !window.confirm("Discard unsaved character changes?")
    )
      return;
    setSelectedId(null);
    setRecord(null);
    setFingerprint(null);
    const nextDraft = emptyDraft();
    setDraft(nextDraft);
    savedDraftRef.current = JSON.stringify(nextDraft);
    setCreating(true);
    setStatus("");
    setError("");
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus("");
  }

  async function save() {
    if (!draft.name.trim()) {
      setError("Enter a name before saving the character.");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const content = toContent(draftRef.current);
      const result = await execute(
        creating
          ? { operation: "create", projectId, content, generation: 1 }
          : {
              operation: "update",
              projectId,
              kind: "character",
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
        result.value.value.record.kind !== "character"
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
                ? { ...entry, title: saved.name, revision: saved.revision }
                : entry,
            ),
      );
      setSelectedId(saved.id);
      setRecord(saved);
      setFingerprint(result.value.value.fingerprint);
      setCreating(false);
      const nextDraft = toDraft(saved);
      setDraft(nextDraft);
      savedDraftRef.current = JSON.stringify(nextDraft);
      setStatus("Character saved.");
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
    const result = await execute({
      operation: "delete",
      projectId,
      kind: "character",
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
      setStatus("Character deleted.");
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
      aria-labelledby="story-bible-heading"
    >
      <div className="tool-intro">
        <span className="section-label">STORY BIBLE</span>
        <h3 id="story-bible-heading">Characters</h3>
        <p>Keep private character notes with your local project.</p>
      </div>
      <div className="story-bible-toolbar">
        <label htmlFor="character-record">Character</label>
        <select
          id="character-record"
          value={creating ? "" : (selectedId ?? "")}
          onChange={(event) => {
            if (event.target.value) {
              if (
                dirty &&
                !window.confirm("Discard unsaved character changes?")
              )
                return;
              void openRecord(event.target.value);
            }
          }}
          disabled={loading || saving || deleting || creating}
        >
          <option value="">New character</option>
          {records.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title || "Unnamed character"}
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
      {loading && <p role="status">Loading characters…</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!loading && records.length === 0 && (
        <p className="story-bible-empty">
          No characters yet. Create the first one below.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        aria-label={
          creating ? "New character" : `Edit ${record?.name ?? "character"}`
        }
      >
        <label htmlFor="character-name">Name</label>
        <input
          id="character-name"
          value={draft.name}
          onChange={(event) => updateDraft("name", event.target.value)}
          autoComplete="off"
        />
        <label htmlFor="character-aliases">Aliases</label>
        <input
          id="character-aliases"
          value={draft.aliases.join(", ")}
          onChange={(event) =>
            updateDraft("aliases", event.target.value.split(","))
          }
          placeholder="Comma-separated aliases"
        />
        {(
          [
            "role",
            "description",
            "appearance",
            "personality",
            "background",
            "notes",
          ] as const
        ).map((field) => (
          <label
            className="story-bible-field"
            key={field}
            htmlFor={`character-${field}`}
          >
            {field.charAt(0).toUpperCase() + field.slice(1)}
            <textarea
              id={`character-${field}`}
              value={draft[field]}
              onChange={(event) => updateDraft(field, event.target.value)}
              rows={field === "role" ? 2 : 3}
            />
          </label>
        ))}
        <label htmlFor="character-tags">Tags</label>
        <input
          id="character-tags"
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
            {saving ? "Saving…" : "Save character"}
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
