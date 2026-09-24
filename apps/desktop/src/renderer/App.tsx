import {
  ChapterStatusSchema,
  type ChapterOrganisationRequest,
} from "@drelwick/shared";
import { splitChapterDocument } from "@drelwick/core/chapter-semantics";
import "./app.css";
import {
  createAutosaveCoordinator,
  type AutosaveCoordinator,
} from "@drelwick/core/autosave";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  countDocumentWords,
  type ProjectWorkspace,
  type RecentProject,
} from "@drelwick/shared";
import { ImportManuscriptDialog } from "./ImportManuscriptDialog.js";
import { ManuscriptSearch } from "./ManuscriptSearch.js";
import {
  replaceMatches,
  searchChapter,
} from "@drelwick/core/manuscript-search";
import type { ReplacementRequest } from "@drelwick/shared";
import type { Editor as TipTapEditor } from "@tiptap/core";
import { NewProjectDialog } from "./NewProjectDialog.js";
import { Editor } from "./components/Editor.js";
import { WorkspaceLayout } from "./components/WorkspaceLayout.js";
import { WorkspaceIcon } from "./components/WorkspaceIcon.js";
import { RendererErrorBoundary } from "./RendererErrorBoundary.js";
import type { JSONContent } from "@tiptap/core";
import {
  documentReducer,
  isDocumentDirty,
  type DocumentAction,
  type DocumentState,
} from "./document-state.js";

export function App() {
  const [organising, setOrganising] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [splitPosition, setSplitPosition] = useState<number | null>(null);
  const [searchEditor, setSearchEditor] = useState<TipTapEditor | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  const [replacing, setReplacing] = useState(false);
  const [searchRefresh, setSearchRefresh] = useState(0);
  const replacementCancelled = useRef(false);
  const [replacementRecoveryRequired, setReplacementRecoveryRequired] =
    useState(false);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [opening, setOpening] = useState(false);
  const [projectTask, setProjectTask] = useState<"backup" | "restore" | null>(
    null,
  );
  const [projectMessage, setProjectMessage] = useState("");
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
    organising ||
    replacing ||
    importing ||
    opening ||
    creatingChapter ||
    deletingChapter ||
    switchingChapter ||
    projectTask !== null;

  useEffect(() => {
    if (!projectPath || !activeChapterId) return;
    let active = true;
    void window.drelwick.project
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
      const result = await window.drelwick.project.saveChapter({
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
      if (
        !pending.current &&
        !isDocumentDirty(documentRef.current) &&
        !savePending.current
      )
        return;
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
    return window.drelwick.onShutdownRequested(async () => {
      if (pending.current) {
        setError("Wait for the current project operation before closing.");
        return false;
      }
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
    const find = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "f" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        setFindRequest((request) => request + 1);
      }
    };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, []);

  async function replaceAll(input: ReplacementRequest): Promise<boolean> {
    if (
      pending.current ||
      changingDocument ||
      !documentReady ||
      replacementRecoveryRequired
    )
      return false;
    pending.current = true;
    replacementCancelled.current = false;
    setReplacing(true);
    setError("");
    try {
      const saved = await autosave.current?.flush();
      if (
        !saved ||
        savePending.current ||
        isDocumentDirty(documentRef.current)
      ) {
        setError(
          "Unable to save pending edits. Replacement did not start; your edits remain in the editor.",
        );
        return false;
      }
      if (replacementCancelled.current) return false;
      const result = await window.drelwick.project.replaceManuscript(input);
      if (!result.ok) {
        setError(result.error.message);
        if (result.error.code === "REPLACEMENT_RECOVERY_REQUIRED")
          setReplacementRecoveryRequired(true);
        return false;
      }
      setDocumentSession((session) => session + 1);
      setSearchRefresh((value) => value + 1);
      const wordCounts = new Map(
        input.expected.map((chapter) => [
          chapter.id,
          countDocumentWords(
            replaceMatches(
              chapter.id,
              chapter.content,
              input.options,
              searchChapter(chapter.id, chapter.content, input.options),
              input.replacement,
            ),
          ),
        ]),
      );
      setProject((current) =>
        current
          ? {
              ...current,
              chapters: current.chapters.map((chapter) => ({
                ...chapter,
                wordCount: wordCounts.get(chapter.id) ?? chapter.wordCount,
              })),
            }
          : current,
      );
      setProjectMessage(
        `Replaced ${result.value.matches} matches in ${result.value.chapters} changed chapters. Pre-replacement history retained.`,
      );
      return true;
    } catch {
      setReplacementRecoveryRequired(true);
      setError(
        "Replacement outcome could not be confirmed. Preserve the project and reopen to resolve recovery before editing.",
      );
      return false;
    } finally {
      pending.current = false;
      setReplacing(false);
    }
  }

  useEffect(() => {
    const unsubscribe = window.drelwick.onSaveRequested(saveActiveChapter);
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

  const canLeaveChapter = useCallback(() => {
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
  }, [changingDocument]);

  async function selectChapter(chapterId: string) {
    if (
      pending.current ||
      replacing ||
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
    void window.drelwick.project
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

  const refreshRecents = useCallback(async () => {
    try {
      const result = await window.drelwick.project.listRecent();
      if (result.ok) {
        setRecents(result.value);
        setRecentError("");
      } else setRecentError(result.error.message);
    } catch {
      setRecentError("Unable to load recent projects. Please try again.");
    }
  }, []);

  async function removeRecent(id: string) {
    if (pending.current || creating || loadingRecents) return;
    pending.current = true;
    setLoadingRecents(true);
    setRecentError("");
    try {
      const result = await window.drelwick.project.removeRecent(id);
      if (result.ok) setRecents(result.value);
      else setRecentError(result.error.message);
    } catch {
      setRecentError("Unable to remove the recent entry. Please try again.");
    } finally {
      pending.current = false;
      setLoadingRecents(false);
    }
  }

  const openExistingProject = useCallback(
    async (id?: string) => {
      if (pending.current || creating || loadingRecents || !canLeaveChapter())
        return;
      pending.current = true;
      setOpening(true);
      setError("");
      try {
        const result = await (id
          ? window.drelwick.project.openRecent(id)
          : window.drelwick.project.open());
        if (!result.ok) setError(result.error.message);
        else if (result.value) {
          setReplacementRecoveryRequired(false);
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
    },
    [canLeaveChapter, creating, loadingRecents, refreshRecents],
  );

  const closeCurrentProject = useCallback(async () => {
    if (!project || pending.current || creating || !canLeaveChapter()) return;
    pending.current = true;
    setError("");
    try {
      const result = await window.drelwick.project.close();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setProject(null);
      setActiveChapterId(null);
      setDocumentSession((session) => session + 1);
    } catch {
      setError("Unable to close the project. Please try again.");
    } finally {
      pending.current = false;
    }
  }, [canLeaveChapter, creating, project]);

  const backupCurrentProject = useCallback(async () => {
    if (!project) {
      setError("Open a project before creating a backup.");
      return;
    }
    if (pending.current || opening || creating || projectTask) return;
    const includeHistory = window.confirm(
      "Include saved version history in this project backup?",
    );
    pending.current = true;
    setProjectTask("backup");
    setProjectMessage("");
    setError("");
    try {
      if (activeChapterId && !documentReady) {
        setError(
          "Wait for the selected chapter to finish loading before creating a backup.",
        );
        return;
      }
      if (savePending.current || isDocumentDirty(documentRef.current)) {
        const saved = await autosave.current?.flush();
        if (
          !saved ||
          savePending.current ||
          isDocumentDirty(documentRef.current)
        ) {
          setError(
            "Unable to save the current chapter. Your edits remain open; retry the backup after saving.",
          );
          return;
        }
      }
      const result = await window.drelwick.project.backup({ includeHistory });
      if (!result.ok) setError(result.error.message);
      else if (result.value.created)
        setProjectMessage("Project backup created successfully.");
    } catch {
      setError(
        "Unable to create the project backup. Your project remains open; please try again.",
      );
    } finally {
      pending.current = false;
      setProjectTask(null);
    }
  }, [activeChapterId, creating, documentReady, opening, project, projectTask]);

  const restoreProject = useCallback(async () => {
    if (pending.current || opening || creating || projectTask) return;
    pending.current = true;
    setProjectTask("restore");
    setProjectMessage("");
    setError("");
    try {
      if (project && activeChapterId && !documentReady) {
        setError(
          "Wait for the selected chapter to finish loading before restoring a backup.",
        );
        return;
      }
      if (
        project &&
        (savePending.current || isDocumentDirty(documentRef.current))
      ) {
        const saved = await autosave.current?.flush();
        if (
          !saved ||
          savePending.current ||
          isDocumentDirty(documentRef.current)
        ) {
          setError(
            "Unable to save the current chapter. Your edits remain open; retry the restore after saving.",
          );
          return;
        }
      }
      const result = await window.drelwick.project.restore();
      if (!result.ok) setError(result.error.message);
      else if (result.value) {
        setReplacementRecoveryRequired(false);
        setProject(result.value);
        setDocumentSession((session) => session + 1);
        setActiveChapterId(result.value.chapters[0]?.id ?? null);
        setProjectMessage(
          `Restored “${result.value.title}” as a separate project.`,
        );
        if (result.warning) setRecentError(result.warning);
        await refreshRecents();
      }
    } catch {
      setError(
        "Unable to restore the project backup. The current project remains open; please try again.",
      );
    } finally {
      pending.current = false;
      setProjectTask(null);
    }
  }, [
    activeChapterId,
    creating,
    documentReady,
    opening,
    project,
    projectTask,
    refreshRecents,
  ]);

  const startImport = useCallback(() => {
    if (
      pending.current ||
      creating ||
      loadingRecents ||
      (activeChapterId && !documentReady) ||
      !canLeaveChapter()
    )
      return;
    pending.current = true;
    setError("");
    setImporting(true);
  }, [
    creating,
    loadingRecents,
    activeChapterId,
    documentReady,
    canLeaveChapter,
  ]);
  const endImport = useCallback((message?: string) => {
    pending.current = false;
    setImporting(false);
    if (message) setProjectMessage(message);
  }, []);

  useEffect(() => {
    return window.drelwick.onApplicationMenuCommand((command) => {
      if (command === "find-manuscript") {
        setFindRequest((request) => request + 1);
      } else if (command === "new-project") {
        if (
          pending.current ||
          opening ||
          creating ||
          loadingRecents ||
          !canLeaveChapter()
        )
          return;
        setError("");
        setCreating(true);
      } else if (command === "import-manuscript") {
        startImport();
      } else if (command === "open-project") {
        void openExistingProject();
      } else if (command === "close-project") {
        void closeCurrentProject();
      } else if (command === "backup-project") {
        void backupCurrentProject();
      } else {
        void restoreProject();
      }
    });
  }, [
    canLeaveChapter,
    startImport,
    backupCurrentProject,
    closeCurrentProject,
    creating,
    loadingRecents,
    openExistingProject,
    opening,
    restoreProject,
  ]);

  useEffect(() => {
    if (!searchEditor) return;
    const update = () => {
      try {
        if (!searchEditor.state.selection.empty) throw new Error();
        const position = searchEditor.state.selection.from;
        splitChapterDocument(searchEditor.getJSON(), position);
        setSplitPosition(position);
      } catch {
        setSplitPosition(null);
      }
    };
    update();
    searchEditor.on("selectionUpdate", update);
    searchEditor.on("update", update);
    return () => {
      searchEditor.off("selectionUpdate", update);
      searchEditor.off("update", update);
    };
  }, [searchEditor]);

  async function organise(command: ChapterOrganisationRequest) {
    if (
      pending.current ||
      changingDocument ||
      reordering ||
      renamingChapterId ||
      replacementRecoveryRequired ||
      !documentReady
    )
      return;
    pending.current = true;
    setOrganising(true);
    setError("");
    try {
      const saved = await autosave.current?.flush();
      if (
        !saved ||
        savePending.current ||
        isDocumentDirty(documentRef.current)
      ) {
        setError(
          "Unable to save pending edits. Chapter organisation did not start; your edits remain in the editor.",
        );
        return;
      }
      const result = await window.drelwick.project.organiseChapter(command);
      if (!result.ok) {
        setError(result.error.message);
        if (result.error.code === "CHAPTER_RECOVERY_REQUIRED")
          setReplacementRecoveryRequired(true);
        return;
      }
      setProject(result.value.workspace);
      setMergeSelection([]);
      if (command.operation !== "status") {
        setDocumentSession((session) => session + 1);
        setActiveChapterId(result.value.chapterId);
        setSearchRefresh((value) => value + 1);
      }
    } catch {
      setReplacementRecoveryRequired(true);
      setError(
        "The chapter operation outcome could not be confirmed. Reopen the project before editing.",
      );
    } finally {
      pending.current = false;
      setOrganising(false);
    }
  }

  const organisationBase = project
    ? {
        projectId: project.projectId,
        expectedOrder: project.chapters.map((chapter) => chapter.id),
      }
    : null;
  const selectedForMerge =
    project?.chapters.filter((chapter) =>
      mergeSelection.includes(chapter.id),
    ) ?? [];
  const mergeAdjacent =
    selectedForMerge.length === 2 &&
    project!.chapters.indexOf(selectedForMerge[1]!) ===
      project!.chapters.indexOf(selectedForMerge[0]!) + 1;
  const organisationDisabled =
    changingDocument ||
    reordering ||
    Boolean(renamingChapterId) ||
    !documentReady ||
    replacementRecoveryRequired;

  async function renameSelectedChapter() {
    if (pending.current || replacing) return;
    if (!project || !editingChapterId || !chapterTitle.trim()) return;
    setRenamingChapterId(editingChapterId);
    setError("");
    try {
      const result = await window.drelwick.project.renameChapter({
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
      const result = await window.drelwick.project.deleteChapter({
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
    if (pending.current || replacing) return;
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
      const result = await window.drelwick.project.reorderChapters({
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
      const result = await window.drelwick.project.createChapter({
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
    if (pending.current || replacing) return;
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
      const result = await window.drelwick.project.reorderChapters({
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
          disabled={
            opening || creating || loadingRecents || projectTask !== null
          }
          onClick={() => {
            setError("");
            setCreating(true);
          }}
        >
          New project
        </button>
      )}
      <button
        disabled={opening || creating || loadingRecents || projectTask !== null}
        onClick={() => {
          void openExistingProject();
        }}
      >
        {projectTask === "backup"
          ? "Creating backup…"
          : projectTask === "restore"
            ? "Restoring backup…"
            : opening
              ? "Opening project…"
              : "Open project"}
      </button>
      <button
        disabled={
          importing ||
          opening ||
          creating ||
          loadingRecents ||
          projectTask !== null
        }
        onClick={startImport}
      >
        Import manuscript
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

  const content = (
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
              <ManuscriptSearch
                key={project.projectId}
                project={project}
                active={
                  documentReady && documentState
                    ? {
                        id: documentState.chapterId,
                        content: documentState.content,
                      }
                    : null
                }
                editor={documentReady ? searchEditor : null}
                focusRequest={findRequest}
                busy={replacing}
                refresh={searchRefresh}
                navigate={selectChapter}
                replace={replaceAll}
                cancel={() => {
                  replacementCancelled.current = true;
                  void window.drelwick.project.cancelReplacement();
                }}
              />
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              {projectMessage && (
                <p className="success-message" role="status">
                  {projectMessage}
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
              <div className="chapter-organisation">
                <button
                  disabled={organisationDisabled || !mergeAdjacent}
                  onClick={() => {
                    const first = selectedForMerge[0];
                    const second = selectedForMerge[1];
                    if (
                      !first ||
                      !second ||
                      !organisationBase ||
                      !mergeAdjacent
                    )
                      return;
                    if (
                      window.confirm(
                        `Merge “${first.title}” followed by “${second.title}”? Keep the first chapter's title and status. The second chapter will be removed; pre-merge history will be retained.`,
                      )
                    )
                      void organise({
                        ...organisationBase,
                        operation: "merge",
                        chapterIds: [first.id, second.id],
                        confirmed: true,
                      });
                  }}
                >
                  Merge selected chapters
                </button>
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
                    <input
                      type="checkbox"
                      aria-label={`Select ${chapter.title} for merge`}
                      checked={mergeSelection.includes(chapter.id)}
                      disabled={
                        organisationDisabled ||
                        (mergeSelection.length >= 2 &&
                          !mergeSelection.includes(chapter.id))
                      }
                      onChange={(event) =>
                        setMergeSelection((current) =>
                          event.target.checked
                            ? [...current, chapter.id]
                            : current.filter((id) => id !== chapter.id),
                        )
                      }
                    />
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
                            disabled={organisationDisabled}
                            onClick={() => {
                              if (organisationBase)
                                void organise({
                                  ...organisationBase,
                                  operation: "duplicate",
                                  chapterId: chapter.id,
                                });
                            }}
                          >
                            Duplicate
                          </button>
                          <button
                            disabled={
                              organisationDisabled ||
                              activeChapterId !== chapter.id ||
                              splitPosition === null
                            }
                            onClick={() => {
                              if (
                                !organisationBase ||
                                !searchEditor ||
                                splitPosition === null ||
                                !searchEditor.state.selection.empty ||
                                searchEditor.state.selection.from !==
                                  splitPosition
                              )
                                return;
                              const expectedContent = searchEditor.getJSON();
                              if (
                                window.confirm(
                                  `Split “${chapter.title}” at the current cursor? A new chapter will contain everything after the cursor. Both chapters keep the current status.`,
                                )
                              )
                                void organise({
                                  ...organisationBase,
                                  operation: "split",
                                  chapterId: chapter.id,
                                  position: splitPosition,
                                  expectedContent,
                                });
                            }}
                          >
                            Split at cursor
                          </button>
                          <label>
                            Status
                            <select
                              aria-label={`Status for ${chapter.title}`}
                              value={chapter.status}
                              disabled={organisationDisabled}
                              onChange={(event) => {
                                const status = ChapterStatusSchema.safeParse(
                                  event.target.value,
                                );
                                if (organisationBase && status.success)
                                  void organise({
                                    ...organisationBase,
                                    operation: "status",
                                    chapterId: chapter.id,
                                    status: status.data,
                                  });
                              }}
                            >
                              {ChapterStatusSchema.options.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </label>
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
                    onReady={setSearchEditor}
                    projectId={project.projectId}
                    prepareImageImport={async () =>
                      (await autosave.current?.flush()) ?? true
                    }
                    {...(activeChapterId ? { chapterId: activeChapterId } : {})}
                    key={chapterKey}
                    editable={!changingDocument && !replacementRecoveryRequired}
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
        <main className="app-shell" aria-busy={opening || projectTask !== null}>
          <header className="app-header">
            <p className="eyebrow">
              <WorkspaceIcon name="book" /> Drelwick · Your words, your world
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
          {projectMessage && (
            <p className="success-message" role="status">
              {projectMessage}
            </p>
          )}
          {recentProjects}
        </main>
      )}
      {importing && (
        <ImportManuscriptDialog
          onCancel={endImport}
          beforeOpen={async () => {
            const saved = (await autosave.current?.flush()) ?? true;
            return (
              saved &&
              !savePending.current &&
              !isDocumentDirty(documentRef.current)
            );
          }}
          onOpened={(opened, warning) => {
            setReplacementRecoveryRequired(false);
            setProject(opened);
            setDocumentSession((session) => session + 1);
            setActiveChapterId(opened.chapters[0]?.id ?? null);
            endImport();
            if (warning) setRecentError(warning);
            void refreshRecents();
          }}
        />
      )}
      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreated={(created, warning) => {
            setReplacementRecoveryRequired(false);
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

  return (
    <RendererErrorBoundary preserveWorkspaceState>
      {content}
    </RendererErrorBoundary>
  );
}
