import { Worker } from "node:worker_threads";
import { IMPORT_LIMITS } from "@drelwick/project-model";
import { importError, type ManuscriptImporter } from "./manuscript-import.js";

/** A packaged synchronous JS function: base64 source -> serialized ImporterResult.
 * Bundle source-format libraries into the program; runtime imports are unavailable.
 * Never construct programs from imported documents or renderer input.
 */
export class IsolatedManuscriptImporter implements ManuscriptImporter {
  constructor(private readonly program: string) {}
  async parse(source: Uint8Array, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw importError("IMPORT_CANCELLED");
    if (source.byteLength > IMPORT_LIMITS.sourceBytes)
      throw importError("IMPORT_INVALID");
    const worker = new Worker(
      new URL("./import-parser-worker.js", import.meta.url),
      {
        workerData: {
          program: this.program,
          base64: Buffer.from(source).toString("base64"),
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 384,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      },
    );
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (output?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        void worker.terminate();
        if (output !== undefined) resolve(output);
        else
          reject(
            importError(
              signal.aborted ? "IMPORT_CANCELLED" : "IMPORT_PARSER_FAILED",
            ),
          );
      };
      const cancel = () => finish();
      const timer = setTimeout(cancel, 35_000);
      signal.addEventListener("abort", cancel, { once: true });
      worker.once("error", cancel);
      worker.once("exit", cancel);
      worker.once("message", (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          "ok" in message &&
          message.ok === true &&
          "output" in message &&
          typeof message.output === "string" &&
          Buffer.byteLength(message.output) <= IMPORT_LIMITS.parserBytes
        )
          finish(message.output);
        else finish();
      });
      if (signal.aborted) cancel();
    });
  }
}
