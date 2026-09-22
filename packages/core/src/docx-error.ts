import { ApplicationError } from "@sarel/shared";
import {
  DOCX_ERRORS,
  DOCX_LOCATIONS,
  type DocxErrorCode,
} from "./docx/limits.js";

/** Constructed only after allowlisting parser diagnostics. Never carries source text. */
export class DocxImportError extends ApplicationError {
  constructor(code: DocxErrorCode, location: unknown) {
    let context = "DOCX package";
    if (
      location &&
      typeof location === "object" &&
      "label" in location &&
      "block" in location &&
      DOCX_LOCATIONS.some((label) => label === location.label) &&
      typeof location.block === "number" &&
      Number.isInteger(location.block) &&
      location.block >= 0 &&
      location.block <= 250_000
    )
      context = `${String(location.label)}, location ${location.block}`;
    super(code, `${context}: ${DOCX_ERRORS[code]}`);
  }
}
