import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CreateProjectRequestSchema,
  type ProjectLocation,
  type ProjectWorkspace,
} from "@sarel/shared";

interface Props {
  onCancel(): void;
  onCreated(project: ProjectWorkspace, warning?: string): void;
}

export function NewProjectDialog({ onCancel, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("en-GB");
  const [location, setLocation] = useState<ProjectLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function selectLocation() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.sarel.project.selectLocation();
      if (!result.ok) setError(result.error.message);
      else if (result.value) setLocation(result.value);
    } catch {
      setError("Unable to choose a folder. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const parsed = CreateProjectRequestSchema.safeParse({
      title,
      author,
      language,
      locationToken: location?.token,
    });
    setInvalid(true);
    if (!parsed.success) {
      setError(
        "Enter a book title, author and language, and choose a project folder.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.sarel.project.create(parsed.data);
      if (result.ok) onCreated(result.value, result.warning);
      else setError(result.error.message);
    } catch {
      setError("Unable to create the project. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="project-dialog"
      aria-labelledby="new-project-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending.current) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        aria-busy={busy}
      >
        <h2 id="new-project-title">New project</h2>
        <p>Create a local home for your book. All fields are required.</p>
        <fieldset disabled={busy}>
          <label htmlFor="book-title">Book title</label>
          <input
            id="book-title"
            value={title}
            maxLength={500}
            required
            aria-invalid={invalid && !title.trim()}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="book-author">Author</label>
          <input
            id="book-author"
            value={author}
            maxLength={500}
            required
            aria-invalid={invalid && !author.trim()}
            onChange={(event) => setAuthor(event.target.value)}
          />
          <label htmlFor="book-language">Language</label>
          <input
            id="book-language"
            value={language}
            maxLength={100}
            required
            aria-describedby="language-help"
            aria-invalid={invalid && !language.trim()}
            onChange={(event) => setLanguage(event.target.value)}
          />
          <small id="language-help">
            For example, en-GB for British English.
          </small>
          <label htmlFor="project-location">Project location</label>
          <div className="folder-picker">
            <input
              id="project-location"
              value={location?.path ?? ""}
              placeholder="Choose an empty folder"
              readOnly
              required
              aria-describedby="location-help"
              aria-invalid={invalid && !location}
            />
            <button
              type="button"
              onClick={() => {
                void selectLocation();
              }}
            >
              Choose folder…
            </button>
          </div>
          <small id="location-help">
            Choose an empty folder dedicated to this book.
          </small>
        </fieldset>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Please wait…" : "Create project"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
