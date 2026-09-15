import "./app.css";
import { useState } from "react";
import type { ProjectWorkspace } from "@bookeditor/shared";
import { NewProjectDialog } from "./NewProjectDialog.js";

export function App() {
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  if (project)
    return (
      <main className="app-shell">
        <header className="app-header">
          <p className="eyebrow">BookEditor · Project workspace</p>
          <h1>{project.title}</h1>
          <p>
            {project.author} · {project.language}
          </p>
        </header>
        <section className="welcome-panel" aria-labelledby="manuscript-heading">
          <h2 id="manuscript-heading">Manuscript</h2>
          <p>Your project is ready. There are no chapters yet.</p>
          <p className="project-path">Saved in {project.projectPath}</p>
        </section>
      </main>
    );
  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">BookEditor</p>
        <h1>Your manuscript workspace</h1>
      </header>
      <section className="welcome-panel" aria-labelledby="welcome-heading">
        <h2 id="welcome-heading">Start writing</h2>
        <p>
          Create or open a project to begin shaping your manuscript. Your work
          stays local and belongs to you.
        </p>
        <button
          className="primary-button new-project-button"
          onClick={() => setCreating(true)}
        >
          New project
        </button>
      </section>
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
