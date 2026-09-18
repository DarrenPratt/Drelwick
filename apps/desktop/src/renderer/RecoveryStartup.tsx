import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RecoveryCandidateSummary } from "@bookeditor/shared";

/** The editor is not mounted until every startup decision has completed. */
export function RecoveryStartup({ children }: { children: ReactNode }) {
  const [candidates, setCandidates] = useState<
    RecoveryCandidateSummary[] | null
  >(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    void window.bookEditor.recovery
      .list()
      .then((result) => {
        if (!active) return;
        if (result.ok) setCandidates(result.value);
        else setError(result.error.message);
      })
      .catch(() => {
        if (active)
          setError("Unable to load recovery data. Cancel startup and retry.");
      });
    return () => {
      active = false;
    };
  }, []);
  const ready = candidates?.length === 0 && !warning;
  useEffect(() => {
    if (!ready) return window.bookEditor.onShutdownRequested(async () => true);
  }, [ready]);
  useEffect(() => {
    if (!ready && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [ready]);
  async function decide(action: "recover" | "discard" | "cancel", id?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setWarning("");
    try {
      if (action === "cancel") {
        const result = await window.bookEditor.recovery.cancel();
        if (!result.ok) setError(result.error.message);
      } else if (id) {
        const result = await window.bookEditor.recovery[action](id);
        if (result.ok) {
          setCandidates(result.value);
          setWarning(result.warning ?? "");
        } else setError(result.error.message);
      }
    } catch {
      setError("Unable to complete recovery. Retry or cancel startup.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (ready) return children;
  return (
    <dialog
      ref={dialog}
      className="project-dialog recovery-dialog"
      aria-labelledby="recovery-title"
      onCancel={(event) => {
        event.preventDefault();
        if (candidates?.length === 0) setWarning("");
        else void decide("cancel");
      }}
    >
      <h1 id="recovery-title">Manuscript recovery</h1>
      <p>
        Recovery data was found after an interrupted session. Recover saves the
        original to history before replacing it. Discard removes only the
        selected recovery version.
      </p>
      {candidates === null && !error && (
        <p role="status">Checking recovery data...</p>
      )}
      {error && <p role="alert">{error}</p>}
      {warning && <p role="status">{warning}</p>}
      <ul>
        {candidates?.map((candidate) => (
          <li key={candidate.id}>
            <strong>{candidate.title}</strong>
            <p>{candidate.projectPath}</p>
            <p>
              {candidate.source === "temporary"
                ? "Unsaved version"
                : "History version"}{" "}
              - {new Date(candidate.created).toLocaleString()}
            </p>
            <button
              disabled={busy}
              onClick={() => void decide("recover", candidate.id)}
            >
              Recover
            </button>{" "}
            <button
              disabled={busy}
              onClick={() => void decide("discard", candidate.id)}
            >
              Discard
            </button>
          </li>
        ))}
      </ul>
      {candidates?.length !== 0 && (
        <button disabled={busy} onClick={() => void decide("cancel")}>
          Cancel startup
        </button>
      )}
      {candidates?.length === 0 && warning && (
        <button disabled={busy} onClick={() => setWarning("")}>
          Continue
        </button>
      )}
    </dialog>
  );
}
