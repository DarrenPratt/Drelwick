import { parentPort } from "node:worker_threads";
import { createLocalChecker } from "@drelwick/core";

export type SpellingWorkerRequest = {
  id: number;
  operation: "available" | "check" | "suggest";
  language: string;
  words: string[];
};
type Checker = ReturnType<typeof createLocalChecker>;
const dictionaries = new Map<string, Promise<Checker | null>>();

function load(language: string): Promise<Checker | null> {
  let pending = dictionaries.get(language);
  if (!pending) {
    pending = (async () => {
      try {
        // Literal imports only: renderer values can never select files/modules.
        if (language === "en-US")
          return createLocalChecker((await import("dictionary-en")).default);
        if (language === "en-GB")
          return createLocalChecker((await import("dictionary-en-gb")).default);
      } catch {
        /* Missing/corrupt packaged data disables only spelling. */
      }
      return null;
    })();
    dictionaries.set(language, pending);
  }
  return pending;
}

parentPort?.on("message", async (request: SpellingWorkerRequest) => {
  try {
    const checker = await load(request.language);
    if (request.operation === "available") {
      parentPort?.postMessage({
        id: request.id,
        ok: true,
        value: checker !== null,
      });
      return;
    }
    if (!checker) throw new Error("Unavailable");
    const value =
      request.operation === "check"
        ? request.words.map((word) => checker.correct(word))
        : checker.suggest(request.words[0] ?? "");
    parentPort?.postMessage({ id: request.id, ok: true, value });
  } catch {
    parentPort?.postMessage({ id: request.id, ok: false });
  }
});
