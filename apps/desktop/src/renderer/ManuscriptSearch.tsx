import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import {
  searchManuscript,
  type SearchMatch,
} from "@drelwick/core/manuscript-search";
import type {
  ChapterContent,
  ProjectWorkspace,
  ReplacementRequest,
} from "@drelwick/shared";

interface Props {
  project: ProjectWorkspace;
  active: ChapterContent | null;
  editor: Editor | null;
  focusRequest: number;
  busy: boolean;
  refresh: number;
  navigate(id: string): Promise<void>;
  replace(input: ReplacementRequest): Promise<boolean>;
  cancel(): void;
}

export function ManuscriptSearch({
  project,
  active,
  editor,
  focusRequest,
  busy,
  refresh,
  navigate,
  replace,
  cancel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [scope, setScope] = useState<"chapter" | "manuscript">("chapter");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [chapters, setChapters] = useState<ChapterContent[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SearchMatch | null>(null);
  const [selectedDocument, setSelectedDocument] = useState("");
  const appliedSelection = useRef<SearchMatch | null>(null);
  const selectedEditorDocument = useRef("");
  const [review, setReview] = useState<ReplacementRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const order = JSON.stringify(project.chapters.map((chapter) => chapter.id));
  const loadKey = JSON.stringify([
    project.projectId,
    order,
    refresh,
    open,
    active?.id,
  ]);

  useEffect(() => {
    if (!focusRequest) return;
    const timer = setTimeout(() => {
      setOpen(true);
      setTimeout(() => input.current?.focus(), 0);
    }, 0);
    return () => clearTimeout(timer);
  }, [focusRequest]);
  useEffect(() => {
    if (!open) return;
    let valid = true;
    void (async () => {
      const loaded: ChapterContent[] = [];
      for (const id of JSON.parse(order) as string[]) {
        const result = await window.drelwick.project.loadChapter({
          chapterId: id,
        });
        if (!valid) return;
        if (!result.ok) throw new Error("Chapter read failed.");
        loaded.push(result.value);
      }
      if (valid) {
        setChapters(loaded);
        setLoadedKey(loadKey);
        setError("");
      }
    })().catch(() => {
      if (valid)
        setError(
          "Unable to read the manuscript. Close and reopen Find to retry.",
        );
    });
    return () => {
      valid = false;
    };
  }, [order, loadKey, open]);

  const options = useMemo(
    () => ({ query, matchCase, wholeWord }),
    [query, matchCase, wholeWord],
  );
  const documents = useMemo(
    () =>
      scope === "chapter"
        ? active
          ? [active]
          : []
        : chapters.map((chapter) =>
            chapter.id === active?.id ? active : chapter,
          ),
    [scope, chapters, active],
  );
  const ready = !!active && (scope === "chapter" || loadedKey === loadKey);
  const matches = useMemo(
    () => (ready ? searchManuscript(documents, options) : []),
    [ready, documents, options],
  );
  const selectionValid =
    selectedDocument ===
    JSON.stringify(
      documents.find((chapter) => chapter.id === selected?.chapterId)?.content,
    );
  const index = selectionValid
    ? matches.findIndex(
        (match) =>
          match.chapterId === selected?.chapterId &&
          match.from === selected.from &&
          match.to === selected.to,
      )
    : -1;
  const current = index < 0 ? null : matches[index]!;
  const affected = new Set(matches.map((match) => match.chapterId)).size;
  const staleReview =
    review !== null &&
    (JSON.stringify(review.expected) !== JSON.stringify(documents) ||
      JSON.stringify(review.options) !== JSON.stringify(options) ||
      review.replacement !== replacement ||
      review.chapterId !== (scope === "chapter" ? active?.id : undefined));

  useEffect(() => {
    if (
      !selected ||
      !selectionValid ||
      selected === appliedSelection.current ||
      selected.chapterId !== active?.id ||
      !editor ||
      editor.isDestroyed
    )
      return;
    const found = searchManuscript([active], options).find(
      (match) => match.from === selected.from && match.to === selected.to,
    );
    if (found) {
      editor
        .chain()
        .setTextSelection({ from: found.from, to: found.to })
        .scrollIntoView()
        .run();
      appliedSelection.current = selected;
      selectedEditorDocument.current = JSON.stringify(editor.getJSON());
    }
  }, [selected, selectionValid, active, editor, options]);

  async function move(direction: number) {
    if (!matches.length || busy) return;
    const next =
      matches[
        index < 0
          ? direction > 0
            ? 0
            : matches.length - 1
          : (index + direction + matches.length) % matches.length
      ]!;
    setSelected(next);
    setSelectedDocument(
      JSON.stringify(
        documents.find((chapter) => chapter.id === next.chapterId)?.content,
      ),
    );
    if (next.chapterId !== active?.id) await navigate(next.chapterId);
    else
      editor
        ?.chain()
        .setTextSelection({ from: next.from, to: next.to })
        .scrollIntoView()
        .run();
  }
  function replaceOne() {
    if (
      !current ||
      current.chapterId !== active?.id ||
      !editor ||
      editor.isDestroyed ||
      !editor.isEditable ||
      busy
    )
      return;
    // Read the live editor again; React state can lag a synchronous transaction.
    const fresh = searchManuscript(
      [{ id: active.id, content: editor.getJSON() }],
      options,
    ).find((match) => match.from === current.from && match.to === current.to);
    if (
      !fresh ||
      JSON.stringify(editor.getJSON()) !== selectedEditorDocument.current
    )
      return;
    const marks = editor.state.doc.nodeAt(fresh.from)?.marks ?? [];
    const transaction = closeHistory(editor.state.tr);
    if (replacement)
      transaction.replaceWith(
        fresh.from,
        fresh.to,
        editor.schema.text(replacement, marks),
      );
    else transaction.delete(fresh.from, fresh.to);
    editor.view.dispatch(transaction.scrollIntoView());
    setSelected(null);
    setReview(null);
  }
  if (!open)
    return (
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => input.current?.focus(), 0);
        }}
      >
        Find and replace
      </button>
    );
  return (
    <section
      aria-label="Manuscript find and replace"
      className="manuscript-search"
    >
      <fieldset disabled={busy}>
        <legend>Find and replace</legend>
        <label>
          Find text{" "}
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void move(event.shiftKey ? -1 : 1);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setReview(null);
                editor?.commands.focus();
              }
            }}
          />
        </label>
        <label>
          Search scope{" "}
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as typeof scope);
              setSelected(null);
            }}
          >
            <option value="chapter">Current chapter</option>
            <option value="manuscript">Whole manuscript</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(event) => setMatchCase(event.target.checked)}
          />
          Match case
        </label>
        <label>
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(event) => setWholeWord(event.target.checked)}
          />
          Whole word
        </label>
        <button disabled={!matches.length} onClick={() => void move(-1)}>
          Previous match
        </button>
        <button disabled={!matches.length} onClick={() => void move(1)}>
          Next match
        </button>
        <p role="status">
          {ready
            ? `${index + 1} of ${matches.length} matches · ${scope === "chapter" ? "Current chapter" : "Whole manuscript"}`
            : active
              ? "Loading manuscript…"
              : "Select a chapter to search."}
        </p>
        <label>
          Replacement text{" "}
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
        </label>
        <button
          disabled={!current || current.chapterId !== active?.id}
          onClick={replaceOne}
        >
          Replace one
        </button>
        <button
          disabled={!matches.length}
          onClick={() =>
            setReview({
              options,
              replacement,
              expected: documents,
              ...(scope === "chapter" && active
                ? { chapterId: active.id }
                : {}),
            })
          }
        >
          Review replace all
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setReview(null);
            editor?.commands.focus();
          }}
        >
          Close find
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {review && (
        <div role="region" aria-label="Review replacement">
          <p>
            Replace {JSON.stringify(review.options.query)} with{" "}
            {JSON.stringify(review.replacement)} in{" "}
            {review.chapterId ? "current chapter" : "whole manuscript"}:{" "}
            {matches.length} matches in {affected} chapters.
          </p>
          <p>
            A pre-replacement history snapshot is retained. Cancellation during
            writes restores the original chapters.
          </p>
          {staleReview && (
            <p role="alert">
              The manuscript or options changed. Review again before replacing.
            </p>
          )}
          <button
            disabled={busy || staleReview || !ready}
            onClick={() => {
              void replace(review).then((success) => {
                if (success) {
                  setReview(null);
                  setSelected(null);
                }
              });
            }}
          >
            Confirm replace all
          </button>
          <button disabled={busy} onClick={() => setReview(null)}>
            Cancel review
          </button>
        </div>
      )}
      {busy && <button onClick={cancel}>Cancel replacement</button>}
    </section>
  );
}
