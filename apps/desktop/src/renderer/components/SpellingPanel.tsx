import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import {
  SpellingWordSchema,
  type SpellingState,
  type SpellingUpdate,
} from "@drelwick/shared";
import {
  replaceSpelling,
  spellingWords,
  type SpellingOccurrence,
} from "./spelling-document.js";

const failure =
  "Local spelling settings or resources are unavailable. Editing remains available. Retry or check the application installation and spelling.json.";

export function SpellingPanel({
  editor,
  editable,
}: {
  editor: Editor;
  editable: boolean;
}) {
  const [settings, setSettings] = useState<SpellingState>();
  const [message, setMessage] = useState(
    "Choose Check chapter to review spelling offline.",
  );
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [word, setWord] = useState("");
  const [review, setReview] = useState<{
    doc: Node;
    occurrences: SpellingOccurrence[];
  }>();
  const [suggestions, setSuggestions] = useState<string[]>();
  const generation = useRef(0);
  const mounted = useRef(false);
  const current = review?.occurrences[0];
  const available = settings?.languages.some(
    (language) => language.id === settings.language && language.available,
  );
  const locked = busy || saving;

  useEffect(() => {
    mounted.current = true;
    generation.current++;
    let cancelled = false;
    const changed = ({
      transaction,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (!transaction.docChanged) return;
      generation.current++;
      setReview(undefined);
      setSuggestions(undefined);
      setBusy(false);
      setMessage(
        "Chapter changed. Check chapter again to review current text.",
      );
    };
    editor.on("transaction", changed);
    void window.drelwick.spelling
      .get()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setSettings(result.value);
        else setMessage(failure);
      })
      .catch(() => {
        if (!cancelled) setMessage(failure);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      editor.off("transaction", changed);
    };
  }, [editor]);

  async function update(input: SpellingUpdate) {
    generation.current++;
    setReview(undefined);
    setSuggestions(undefined);
    setSaving(true);
    try {
      const result = await window.drelwick.spelling.update(input);
      if (!mounted.current) return;
      if (!result.ok) {
        setMessage(failure);
        return;
      }
      setSettings(result.value);
      setMessage(
        "Spelling settings saved locally. Check chapter to review spelling.",
      );
      if (input.operation === "add") setWord("");
    } catch {
      if (mounted.current) setMessage(failure);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function check() {
    if (!settings || !available) return;
    const id = ++generation.current;
    const doc = editor.state.doc;
    setBusy(true);
    setReview(undefined);
    setSuggestions(undefined);
    setMessage("Checking this chapter locally…");
    const { words, skipped } = spellingWords(doc);
    const unique = [...new Set(words.map((entry) => entry.word))];
    const incorrect = new Set<string>();
    try {
      for (let offset = 0; offset < unique.length; offset += 256) {
        const result = await window.drelwick.spelling.check({
          language: settings.language,
          words: unique.slice(offset, offset + 256),
        });
        if (!mounted.current || generation.current !== id) return;
        if (!result.ok || !result.value.available) {
          setMessage(failure);
          return;
        }
        for (const value of result.value.incorrect) incorrect.add(value);
      }
      if (!mounted.current || generation.current !== id) return;
      const occurrences = words.filter((entry) => incorrect.has(entry.word));
      setReview({ doc, occurrences });
      setMessage(
        `${occurrences.length} possible spelling errors.${skipped ? ` ${skipped} words over 128 characters were skipped.` : ""}`,
      );
    } catch {
      if (mounted.current && generation.current === id) setMessage(failure);
    } finally {
      if (mounted.current && generation.current === id) setBusy(false);
    }
  }

  async function suggest() {
    if (!current || !settings) return;
    const id = ++generation.current;
    setBusy(true);
    try {
      const result = await window.drelwick.spelling.suggest({
        language: settings.language,
        word: current.word,
      });
      if (!mounted.current || generation.current !== id) return;
      if (result.ok) setSuggestions(result.value);
      else setMessage(failure);
    } catch {
      if (mounted.current && generation.current === id) setMessage(failure);
    } finally {
      if (mounted.current && generation.current === id) setBusy(false);
    }
  }

  return (
    <section className="spelling-panel" aria-label="Offline spelling">
      <p>
        Offline spelling · personal dictionary on this device. No text is sent
        online.
      </p>
      {settings ? (
        <>
          <label>
            Spelling language{" "}
            <select
              aria-label="Spelling language"
              value={settings.language}
              disabled={locked}
              onChange={(event) =>
                void update({
                  operation: "language",
                  language: event.currentTarget.value,
                })
              }
            >
              {!settings.languages.some(
                (language) => language.id === settings.language,
              ) && (
                <option value={settings.language}>
                  {settings.language} (unavailable)
                </option>
              )}
              {settings.languages.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                  {language.available ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
          </label>
          {!available && (
            <p role="alert">
              The selected language resource is missing or unsupported. Choose
              an available language or repair the application installation.
              Editing remains available. No dictionaries are downloaded.
            </p>
          )}
          <button
            type="button"
            disabled={locked || !available}
            onClick={() => void check()}
          >
            Check chapter
          </button>
          <details>
            <summary>Personal dictionary ({settings.words.length})</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (SpellingWordSchema.safeParse(word).success)
                  void update({ operation: "add", word });
              }}
            >
              <label>
                Personal word{" "}
                <input
                  aria-label="Personal word"
                  maxLength={128}
                  value={word}
                  onChange={(event) => setWord(event.currentTarget.value)}
                />
              </label>
              <button
                type="submit"
                disabled={locked || !SpellingWordSchema.safeParse(word).success}
              >
                Add word
              </button>
            </form>
            <p>
              Exact spelling and case; letters, apostrophes and hyphens, up to
              128 characters. Shared across languages and projects on this
              device.
            </p>
            <ul>
              {settings.words.map((entry) => (
                <li key={entry}>
                  {entry}{" "}
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={`Remove ${entry}`}
                    onClick={() =>
                      void update({ operation: "remove", word: entry })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            void window.drelwick.spelling
              .get()
              .then((result) => {
                if (mounted.current) {
                  if (result.ok) setSettings(result.value);
                  else setMessage(failure);
                }
              })
              .catch(() => {
                if (mounted.current) setMessage(failure);
              });
          }}
        >
          Retry spelling
        </button>
      )}
      <p role="status">{message}</p>
      {current && review && (
        <div>
          <p>
            Review: <strong>{current.word}</strong> ({review.occurrences.length}{" "}
            remaining)
          </p>
          <button
            type="button"
            onClick={() => {
              editor.commands.setTextSelection({
                from: current.from,
                to: current.to,
              });
              editor.commands.scrollIntoView();
            }}
          >
            Show in chapter
          </button>
          <button
            type="button"
            disabled={locked || current.word.length > 64}
            onClick={() => void suggest()}
          >
            Suggestions
          </button>
          {current.word.length > 64 && (
            <p>Suggestions are limited to words up to 64 characters.</p>
          )}
          <button
            type="button"
            disabled={locked}
            onClick={() =>
              void update({ operation: "add", word: current.word })
            }
          >
            Add to personal dictionary
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              generation.current++;
              setSuggestions(undefined);
              setReview({
                ...review,
                occurrences: review.occurrences.slice(1),
              });
            }}
          >
            Skip occurrence
          </button>
          {suggestions?.length === 0 && <p>No local suggestions found.</p>}
          {suggestions?.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              disabled={locked || !editable}
              onClick={() => {
                if (!replaceSpelling(editor, review.doc, current, suggestion))
                  setMessage(
                    "The chapter changed or is read-only. Check chapter again.",
                  );
              }}
            >
              Replace with {suggestion}
            </button>
          ))}
          <p>
            Only choosing a replacement changes the manuscript. Use Undo to
            revert; ordinary autosave saves the change. Check again after
            replacing.
          </p>
        </div>
      )}
    </section>
  );
}
