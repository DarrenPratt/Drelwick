/** Located fidelity findings are review data, never log payloads. */
export interface DocxExportWarning {
  chapterId?: string;
  path: number[];
  construct: string;
  code: "style" | "list" | "link" | "image" | "publication" | "metadata";
  message: string;
}
export interface DocxExportReceipt {
  created: boolean;
  revision: string;
  warnings: DocxExportWarning[];
}
