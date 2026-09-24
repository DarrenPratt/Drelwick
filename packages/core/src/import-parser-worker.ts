import { parentPort, workerData } from "node:worker_threads";
import { createContext, Script } from "node:vm";
import { IMPORT_LIMITS } from "@drelwick/project-model";

// Only packaged, first-party parser programs may reach this worker. The document
// is a string argument, never executable code. No Node/browser capabilities are
// installed in the parser context. This is not a third-party plugin sandbox.
const input = workerData as { program: string; base64: string };
try {
  const context = createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new Script(
    `"use strict"; (${input.program})(${JSON.stringify(input.base64)})`,
  );
  const output: unknown = script.runInContext(context, { timeout: 30_000 });
  if (
    typeof output !== "string" ||
    Buffer.byteLength(output) > IMPORT_LIMITS.parserBytes
  )
    throw new Error();
  parentPort?.postMessage({ ok: true, output });
} catch {
  // Do not transfer parser exceptions: messages/stacks may contain author text.
  parentPort?.postMessage({ ok: false });
}
