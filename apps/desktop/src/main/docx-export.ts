import { dialog, type BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import {
  assembleBook,
  generateDocx,
  inspectDocxDestination,
  writeDocxAtomically,
} from "@drelwick/core";
import { ApplicationError, type DocxExportReceipt } from "@drelwick/shared";

/** The snapshot and all paths stay privileged. No extension or network services. */
export async function exportDocx(
  window: BrowserWindow,
  projectPath: string,
  projectId: string,
  authorized: () => boolean,
): Promise<DocxExportReceipt> {
  const check = () => {
    if (!authorized())
      throw new ApplicationError(
        "PROJECT_ACCESS_DENIED",
        "The project window changed. Retry export from the open project.",
      );
  };
  check();
  const snapshot = await assembleBook(projectPath);
  if (snapshot.book.projectId !== projectId)
    throw new ApplicationError(
      "PROJECT_NOT_OPEN",
      "The project changed. Reopen it before exporting.",
    );
  const output = generateDocx(snapshot);
  const receipt = {
    created: false,
    revision: output.revision,
    warnings: output.warnings,
  };
  check();
  if (output.warnings.length) {
    const review = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Review DOCX interchange limitations",
      message:
        "All manuscript content will be retained. Review these formatting and round-trip limitations before exporting.",
      detail: output.warnings
        .map(
          (w) =>
            `${w.chapterId ? `Item ${snapshot.book.chapters.findIndex((c) => c.id === w.chapterId) + 1}, block ${w.path.length ? w.path.map((n) => n + 1).join(".") : "title/settings"}` : "Metadata"}: ${w.construct} — ${w.message}`,
        )
        .join("\n"),
      buttons: ["Cancel", "Export editable DOCX"],
      defaultId: 0,
      cancelId: 0,
    });
    check();
    if (review.response !== 1) return receipt;
  }
  const selected = await dialog.showSaveDialog(window, {
    title: "Export editable Word manuscript",
    buttonLabel: "Export DOCX",
    defaultPath: join(dirname(projectPath), "Manuscript.docx"),
    filters: [{ name: "Word manuscript", extensions: ["docx"] }],
  });
  check();
  if (selected.canceled || !selected.filePath) return receipt;
  const destination = await inspectDocxDestination(
    selected.filePath,
    projectPath,
  );
  let overwrite = false;
  if (destination.existing !== null) {
    const confirmation = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Replace existing Word manuscript?",
      message:
        "The selected file already exists. Replace it with this manuscript export?",
      buttons: ["Keep existing file", "Replace"],
      defaultId: 0,
      cancelId: 0,
    });
    check();
    if (confirmation.response !== 1) return receipt;
    overwrite = true;
  }
  check();
  const result = await writeDocxAtomically(destination, output.bytes, {
    overwrite,
    checkpoint: async () => {
      check();
    },
  });
  if (result.cleanupWarning)
    receipt.warnings.push({
      code: "publication",
      construct: "temporary-output",
      path: [],
      message:
        "DOCX was created, but its temporary hard link could not be removed. Check the destination folder for a .drelwick-docx temporary file.",
    });
  // Atomic publication is the commit point: no late authorization/cancel failure.
  return { ...receipt, created: true };
}
