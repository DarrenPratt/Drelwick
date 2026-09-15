import "./app.css";
import { useRef, useState } from "react";
import type { ProjectWorkspace } from "@bookeditor/shared";
import { NewProjectDialog } from "./NewProjectDialog.js";

export function App() {
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function openExistingProject() {
    if (pending.current || creating) return;
    pending.current = true;
    setOpening(true);
    setError("");
    try {
      const result = await window.bookEditor.project.open();
      if (!result.ok) setError(result.error.message);
      else if (result.value) setProject(result.value);
    } catch {
      setError("Unable to open the project. Please try again.");
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }

  return (
    <main className="app-shell" aria-busy={opening}>
      <header className="app-header">
        <p className="eyebrow">
          {project ? "BookEditor · Project workspace" : "BookEditor"}
        </p>
        <h1>{project?.title ?? "Your manuscript workspace"}</h1>
        {project && (
          <p>
            {project.author} · {project.language}
          </p>
        )}
      </header>
      <div className="project-actions" aria-label="Project actions">
        {!project && (
          <button
            className="primary-button"
            disabled={opening || creating}
            onClick={() => {
              setError("");
              setCreating(true);
            }}
          >
            New project
          </button>
        )}
        <button
          disabled={opening || creating}
          onClick={() => {
            void openExistingProject();
          }}
        >
          {opening ? "Opening project…" : "Open project"}
        </button>
      </div>
      {error && (
        <p className="error-message project-open-error" role="alert">
          {error}
        </p>
      )}
      {project ? (
        <section className="welcome-panel" aria-labelledby="manuscript-heading">
          <h2 id="manuscript-heading">Manuscript</h2>
          {project.chapters.length === 0 ? (
            <p>Your project is ready. There are no chapters yet.</p>
          ) : (
            <p>
              {project.chapters.length}{" "}
              {project.chapters.length === 1 ? "chapter" : "chapters"} ·{" "}
              {project.chapters.reduce(
                (total, chapter) => total + chapter.wordCount,
                0,
              )}{" "}
              words
            </p>
          )}
          <p className="project-path">Saved in {project.projectPath}</p>
        </section>
      ) : (
        <section className="welcome-panel" aria-labelledby="welcome-heading">
          <h2 id="welcome-heading">Start writing</h2>
          <p>
            Create or open a project to begin shaping your manuscript. Your work
            stays local and belongs to you.
          </p>
        </section>
      )}
      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setProject(created);
            setCreating(false);
          }}
        />
      )}
    </main>
  );
}
