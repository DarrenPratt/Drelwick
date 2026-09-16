import type { JSONContent } from "@tiptap/core";

export interface DocumentState {
  key: string;
  chapterId: string;
  content: JSONContent;
  editorRevision: number;
  savedRevision: number;
  pendingSave: { requestId: number; revision: number } | null;
  error: string;
  message: string;
}

export type DocumentAction =
  | { type: "loaded"; key: string; chapterId: string; content: JSONContent }
  | { type: "edited"; key: string; content: JSONContent }
  | { type: "saving"; key: string; requestId: number; revision: number }
  | { type: "saved"; key: string; requestId: number; warning?: string }
  | { type: "failed"; key: string; requestId: number; message: string };

export function isDocumentDirty(state: DocumentState | null): boolean {
  return state !== null && state.editorRevision !== state.savedRevision;
}

/** Each acknowledgement belongs to one request and one loaded chapter session. */
export function documentReducer(
  state: DocumentState | null,
  action: DocumentAction,
): DocumentState | null {
  if (action.type === "loaded") {
    return {
      key: action.key,
      chapterId: action.chapterId,
      content: action.content,
      editorRevision: 0,
      savedRevision: 0,
      pendingSave: null,
      error: "",
      message: "",
    };
  }
  if (!state || state.key !== action.key) return state;
  if (action.type === "edited") {
    return {
      ...state,
      content: action.content,
      editorRevision: state.editorRevision + 1,
      message: "",
    };
  }
  if (action.type === "saving") {
    if (
      state.pendingSave ||
      action.revision > state.editorRevision ||
      action.revision < state.savedRevision
    )
      return state;
    return {
      ...state,
      pendingSave: { requestId: action.requestId, revision: action.revision },
      error: "",
      message: "",
    };
  }
  if (state.pendingSave?.requestId !== action.requestId) return state;
  if (action.type === "failed") {
    return { ...state, pendingSave: null, error: action.message };
  }
  const savedRevision = state.pendingSave.revision;
  return {
    ...state,
    savedRevision,
    pendingSave: null,
    error: "",
    message:
      action.warning ??
      (state.editorRevision === savedRevision
        ? "Chapter saved."
        : "Earlier edits saved. Newer changes are still unsaved."),
  };
}
