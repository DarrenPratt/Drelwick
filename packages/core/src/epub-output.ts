import {
  inspectExportDestination,
  writeExportAtomically,
  type ExportDestination,
} from "./export-output.js";
export type EpubDestination = ExportDestination;
export const inspectEpubDestination = (path: string, projectPath: string) =>
  inspectExportDestination(path, projectPath, "epub");
export const writeEpubAtomically = (
  destination: EpubDestination,
  bytes: Uint8Array,
  options: Omit<Parameters<typeof writeExportAtomically>[2], "format">,
) => writeExportAtomically(destination, bytes, { ...options, format: "epub" });
