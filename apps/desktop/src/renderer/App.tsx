import "./app.css";
import { useEffect, useRef, useState } from "react";
import type { ProjectWorkspace, RecentProject } from "@bookeditor/shared";
import { NewProjectDialog } from "./NewProjectDialog.js";

export function App() {
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [recentError, setRecentError] = useState("");
  const [loadingRecents, setLoadingRecents] = useState(true);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [renamingChapterId, setRenamingChapterId] = useState<string | null>(
    null,
  );
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    let active = true;
    void window.bookEditor.project
      .listRecent()
      .then((result) => {
        if (!active) return;
        if (result.ok) setRecents(result.value);
        else setRecentError(result.error.message);
      })
      .catch(() => {
        if (active)
          setRecentError("Unable to load recent projects. Please try again.");
      })
      .finally(() => {
        if (active) setLoadingRecents(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function refreshRecents() {
    try {
      const result = await window.bookEditor.project.listRecent();
      if (result.ok) {
        setRecents(result.value);
        setRecentError("");
      } else setRecentError(result.error.message);
    } catch {
      setRecentError("Unable to load recent projects. Please try again.");
    }
  }

  async function removeRecent(id: string) {
    if (pending.current || creating || loadingRecents) return;
    pending.current = true;
    setLoadingRecents(true);
    setRecentError("");
    try {
      const result = await window.bookEditor.project.removeRecent(id);
      if (result.ok) setRecents(result.value);
      else setRecentError(result.error.message);
    } catch {
      setRecentError("Unable to remove the recent entry. Please try again.");
    } finally {
      pending.current = false;
      setLoadingRecents(false);
    }
  }

  async function openExistingProject(id?: string) {
    if (pending.current || creating || loadingRecents) return;
    pending.current = true;
    setOpening(true);
    setError("");
    try {
      const result = await (id
        ? window.bookEditor.project.openRecent(id)
        : window.bookEditor.project.open());
      if (!result.ok) setError(result.error.message);
      else if (result.value) setProject(result.value);
      if (result.ok && result.value) await refreshRecents();
      if (result.ok && result.warning) setRecentError(result.warning);
    } catch {
      setError("Unable to open the project. Please try again.");
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }

  async function renameSelectedChapter() {
    if (!project || !editingChapterId || !chapterTitle.trim()) return;
    setRenamingChapterId(editingChapterId);
    setError("");
    try {
      const result = await window.bookEditor.project.renameChapter({
        chapterId: editingChapterId,
        title: chapterTitle,
      });
      if (result.ok) {
        setProject(result.value);
        setEditingChapterId(null);
      } else setError(result.error.message);
      if (result.ok && result.warning) setError(result.warning);
    } catch {
      setError("Unable to rename the chapter. Please try again.");
    } finally {
      setRenamingChapterId(null);
    }
  }

  async function deleteSelectedChapter(chapterId: string) {
    if (!project || !window.confirm("Move this chapter to project recovery?"))
      return;
    setError("");
    try {
      const result = await window.bookEditor.project.deleteChapter({
        chapterId,
      });
      if (result.ok) setProject(result.value);
      else setError(result.error.message);
      if (result.ok && result.warning) setError(result.warning);
    } catch {
      setError("Unable to delete the chapter. Please try again.");
    }
  }

  async function moveChapter(chapterId: string, direction: -1 | 1) {
    if (!project || reordering) return;
    const index = project.chapters.findIndex(
      (chapter) => chapter.id === chapterId,
    );
    const target = index + direction;
    if (index < 0 || target < 0 || target >= project.chapters.length) return;
    const chapterIds = project.chapters.map((chapter) => chapter.id);
    [chapterIds[index], chapterIds[target]] = [
      chapterIds[target]!,
      chapterIds[index]!,
    ];
    setReordering(true);
    setError("");
    try {
      const result = await window.bookEditor.project.reorderChapters({
        chapterIds,
      });
      if (result.ok) setProject(result.value);
      else setError(result.error.message);
      if (result.ok && result.warning) setError(result.warning);
    } catch {
      setError("Unable to reorder chapters. Please try again.");
    } finally {
      setReordering(false);
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
            disabled={opening || creating || loadingRecents}
            onClick={() => {
              setError("");
              setCreating(true);
            }}
          >
            New project
          </button>
        )}
        <button
          disabled={opening || creating || loadingRecents}
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
            <>
              <p>
                {project.chapters.length}{" "}
                {project.chapters.length === 1 ? "chapter" : "chapters"} ·{" "}
                {project.chapters.reduce(
                  (total, chapter) => total + chapter.wordCount,
                  0,
                )}{" "}
                words
              </p>
              <nav aria-label="Chapter navigator">
                <h3>Chapters</h3>
                <ol className="chapter-navigator">
                  {project.chapters.map((chapter) => (
                    <li key={chapter.id}>
                      {editingChapterId === chapter.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renameSelectedChapter();
                          }}
                        >
                          <label htmlFor={`chapter-title-${chapter.id}`}>
                            Chapter title
                          </label>
                          <input
                            id={`chapter-title-${chapter.id}`}
                            value={chapterTitle}
                            onChange={(event) =>
                              setChapterTitle(event.target.value)
                            }
                            disabled={renamingChapterId === chapter.id}
                          />
                          <button
                            type="submit"
                            disabled={
                              renamingChapterId === chapter.id ||
                              !chapterTitle.trim()
                            }
                          >
                            {renamingChapterId === chapter.id
                              ? "Saving…"
                              : "Save"}
                          </button>
                          <button
                            type="button"
                            disabled={renamingChapterId === chapter.id}
                            onClick={() => setEditingChapterId(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <span>{chapter.title}</span>
                          <button
                            type="button"
                            disabled={reordering}
                            aria-label={`Move ${chapter.title} up`}
                            onClick={() => {
                              void moveChapter(chapter.id, -1);
                            }}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            disabled={reordering}
                            aria-label={`Move ${chapter.title} down`}
                            onClick={() => {
                              void moveChapter(chapter.id, 1);
                            }}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingChapterId(chapter.id);
                              setChapterTitle(chapter.title);
                              setError("");
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void deleteSelectedChapter(chapter.id);
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            </>
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
      <section
        className="welcome-panel recent-projects"
        aria-labelledby="recent-heading"
        aria-busy={loadingRecents}
      >
        <h2 id="recent-heading">Recent projects</h2>
        {recentError && (
          <p className="error-message" role="alert">
            {recentError}
          </p>
        )}
        {loadingRecents ? (
          <p>Updating recent projects…</p>
        ) : (
          recents.length === 0 && <p>No recent projects yet.</p>
        )}
        <ul>
          {recents.map((recent) => (
            <li key={recent.id}>
              <div>
                <button
                  disabled={opening || creating || loadingRecents}
                  onClick={() => {
                    void openExistingProject(recent.id);
                  }}
                >
                  {recent.title}
                </button>
                <p className="project-path">{recent.path}</p>
              </div>
              <button
                aria-label={`Remove ${recent.title} from recent projects`}
                disabled={opening || creating || loadingRecents}
                onClick={() => {
                  void removeRecent(recent.id);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreated={(created, warning) => {
            setProject(created);
            setCreating(false);
            setLoadingRecents(true);
            void refreshRecents().finally(() => {
              if (warning) setRecentError(warning);
              setLoadingRecents(false);
            });
          }}
        />
      )}
    </main>
  );
}
