import { useEffect, useRef } from "react";

export function SplitChapterDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="project-dialog"
      aria-labelledby="split-chapter-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="split-chapter-title">Split chapter</h2>
      <p>
        Split “{title}” at the current cursor? A new chapter will contain
        everything after the cursor. Both chapters keep the current status.
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm}>
          Split chapter
        </button>
      </div>
    </dialog>
  );
}
