import { readFileSync } from "node:fs";
import { IsolatedManuscriptImporter } from "./import-parser.js";
import { DocxImportError } from "./docx-error.js";
import { DOCX_ERRORS } from "./docx/limits.js";

/** Only this packaged build artifact supplies code; document/IPC input never does. */
export class DocxManuscriptImporter extends IsolatedManuscriptImporter {
  constructor() {
    const bundle = readFileSync(
      new URL("./docx-parser.bundle.js", import.meta.url),
      "utf8",
    );
    super(`(source) => { ${bundle}\n return DOCX.parse(source); }`);
  }
  override async parse(
    source: Uint8Array,
    signal: AbortSignal,
  ): Promise<string> {
    const output = await super.parse(source, signal);
    if (output.length < 512 && output.startsWith('{"docxError":')) {
      const error: unknown = JSON.parse(output);
      if (
        error &&
        typeof error === "object" &&
        "docxError" in error &&
        typeof error.docxError === "string" &&
        Object.hasOwn(DOCX_ERRORS, error.docxError)
      )
        throw new DocxImportError(
          error.docxError as keyof typeof DOCX_ERRORS,
          "location" in error ? error.location : undefined,
        );
    }
    return output;
  }
}
export { DOCX_LIMITS } from "./docx/limits.js";
export { DocxImportError } from "./docx-error.js";
