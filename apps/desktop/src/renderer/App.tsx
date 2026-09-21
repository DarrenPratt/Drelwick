import "./app.css";
import {
  createAutosaveCoordinator,
  type AutosaveCoordinator,
} from "@bookeditor/core/autosave";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  countDocumentWords,
  type ProjectWorkspace,
  type RecentProject,
} from "@bookeditor/shared";
import { NewProjectDialog } from "./NewProjectDialog.js";
import { Editor } from "./components/Editor.js";
import { WorkspaceLayout } from "./components/WorkspaceLayout.js";
import { WorkspaceDemo } from "./components/WorkspaceDemo.js";
import { WorkspaceIcon } from "./components/WorkspaceIcon.js";
import type { JSONContent } from "@tiptap/core";
import {
  documentReducer,
  isDocumentDirty,
  type DocumentAction,
  type DocumentState,
} from "./document-state.js";

export function App() {
  const [demo, setDemo] = useState(false);
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
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [switchingChapter, setSwitchingChapter] = useState(false);
  const [draggedChapterId, setDraggedChapterId] = useState<string | null>(null);
  const [documentState, reduceDocument] = useReducer(documentReducer, null);
  const documentRef = useRef<DocumentState | null>(null);
  const dispatchDocument = useCallback((action: DocumentAction) => {
    // Event handlers must see edits immediately, even before React commits a render.
    documentRef.current = documentReducer(documentRef.current, action);
    reduceDocument(action);
  }, []);
  const [editorError, setEditorError] = useState("");
  const [documentSession, setDocumentSession] = useState(0);
  const [deletingChapter, setDeletingChapter] = useState(false);
  const projectPath = project?.projectPath;
  const chapterKey = JSON.stringify([
    documentSession,
    projectPath,
    activeChapterId,
  ]);
  const documentReady = documentState?.key === chapterKey;
  const dirty = documentReady && isDocumentDirty(documentState);
  const saving = documentReady && documentState?.pendingSave !== null;
  const savePending = useRef(false);
  const nextSaveRequest = useRef(0);
  const autosave = useRef<AutosaveCoordinator | null>(null);
  const saveSource = useRef<"autosave" | "manual">("autosave");
  const changingDocument =
    opening || creatingChapter || deletingChapter || switchingChapter;

  useEffect(() => {
    if (!projectPath || !activeChapterId) return;
    let active = true;
    void window.bookEditor.project
      .loadChapter({ chapterId: activeChapterId })
      .then((result) => {
        if (!active) return;
        if (result.ok && result.value.id === activeChapterId) {
          setEditorError("");
          dispatchDocument({
            type: "loaded",
            key: chapterKey,
            chapterId: activeChapterId,
            content: result.value.content as JSONContent,
          });
        } else
          setEditorError(
            result.ok
              ? "The wrong chapter was returned."
              : result.error.message,
          );
      })
      .catch(() => {
        if (active) setEditorError("Unable to load the selected chapter.");
      });
    return () => {
      active = false;
    };
  }, [activeChapterId, projectPath, chapterKey, dispatchDocument]);

  const persistDocument = useCallback(async (): Promise<boolean> => {
    const snapshot = documentRef.current;
    if (!snapshot || !isDocumentDirty(snapshot)) return true;
    if (savePending.current) return false;
    const requestId = ++nextSaveRequest.current;
    savePending.current = true;
    dispatchDocument({
      type: "saving",
      key: snapshot.key,
      requestId,
      revision: snapshot.editorRevision,
    });
    setEditorError("");
    try {
      const result = await window.bookEditor.project.saveChapter({
        chapterId: snapshot.chapterId,
        document: snapshot.content,
        source: saveSource.current,
      });
      if (result.ok && result.value.id === snapshot.chapterId) {
        dispatchDocument({
          type: "saved",
          key: snapshot.key,
          requestId,
          ...(result.warning ? { warning: result.warning } : {}),
        });
        return true;
      } else {
        dispatchDocument({
          type: "failed",
          key: snapshot.key,
          requestId,
          message: result.ok
            ? "The save acknowledgement did not match this chapter. Please retry."
            : result.error.message,
        });
        return false;
      }
    } catch {
      dispatchDocument({
        type: "failed",
        key: snapshot.key,
        requestId,
        message:
          "Unable to save the chapter. Your edits remain in the editor; please try again.",
      });
      return false;
    } finally {
      savePending.current = false;
    }
  }, [dispatchDocument]);

  useEffect(() => {
    const coordinator = createAutosaveCoordinator({
      isDirty: () => isDocumentDirty(documentRef.current),
      save: persistDocument,
    });
    autosave.current = coordinator;
    const onBlur = () => {
      void coordinator.flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDocumentDirty(documentRef.current) && !savePending.current) return;
      event.preventDefault();
      // Electron requires an explicit returnValue when using addEventListener.
      event.returnValue = "";
      setError(
        "Saving before closing. Close again after all changes are saved.",
      );
      void coordinator.flush();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      coordinator.dispose();
      autosave.current = null;
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [persistDocument]);

  useEffect(() => {
    return window.bookEditor.onShutdownRequested(async () => {
      const saved = (await autosave.current?.flush()) ?? true;
      if (!saved) {
        setError(
          "Unable to save changes before closing. Your edits remain available; try closing again.",
        );
      }
      return saved;
    });
  }, []);

  const saveActiveChapter = useCallback(() => {
    if (!documentReady || changingDocument) return;
    setError("");
    const coordinator = autosave.current;
    if (!coordinator) return;
    saveSource.current = "manual";
    void coordinator.flush().finally(() => {
      saveSource.current = "autosave";
    });
  }, [documentReady, changingDocument]);

  useEffect(() => {
    const unsubscribe = window.bookEditor.onSaveRequested(saveActiveChapter);
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "s" ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      event.preventDefault();
      saveActiveChapter();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [saveActiveChapter]);

  function canLeaveChapter() {
    if (
      !changingDocument &&
      (savePending.current || isDocumentDirty(documentRef.current))
    ) {
      void autosave.current?.flush();
      setError(
        "Saving changes. Try switching again after all changes are saved.",
      );
      return false;
    }
    if (savePending.current || changingDocument) {
      setError(
        "Please wait for the current chapter operation before switching.",
      );
      return false;
    }
    return true;
  }

  async function selectChapter(chapterId: string) {
    if (
      chapterId === activeChapterId ||
      switchingChapter ||
      opening ||
      creatingChapter ||
      deletingChapter
    )
      return;
    setSwitchingChapter(true);
    setError("");
    try {
      if (savePending.current || isDocumentDirty(documentRef.current)) {
        const saved = await autosave.current?.flush();
        if (
          !saved ||
          savePending.current ||
          isDocumentDirty(documentRef.current)
        ) {
          setError(
            "Unable to save changes. The current chapter remains open; please try again.",
          );
          return;
        }
      }
      setEditorError("");
      setDocumentSession((session) => session + 1);
      setActiveChapterId(chapterId);
    } finally {
      setSwitchingChapter(false);
    }
  }

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
    if (pending.current || creating || loadingRecents || !canLeaveChapter())
      return;
    pending.current = true;
    setOpening(true);
    setError("");
    try {
      const result = await (id
        ? window.bookEditor.project.openRecent(id)
        : window.bookEditor.project.open());
      if (!result.ok) setError(result.error.message);
      else if (result.value) {
        setProject(result.value);
        setDocumentSession((session) => session + 1);
        setActiveChapterId(result.value.chapters[0]?.id ?? null);
      }
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
    if (
      changingDocument ||
      savePending.current ||
      (chapterId === activeChapterId && !canLeaveChapter())
    )
      return;
    if (!project || !window.confirm("Move this chapter to project recovery?"))
      return;
    setDeletingChapter(true);
    setError("");
    try {
      const result = await window.bookEditor.project.deleteChapter({
        chapterId,
      });
      if (result.ok) {
        setProject(result.value);
        if (activeChapterId === chapterId) {
          setDocumentSession((session) => session + 1);
          setActiveChapterId(result.value.chapters[0]?.id ?? null);
        }
      } else setError(result.error.message);
      if (result.ok && result.warning) setError(result.warning);
    } catch {
      setError("Unable to delete the chapter. Please try again.");
    } finally {
      setDeletingChapter(false);
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

  async function createNewChapter(event: FormEvent) {
    event.preventDefault();
    if (
      !project ||
      !newChapterTitle.trim() ||
      creatingChapter ||
      !canLeaveChapter()
    )
      return;
    setCreatingChapter(true);
    setError("");
    try {
      const result = await window.bookEditor.project.createChapter({
        title: newChapterTitle,
      });
      if (result.ok) {
        setProject(result.value);
        setNewChapterTitle("");
        setDocumentSession((session) => session + 1);
        setActiveChapterId(result.value.chapters.at(-1)?.id ?? null);
      } else setError(result.error.message);
      if (result.ok && result.warning) setError(result.warning);
    } catch {
      setError("Unable to create the chapter. Please try again.");
    } finally {
      setCreatingChapter(false);
    }
  }

  async function dropChapter(targetId: string) {
    if (!project || !draggedChapterId || draggedChapterId === targetId) return;
    const chapterIds = project.chapters.map((chapter) => chapter.id);
    const from = chapterIds.indexOf(draggedChapterId);
    const to = chapterIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    chapterIds.splice(from, 1);
    chapterIds.splice(to, 0, draggedChapterId);
    setDraggedChapterId(null);
    setReordering(true);
    setError("");
    try {
      const result = await window.bookEditor.project.reorderChapters({
        chapterIds,
      });
      if (result.ok) setProject(result.value);
      else setError(result.error.message);
    } catch {
      setError("Unable to reorder chapters. Please try again.");
    } finally {
      setReordering(false);
    }
  }

  const projectActions = (
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
  );
  const recentProjects = (
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
  );

  if (demo) return <WorkspaceDemo onExit={() => setDemo(false)} />;

  return (
    <>
      {project ? (
        <WorkspaceLayout
          key={project.projectId}
          title={project.title}
          author={project.author}
          library={
            <>
              {projectActions}
              {recentProjects}
              <p className="project-path">Saved in {project.projectPath}</p>
            </>
          }
          notice={
            <>
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              {editorError && (
                <p className="error-message" role="alert">
                  {editorError}
                </p>
              )}
            </>
          }
          navigator={
            <nav aria-label="Chapter navigator">
              <div className="navigator-heading">
                <h3>BODY</h3>
                <span>{project.chapters.length} chapters</span>
              </div>
              <ol className="chapter-navigator">
                {project.chapters.map((chapter, index) => (
                  <li
                    key={chapter.id}
                    className={
                      activeChapterId === chapter.id ? "active-chapter" : ""
                    }
                    draggable={!reordering}
                    onDragStart={() => setDraggedChapterId(chapter.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void dropChapter(chapter.id)}
                    onKeyDown={(event) => {
                      if (event.altKey && event.key === "ArrowUp") {
                        event.preventDefault();
                        void moveChapter(chapter.id, -1);
                      } else if (event.altKey && event.key === "ArrowDown") {
                        event.preventDefault();
                        void moveChapter(chapter.id, 1);
                      }
                    }}
                    tabIndex={0}
                  >
                    <button
                      type="button"
                      className="chapter-select"
                      aria-current={
                        activeChapterId === chapter.id ? "page" : undefined
                      }
                      onClick={() => void selectChapter(chapter.id)}
                    >
                      <span>
                        <span className="chapter-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {chapter.title}
                      </span>
                      <small>
                        {chapter.status} · {chapter.wordCount} words
                      </small>
                    </button>
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
                      <details className="chapter-menu">
                        <summary aria-label={`Actions for ${chapter.title}`}>
                          ⋯
                        </summary>
                        <div className="chapter-menu-actions">
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
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
              <form
                className="chapter-create"
                onSubmit={(event) => void createNewChapter(event)}
              >
                <label htmlFor="new-chapter-title">New chapter title</label>
                <input
                  id="new-chapter-title"
                  value={newChapterTitle}
                  onChange={(event) => setNewChapterTitle(event.target.value)}
                  placeholder="New chapter title"
                  disabled={creatingChapter}
                />
                <button
                  type="submit"
                  disabled={creatingChapter || !newChapterTitle.trim()}
                >
                  {creatingChapter ? "Creating…" : "New chapter"}
                </button>
              </form>
            </nav>
          }
          editor={
            project.chapters.length === 0 ? (
              <div className="empty-manuscript">
                <WorkspaceIcon name="book" />
                <span className="section-label">A NEW BEGINNING</span>
                <h2>Your story starts here.</h2>
                <p>
                  Your project is ready. There are no chapters yet. Create one
                  to begin writing.
                </p>
                <button
                  onClick={() =>
                    document.getElementById("new-chapter-title")?.focus()
                  }
                >
                  Name your first chapter
                </button>
              </div>
            ) : (
              <>
                {documentReady && documentState ? (
                  <Editor
                    key={chapterKey}
                    editable={!changingDocument}
                    title={
                      project.chapters.find(
                        (chapter) => chapter.id === activeChapterId,
                      )?.title ?? "Manuscript"
                    }
                    chapterLabel={`CHAPTER ${String(project.chapters.findIndex((chapter) => chapter.id === activeChapterId) + 1).padStart(2, "0")}`}
                    content={documentState.content}
                    onChange={(content) => {
                      dispatchDocument({
                        type: "edited",
                        key: chapterKey,
                        content,
                      });
                      autosave.current?.edited();
                      if (!activeChapterId) return;
                      const wordCount = countDocumentWords(content);
                      setProject((current) =>
                        current
                          ? {
                              ...current,
                              chapters: current.chapters.map((chapter) =>
                                chapter.id === activeChapterId
                                  ? { ...chapter, wordCount }
                                  : chapter,
                              ),
                            }
                          : current,
                      );
                    }}
                  />
                ) : (
                  <p>
                    Select a chapter and wait for it to load before editing.
                  </p>
                )}
              </>
            )
          }
          status={
            <>
              <button
                type="button"
                aria-keyshortcuts="Control+s Meta+s"
                disabled={saving || !documentReady || changingDocument}
                onClick={() => void saveActiveChapter()}
              >
                {saving ? "Saving chapter..." : "Save chapter"}
              </button>
              {documentReady && documentState && (
                <>
                  <p role="status" aria-label="Chapter save status">
                    {saving
                      ? "Saving chapter..."
                      : dirty
                        ? "Unsaved changes"
                        : "All changes saved"}
                  </p>
                  {documentState.message && (
                    <p role="status">{documentState.message}</p>
                  )}
                  {documentState.error && (
                    <p role="alert" className="error-message">
                      {documentState.error}
                    </p>
                  )}
                </>
              )}
              <p>
                {project.chapters.length}{" "}
                {project.chapters.length === 1 ? "chapter" : "chapters"} ·{" "}
                {project.chapters.reduce(
                  (total, chapter) => total + chapter.wordCount,
                  0,
                )}{" "}
                words
              </p>
            </>
          }
        />
      ) : (
        <main className="app-shell" aria-busy={opening}>
          <header className="app-header">
            <p className="eyebrow">
              <WorkspaceIcon name="book" /> BookEditor · Your words, your world
            </p>
            <h1>Your manuscript workspace</h1>
            <p className="welcome-description">
              A quiet place to write. A beautiful place to make a book.
              <br />
              Your work stays local, and always belongs to you.
            </p>
          </header>
          {projectActions}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="welcome-grid">
            <section className="welcome-panel demo-invitation">
              <span className="section-label">A LOOK AHEAD</span>
              <h2>Meet your next writing space.</h2>
              <p>
                Explore a sample book in the new workspace, with an outline, a
                spacious editor and a look at the publishing tools to come.
              </p>
              <button
                className="primary-button"
                disabled={opening || creating}
                onClick={() => setDemo(true)}
              >
                Explore workspace
              </button>
              <small>Interactive demo · no project files created</small>
              <div className="mini-workspace" aria-hidden="true">
                <div />
                <div>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div>
                  <span>Aa</span>
                </div>
              </div>
            </section>
            {recentProjects}
          </div>
        </main>
      )}
      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreated={(created, warning) => {
            setProject(created);
            setDocumentSession((session) => session + 1);
            setCreating(false);
            setLoadingRecents(true);
            void refreshRecents().finally(() => {
              if (warning) setRecentError(warning);
              setLoadingRecents(false);
            });
          }}
        />
      )}
    </>
  );
}
