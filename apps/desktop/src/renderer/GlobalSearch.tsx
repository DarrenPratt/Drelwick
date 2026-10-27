import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  searchGlobalIndex,
  resolveGlobalSearchHit,
  type GlobalSearchOptions,
} from "@drelwick/core/global-search";
import {
  GLOBAL_SEARCH_LIMITS,
  type GlobalSearchEntry,
  type GlobalSearchHit,
  type GlobalSearchSnapshot,
  type ReferenceTarget,
} from "@drelwick/shared";

export interface GlobalSearchHandle {
  invalidate(): void;
}
export interface GlobalSearchProps {
  ref?: Ref<GlobalSearchHandle>;
  projectId: string;
  sourceVersion: string;
  disabled: boolean;
  execute: typeof window.drelwick.references.execute;
  flush(): Promise<boolean>;
  navigate(hit: GlobalSearchHit, entry: GlobalSearchEntry): Promise<void>;
}
const kinds: [ReferenceTarget["kind"], string][] = [
  ["chapter", "Chapters"],
  ["character", "Characters"],
  ["location", "Locations"],
  ["canon", "Canon"],
  ["timeline", "Timeline"],
  ["note", "Research notes"],
];

export function GlobalSearch({
  ref,
  projectId,
  sourceVersion,
  disabled,
  execute,
  flush,
  navigate,
}: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReferenceTarget["kind"] | "">("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    value: GlobalSearchSnapshot;
  } | null>(null);
  const [results, setResults] = useState<{
    key: string;
    hits: GlobalSearchHit[];
    limited: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [detail, setDetail] = useState<GlobalSearchEntry | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (detail) detailHeading.current?.focus();
  }, [detail]);
  const epoch = useRef(0);
  const currentSearch = useRef<AbortController | null>(null);
  const latest = useRef({
    flush,
    execute,
    projectId,
    navigate,
  });
  useEffect(() => {
    latest.current = {
      flush,
      execute,
      projectId,
      navigate,
    };
  }, [flush, execute, projectId, navigate]);
  const sourceKey = JSON.stringify([projectId, sourceVersion, refresh]);
  const resultKey = JSON.stringify([
    sourceKey,
    query,
    filter,
    matchCase,
    wholeWord,
  ]);
  const sourceReady = snapshot?.key === sourceKey;
  const ready = sourceReady && results?.key === resultKey && !cancelled;
  const invalidate = () => {
    epoch.current++;
    currentSearch.current?.abort();
    setSnapshot(null);
    setResults(null);
    setDetail(null);
  };
  useImperativeHandle(ref, () => ({ invalidate }));

  useEffect(() => {
    if (!open || cancelled || disabled) return;
    const generation = ++epoch.current;
    let alive = true;
    const timer = setTimeout(() => {
      setError("");
      setDetail(null);
      void (async () => {
        if (!(await latest.current.flush())) throw new Error("save");
        if (!alive || generation !== epoch.current) return;
        const response = await latest.current.execute({
          operation: "search-snapshot",
          projectId: latest.current.projectId,
        });
        if (!alive || generation !== epoch.current) return;
        if (!response.ok || response.value.type !== "search-snapshot")
          throw new Error("read");
        setSnapshot({ key: sourceKey, value: response.value.snapshot });
      })().catch((failure: unknown) => {
        if (!alive || generation !== epoch.current) return;
        setError(
          failure instanceof Error && failure.message === "save"
            ? "Search paused: save or explicitly discard pending edits in their editor, then retry. Your drafts remain open."
            : "Unable to read search sources. Your project is unchanged. Retry search.",
        );
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, cancelled, sourceKey, disabled]);

  useEffect(() => {
    if (!open || !sourceReady || cancelled || !snapshot) return;
    const controller = new AbortController();
    currentSearch.current = controller;
    const options: GlobalSearchOptions = {
      query,
      matchCase,
      wholeWord,
      kinds: filter ? [filter] : [],
    };
    const timer = setTimeout(() => {
      void searchGlobalIndex(snapshot.value, options, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted)
            setResults({ key: resultKey, ...value });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("Search could not finish. Retry search.");
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    open,
    sourceReady,
    snapshot,
    query,
    matchCase,
    wholeWord,
    filter,
    resultKey,
    cancelled,
  ]);

  async function openHit(hit: GlobalSearchHit) {
    if (!ready || navigating || disabled) return;
    const generation = epoch.current;
    setNavigating(true);
    setError("");
    try {
      if (!(await latest.current.flush())) throw new Error("save");
      if (generation !== epoch.current) throw new Error("stale");
      const response = await latest.current.execute({
        operation: "search-resolve",
        projectId,
        target: { kind: hit.kind, id: hit.id },
        fingerprint: hit.fingerprint,
      });
      if (
        generation !== epoch.current ||
        !response.ok ||
        response.value.type !== "search-entry" ||
        !resolveGlobalSearchHit(response.value.entry, hit)
      )
        throw new Error("stale");
      if (hit.kind === "chapter")
        await latest.current.navigate(hit, response.value.entry);
      else {
        setDetail(response.value.entry);
      }
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "save"
          ? "Navigation cancelled: pending edits could not be saved. Your drafts remain open."
          : "This result changed or is no longer available. Refresh search before opening it.",
      );
      setResults(null);
      setDetail(null);
    } finally {
      setNavigating(false);
    }
  }
  function close() {
    invalidate();
    setOpen(false);
    setCancelled(false);
    setTimeout(() => opener.current?.focus(), 0);
  }
  return (
    <section
      data-global-search="true"
      aria-label="Global local search"
      className="global-search"
    >
      <button
        ref={opener}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setCancelled(false);
          if (!open) setTimeout(() => input.current?.focus(), 0);
          else close();
        }}
      >
        Search project
      </button>
      {open && (
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <p>
            Search saved chapters and Story Bible records offline. Pending edits
            save first.
          </p>
          <label>
            Search project text{" "}
            <input
              ref={input}
              value={query}
              maxLength={GLOBAL_SEARCH_LIMITS.queryCharacters}
              onChange={(event) => {
                currentSearch.current?.abort();
                setQuery(event.target.value);
                setDetail(null);
              }}
              onKeyDown={(event) => {
                if (
                  (event.key === "ArrowDown" || event.key === "Enter") &&
                  ready
                ) {
                  event.preventDefault();
                  list.current?.querySelector("button")?.focus();
                }
              }}
            />
          </label>
          <label>
            Record type{" "}
            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as typeof filter)
              }
            >
              <option value="">All types</option>
              {kinds.map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
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
          <button
            disabled={navigating || disabled}
            onClick={() => {
              invalidate();
              setCancelled(false);
              setRefresh((value) => value + 1);
            }}
          >
            Refresh search
          </button>
          <button
            onClick={() => {
              invalidate();
              setCancelled(true);
            }}
          >
            Cancel search
          </button>
          <button onClick={close}>Close search</button>
          <p role="status" aria-live="polite">
            {cancelled
              ? "Search cancelled."
              : error
                ? "Search paused."
                : !sourceReady
                  ? "Saving edits and loading local index…"
                  : !query
                    ? "Enter text to search."
                    : !ready
                      ? "Searching…"
                      : results.hits.length
                        ? `${results.hits.length} results${results.limited ? " (result limit reached; narrow your search)" : ""}.`
                        : "No matching results."}
          </p>
          {error && <p role="alert">{error}</p>}
          {sourceReady && snapshot.value.incomplete && (
            <p role="alert">
              Search is incomplete: some files are invalid, unavailable or
              exceed the documented indexing limits.
            </p>
          )}
          {ready && (
            <ol
              ref={list}
              aria-label="Search results"
              className="global-search-results"
              onKeyDown={(event) => {
                const buttons = Array.from(
                  list.current?.querySelectorAll("button") ?? [],
                );
                const index = buttons.indexOf(
                  event.target as HTMLButtonElement,
                );
                if (index < 0) return;
                const next =
                  event.key === "ArrowDown"
                    ? Math.min(index + 1, buttons.length - 1)
                    : event.key === "ArrowUp"
                      ? Math.max(0, index - 1)
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? buttons.length - 1
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  buttons[next]?.focus();
                }
              }}
            >
              {results.hits.map((hit, index) => (
                <li key={`${hit.id}:${hit.fieldIndex}:${hit.start}`}>
                  <button
                    disabled={navigating || disabled}
                    onClick={() => void openHit(hit)}
                  >
                    <strong>{hit.title}</strong> · {hit.kind} · {hit.field}
                    <span className="global-search-context">{hit.context}</span>
                    <span className="global-search-location">
                      {hit.kind === "chapter" ? "Manuscript" : "Story Bible"} ·{" "}
                      {hit.title} · {hit.field} · match {index + 1}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {detail && (
            <section aria-label="Search record detail">
              <h3 tabIndex={-1} ref={detailHeading}>
                {detail.title}
              </h3>
              <p>
                {detail.kind} · Story Bible · Read-only saved record. Edit it in
                its Story Bible panel.
              </p>
              <dl>
                {detail.fields.map((field) => (
                  <div key={field.name}>
                    <dt>{field.name}</dt>
                    <dd>{field.text}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => {
                  setDetail(null);
                  input.current?.focus();
                }}
              >
                Back to search
              </button>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
