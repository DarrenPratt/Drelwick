import type { JSONContent } from "@tiptap/core";

export interface CapturedManuscriptTransaction {
  before: JSONContent;
  steps: Record<string, unknown>[];
}

function boundedTransactions(
  items: DocumentState["transactions"],
): DocumentState["transactions"] {
  if (items.length <= 128 && JSON.stringify(items).length * 2 <= 8 * 1024 ** 2)
    return items;
  // An explicit missing-map marker forces safe invalidation; never pretend a
  // truncated sequence proves attachment. Manuscript content stays available.
  return [{ revision: items.at(-1)!.revision, transaction: null }];
}

export interface DocumentState {
  key: string;
  chapterId: string;
  content: JSONContent;
  editorRevision: number;
  savedRevision: number;
  transactions: {
    revision: number;
    transaction: CapturedManuscriptTransaction | null;
  }[];
  pendingSave: { requestId: number; revision: number } | null;
  error: string;
  message: string;
}

export type DocumentAction =
  | { type: "loaded"; key: string; chapterId: string; content: JSONContent }
  | {
      type: "edited";
      key: string;
      content: JSONContent;
      transaction?: CapturedManuscriptTransaction;
    }
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
      transactions: [],
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
      transactions: boundedTransactions([
        ...state.transactions,
        {
          revision: state.editorRevision + 1,
          transaction: action.transaction ?? null,
        },
      ]),
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
    transactions: state.transactions.filter(
      (item) => item.revision > savedRevision,
    ),
    pendingSave: null,
    error: "",
    message:
      action.warning ??
      (state.editorRevision === savedRevision
        ? "Chapter saved."
        : "Earlier edits saved. Newer changes are still unsaved."),
  };
}
