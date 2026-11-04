import { dialog, type BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import {
  assembleBook,
  assertAssembledBookCurrent,
  generateEpub,
  inspectEpubDestination,
  writeEpubAtomically,
} from "@drelwick/core";
import { ApplicationError, type EpubExportReceipt } from "@drelwick/shared";
import { chooseRevisionProjection } from "./revision-projection.js";

export async function exportEpub(
  window: BrowserWindow,
  projectPath: string,
  projectId: string,
  authorized: () => boolean,
): Promise<EpubExportReceipt> {
  const check = () => {
    if (!authorized())
      throw new ApplicationError(
        "PROJECT_ACCESS_DENIED",
        "The project window changed. Retry export from the open project.",
      );
  };
  check();
  let snapshot: Awaited<ReturnType<typeof assembleBook>>;
  try {
    snapshot = await assembleBook(projectPath, {
      chooseProjection: chooseRevisionProjection(window, authorized),
    });
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      error.code === "REVISION_PROJECTION_CANCELLED"
    )
      return { created: false, revision: "", warnings: [] };
    throw error;
  }
  if (snapshot.book.projectId !== projectId)
    throw new ApplicationError(
      "PROJECT_NOT_OPEN",
      "The project changed. Reopen it before exporting.",
    );
  const output = generateEpub(snapshot);
  const receipt: EpubExportReceipt = {
    created: false,
    revision: output.revision,
    warnings: [...output.warnings],
  };
  check();
  const selected = await dialog.showSaveDialog(window, {
    title: "Export EPUB ebook",
    buttonLabel: "Export EPUB",
    defaultPath: join(dirname(projectPath), "Manuscript.epub"),
    filters: [{ name: "EPUB ebook", extensions: ["epub"] }],
  });
  check();
  if (selected.canceled || !selected.filePath) return receipt;
  const destination = await inspectEpubDestination(
    selected.filePath,
    projectPath,
  );
  let overwrite = false;
  if (destination.existing !== null) {
    const confirmation = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Replace existing EPUB?",
      message:
        "The selected file already exists. Replace it with this ebook export?",
      buttons: ["Keep existing file", "Replace"],
      defaultId: 0,
      cancelId: 0,
    });
    check();
    if (confirmation.response !== 1) return receipt;
    overwrite = true;
  }
  check();
  await writeEpubAtomically(destination, output.bytes, {
    overwrite,
    checkpoint: async () => {
      check();
      await assertAssembledBookCurrent(snapshot);
    },
  });
  receipt.created = true;
  return receipt;
}
