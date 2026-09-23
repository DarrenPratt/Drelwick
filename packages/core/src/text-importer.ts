import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { IMAGE_LIMITS, validateImportedManuscript } from "@sarel/project-model";
import { IsolatedManuscriptImporter } from "./import-parser.js";
import { importError } from "./manuscript-import.js";
import { boundedRead, validateImageContent } from "./image-assets.js";
import type { ApprovedImage, TextFormat } from "./text-import/parser.js";

/** Native selection authorizes exactly one file, never a source-relative directory. */
export type SelectImportImage = (
  reference: string,
  signal: AbortSignal,
) => Promise<string | null>;
const sourceLimit = 8 * 1024 * 1024;
export class TextManuscriptImporter extends IsolatedManuscriptImporter {
  private readonly bundle: string;
  constructor(
    private readonly format: TextFormat,
    private readonly selectImage?: SelectImportImage,
  ) {
    const bundle = readFileSync(
      new URL("./text-parser.bundle.js", import.meta.url),
      "utf8",
    );
    super(
      `(source) => { ${bundle}\n return TEXT.parse(source, ${JSON.stringify(format)}); }`,
    );
    this.bundle = bundle;
  }
  override async parse(
    source: Uint8Array,
    signal: AbortSignal,
  ): Promise<string> {
    const check = () => {
      if (signal.aborted) throw importError("IMPORT_CANCELLED");
    };
    check();
    if (source.length > sourceLimit) throw importError("IMPORT_INVALID");
    // Fatal decoding before parsing also rejects UTF-16/legacy encodings. Only UTF-8 BOM is accepted.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(source);
    } catch {
      throw importError("IMPORT_INVALID");
    }
    const unpack = (serialized: string) => {
      const data: unknown = JSON.parse(serialized);
      if (
        !data ||
        typeof data !== "object" ||
        !("manuscript" in data) ||
        !("references" in data) ||
        !Array.isArray(data.references) ||
        data.references.length > 256 ||
        data.references.some((r) => typeof r !== "string" || r.length > 1000)
      )
        throw importError("IMPORT_INVALID");
      return {
        manuscript: validateImportedManuscript(JSON.stringify(data.manuscript)),
        references: data.references as string[],
      };
    };
    const first = unpack(await super.parse(source, signal));
    const approved: ApprovedImage[] = [];
    let total = 0;
    if (this.selectImage)
      for (const reference of first.references) {
        check();
        const path = await this.selectImage(reference, signal);
        check();
        if (!path) continue;
        const bytes = await boundedRead(path, IMAGE_LIMITS.bytes);
        check();
        const { mediaType } = await validateImageContent(bytes, basename(path));
        total += bytes.length;
        if (total > 48 * 1024 * 1024) throw importError("IMPORT_INVALID");
        approved.push({
          reference,
          asset: {
            id: randomUUID(),
            mediaType,
            base64: bytes.toString("base64"),
          },
        });
      }
    check();
    if (!approved.length) return JSON.stringify(first.manuscript);
    // Trusted configuration serialized as data; documents never supply program text.
    const second = new IsolatedManuscriptImporter(
      `(source) => { ${this.bundle}\n return TEXT.parse(source, ${JSON.stringify(this.format)}, ${JSON.stringify(approved)}); }`,
    );
    const result = unpack(await second.parse(source, signal));
    check();
    return JSON.stringify(result.manuscript);
  }
}
export type { TextFormat } from "./text-import/parser.js";
