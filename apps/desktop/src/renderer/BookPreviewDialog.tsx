import { useEffect, useRef } from "react";
import type { BookPreview } from "@drelwick/shared";

const diagnosticMessages: Record<string, string> = {
  "unsupported-node": "This content type is not supported.",
  "unsupported-mark": "This text formatting is not supported.",
  "invalid-structure": "This chapter has an invalid document structure.",
  "invalid-xml-text":
    "This chapter contains a character that cannot be published as XHTML.",
  "unsafe-url": "A link destination is unsafe and was omitted.",
  "unresolved-internal-link":
    "A link has no matching destination in this book; its label is shown as text.",
  "missing-asset": "A local image is missing. Restore or replace the image.",
  "invalid-asset":
    "A local image is damaged or unsupported. Restore or replace the image.",
  "unsafe-asset-reference": "A local image could not be displayed safely.",
};

export function BookPreviewDialog({
  preview,
  onClose,
}: {
  preview: BookPreview;
  onClose(): void;
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
      className="project-dialog book-preview"
      aria-labelledby="book-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="book-preview-title">Book preview</h2>
      <p>Saved manuscript preview. Close and reopen to include later edits.</p>
      {!preview.complete && (
        <p role="alert">
          This preview is incomplete. Resolve the reported content or asset
          problems before publishing.
        </p>
      )}
      {preview.diagnostics.length > 0 && (
        <ul aria-label="Rendering diagnostics">
          {preview.diagnostics.map((entry, index) => (
            <li key={index}>
              {diagnosticMessages[entry.code] ??
                "This content could not be rendered."}{" "}
              — chapter {entry.chapterId}, position{" "}
              {entry.path.join(".") || "root"}
            </li>
          ))}
        </ul>
      )}
      <iframe
        title="Book manuscript"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={preview.document}
      />
      <button onClick={onClose}>Close preview</button>
    </dialog>
  );
}
