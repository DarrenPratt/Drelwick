import { describe, expect, it } from "vitest";
import {
  documentReducer,
  isDocumentDirty,
  type DocumentState,
} from "../src/renderer/document-state.js";

const content = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
function loaded(key = "session:chapter"): DocumentState {
  return documentReducer(null, {
    type: "loaded",
    key,
    chapterId: "chapter",
    content: content("Original"),
  })!;
}
function edit(state: DocumentState, text = "Edited"): DocumentState {
  return documentReducer(state, {
    type: "edited",
    key: state.key,
    content: content(text),
  })!;
}
function save(state: DocumentState, requestId: number): DocumentState {
  return documentReducer(state, {
    type: "saving",
    key: state.key,
    requestId,
    revision: state.editorRevision,
  })!;
}

describe("document revisions", () => {
  it("retains newer mapping evidence across an earlier save and preserves all evidence on failure", () => {
    const first = {
      before: content("Original"),
      steps: [{ stepType: "replace", from: 1, to: 1 }],
    };
    const second = {
      before: content("First"),
      steps: [{ stepType: "addMark", from: 1, to: 3, mark: { type: "bold" } }],
    };
    let state = documentReducer(loaded(), {
      type: "edited",
      key: "session:chapter",
      content: content("First"),
      transaction: first,
    })!;
    state = save(state, 1);
    state = documentReducer(state, {
      type: "edited",
      key: state.key,
      content: content("Second"),
      transaction: second,
    })!;
    const evidence = state.transactions;
    state = documentReducer(state, {
      type: "failed",
      key: state.key,
      requestId: 1,
      message: "failed",
    })!;
    expect(state.transactions).toEqual(evidence);
    state = documentReducer(state, {
      type: "saving",
      key: state.key,
      requestId: 2,
      revision: 1,
    })!;
    state = documentReducer(state, {
      type: "saved",
      key: state.key,
      requestId: 2,
    })!;
    expect(state.transactions).toEqual([{ revision: 2, transaction: second }]);
    expect(state.content).toEqual(content("Second"));
    expect(isDocumentDirty(state)).toBe(true);
  });
  it("starts clean and clears only a successfully persisted revision", () => {
    let state = loaded();
    expect(isDocumentDirty(null)).toBe(false);
    expect(isDocumentDirty(state)).toBe(false);
    state = edit(state);
    expect(state.editorRevision).toBe(1);
    expect(isDocumentDirty(state)).toBe(true);
    state = save(state, 1);
    state = documentReducer(state, {
      type: "saved",
      key: state.key,
      requestId: 1,
    })!;
    expect(state.savedRevision).toBe(1);
    expect(isDocumentDirty(state)).toBe(false);
  });

  it("acknowledges the captured revision without replacing edits made during a save", () => {
    let state = save(edit(loaded()), 1);
    state = edit(state, "Newer changes");
    const newestContent = state.content;
    state = documentReducer(state, {
      type: "saved",
      key: state.key,
      requestId: 1,
    })!;
    expect(state).toMatchObject({
      savedRevision: 1,
      editorRevision: 2,
      pendingSave: null,
    });
    expect(state.content).toBe(newestContent);
    expect(isDocumentDirty(state)).toBe(true);
    state = save(state, 2);
    state = documentReducer(state, {
      type: "saved",
      key: state.key,
      requestId: 2,
    })!;
    expect(isDocumentDirty(state)).toBe(false);
  });

  it("keeps failures dirty and ignores old success/failure acknowledgements during retry", () => {
    let state = save(edit(loaded()), 1);
    state = edit(state);
    state = documentReducer(state, {
      type: "failed",
      key: state.key,
      requestId: 1,
      message: "Try again",
    })!;
    expect(state.savedRevision).toBe(0);
    expect(isDocumentDirty(state)).toBe(true);
    state = save(state, 2);
    expect(
      documentReducer(state, { type: "saved", key: state.key, requestId: 1 }),
    ).toBe(state);
    expect(
      documentReducer(state, {
        type: "failed",
        key: state.key,
        requestId: 1,
        message: "Stale failure",
      }),
    ).toBe(state);
    expect(state.pendingSave?.requestId).toBe(2);
  });

  it("ignores another chapter or project session's acknowledgements", () => {
    const state = save(edit(loaded("second-session:chapter")), 2);
    expect(
      documentReducer(state, {
        type: "saved",
        key: "first-session:chapter",
        requestId: 2,
      }),
    ).toBe(state);
    expect(
      documentReducer(state, {
        type: "edited",
        key: "another-chapter",
        content: content("Stale update"),
      }),
    ).toBe(state);
    expect(
      documentReducer(null, { type: "saved", key: state.key, requestId: 2 }),
    ).toBeNull();
    expect(isDocumentDirty(state)).toBe(true);
  });

  it("does not permit overlapping saves or acknowledge nonexistent future revisions", () => {
    const state = save(edit(loaded()), 1);
    expect(save(state, 2)).toBe(state);
    const clean = loaded();
    expect(
      documentReducer(clean, {
        type: "saving",
        key: clean.key,
        requestId: 1,
        revision: 99,
      }),
    ).toBe(clean);
    const saved = documentReducer(state, {
      type: "saved",
      key: state.key,
      requestId: 1,
    })!;
    expect(
      documentReducer(saved, {
        type: "saving",
        key: saved.key,
        requestId: 2,
        revision: 0,
      }),
    ).toBe(saved);
    expect(
      documentReducer(saved, { type: "saved", key: saved.key, requestId: 1 }),
    ).toBe(saved);
  });

  it("preserves commit warnings while acknowledging the persisted revision", () => {
    const state = save(edit(loaded()), 1);
    const saved = documentReducer(state, {
      type: "saved",
      key: state.key,
      requestId: 1,
      warning: "Inspect the operation lock",
    })!;
    expect(saved.message).toBe("Inspect the operation lock");
    expect(isDocumentDirty(saved)).toBe(false);
  });
});
