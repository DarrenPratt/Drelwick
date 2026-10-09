import { dialog, type BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import {
  assembleBook,
  printSourceRevision,
  printPreflight,
  inspectExportDestination,
  writeExportAtomically,
} from "@drelwick/core";
import {
  ApplicationError,
  type PrintPreview,
  type PrintExportReceipt,
} from "@drelwick/shared";
import { inspectPrintPdf } from "./print-inspection.js";

export async function exportPrint(
  window: BrowserWindow,
  projectPath: string,
  preview: PrintPreview,
  options: {
    authorized(): boolean;
    signal: AbortSignal;
    acceptWarnings: boolean;
    progress(phase: string): void;
  },
): Promise<PrintExportReceipt> {
  const fail = (code: string, message: string): never => {
    throw new ApplicationError(`PDF_EXPORT_${code}`, message);
  };
  const check = () => {
    if (options.signal.aborted)
      fail(
        "CANCELLED",
        "PDF export cancelled. The previous destination is preserved.",
      );
    if (!options.authorized())
      fail(
        "ACCESS",
        "The project window changed. Reopen print preview before exporting.",
      );
  };
  const current = async () => {
    check();
    const source = await assembleBook(projectPath, { print: true });
    check();
    if (printSourceRevision(source) !== preview.export?.sourceRevision)
      fail(
        "STALE",
        "The book, assets, theme or print settings changed. Refresh and review print preview before exporting.",
      );
  };
  const receipt: PrintExportReceipt = {
    created: false,
    revision: preview.revision,
    cleanupWarning: false,
  };
  options.progress("Checking preview revision and preflight");
  await current();
  const findings = [
    ...printPreflight(preview),
    ...(await inspectPrintPdf(preview)),
  ];
  if (findings.some((f) => f.severity === "error"))
    fail(
      "PREFLIGHT",
      "Export blocked by preflight errors. Review findings, correct the affected chapters/settings and refresh.",
    );
  if (findings.some((f) => f.severity === "warning") && !options.acceptWarnings)
    fail(
      "WARNINGS",
      "Review and acknowledge preflight warnings before exporting.",
    );
  check();
  options.progress("Choose a PDF destination");
  const selected = await dialog.showSaveDialog(window, {
    title: "Export print PDF",
    buttonLabel: "Export PDF",
    defaultPath: join(dirname(projectPath), "Manuscript.pdf"),
    filters: [{ name: "Print PDF", extensions: ["pdf"] }],
  });
  check();
  if (selected.canceled || !selected.filePath) return receipt;
  const destination = await inspectExportDestination(
    selected.filePath,
    projectPath,
    "pdf",
  );
  let overwrite = false;
  if (destination.existing !== null) {
    options.progress("Waiting for overwrite confirmation");
    const response = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Replace existing PDF?",
      message: "Replace the selected file with this previewed PDF revision?",
      buttons: ["Keep existing file", "Replace"],
      defaultId: 0,
      cancelId: 0,
    });
    check();
    if (response.response !== 1) return receipt;
    overwrite = true;
  }
  options.progress("Writing and validating temporary PDF");
  const result = await writeExportAtomically(destination, preview.pdf, {
    format: "pdf",
    overwrite,
    signal: options.signal,
    validate: async (bytes) => {
      check();
      if (
        (await inspectPrintPdf(preview, bytes)).some(
          (f) => f.severity === "error",
        )
      )
        fail(
          "VALIDATION",
          "Temporary PDF validation failed. The previous destination is preserved.",
        );
    },
    checkpoint: async (phase) => {
      check();
      if (phase === "commit") {
        options.progress("Checking source before atomic publication");
        await current();
        const latest = await inspectExportDestination(
          destination.path,
          projectPath,
          "pdf",
        );
        if (latest.existing !== destination.existing)
          fail(
            "CHANGED",
            "The destination changed after selection. Select it again and review overwrite confirmation.",
          );
      }
    },
  });
  return { ...receipt, created: true, cleanupWarning: result.cleanupWarning };
}
