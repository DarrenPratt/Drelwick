import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SpellingSettingsSchema,
  type SpellingSettings,
} from "@drelwick/project-model";
import {
  SPELLING_LANGUAGES,
  type SpellingState,
  type SpellingUpdate,
  type SpellingCheck,
} from "@drelwick/shared";
import { writeJsonAtomically } from "./index.js";

/** No network or filesystem capability is needed by the checking engine. */
export interface SpellingAdapter {
  available(language: string): Promise<boolean>;
  check(language: string, words: string[]): Promise<boolean[]>;
  suggest(language: string, word: string): Promise<string[]>;
}

export class SpellingService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly userData: string,
    private readonly adapter: SpellingAdapter,
    private readonly write = writeJsonAtomically,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<SpellingSettings> {
    try {
      return SpellingSettingsSchema.parse(
        JSON.parse(
          await readFile(join(this.userData, "spelling.json"), "utf8"),
        ),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { schemaVersion: 1, language: "en-US", words: [] };
      // Never overwrite corrupt/newer settings, or expose parsing payloads.
      throw new Error(
        "Spelling settings could not be read. Editing remains available. Preserve spelling.json before repairing it.",
      );
    }
  }

  private async state(settings: SpellingSettings): Promise<SpellingState> {
    return {
      language: settings.language,
      words: settings.words,
      languages: await Promise.all(
        SPELLING_LANGUAGES.map(async (language) => ({
          ...language,
          available: await this.adapter.available(language.id),
        })),
      ),
    };
  }

  get(): Promise<SpellingState> {
    return this.serialize(async () => this.state(await this.read()));
  }

  update(update: SpellingUpdate): Promise<SpellingState> {
    return this.serialize(async () => {
      const previous = await this.read();
      const next = SpellingSettingsSchema.parse({
        ...previous,
        ...(update.operation === "language"
          ? { language: update.language }
          : {
              words:
                update.operation === "add"
                  ? [...new Set([...previous.words, update.word])]
                  : previous.words.filter((word) => word !== update.word),
            }),
      });
      await mkdir(this.userData, { recursive: true });
      await this.write(join(this.userData, "spelling.json"), next);
      return this.state(next);
    });
  }

  check(language: string, words: string[]): Promise<SpellingCheck> {
    return this.serialize(async () => {
      const settings = await this.read();
      if (
        language !== settings.language ||
        !(await this.adapter.available(language))
      )
        return { available: false, incorrect: [] };
      const personal = new Set(settings.words);
      const candidates = [...new Set(words)].filter(
        (word) => !personal.has(word),
      );
      const correct = await this.adapter.check(language, candidates);
      return {
        available: true,
        incorrect: candidates.filter((_, index) => !correct[index]),
      };
    });
  }

  suggest(language: string, word: string): Promise<string[]> {
    return this.serialize(async () => {
      const settings = await this.read();
      if (
        language !== settings.language ||
        settings.words.includes(word) ||
        !(await this.adapter.available(language))
      )
        return [];
      return this.adapter.suggest(language, word);
    });
  }
}
