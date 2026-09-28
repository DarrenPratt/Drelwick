import nspell from "nspell";

/** Constructed only from trusted packaged resources, never renderer-provided data. */
export function createLocalChecker(resources: {
  aff: Uint8Array;
  dic: Uint8Array;
}) {
  const checker = nspell({
    aff: Buffer.from(resources.aff),
    dic: Buffer.from(resources.dic),
  });
  return {
    correct: (word: string) => checker.correct(word),
    suggest: (word: string) => checker.suggest(word).slice(0, 8),
  };
}
