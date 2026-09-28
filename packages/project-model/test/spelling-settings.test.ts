import { expect, it } from "vitest";
import { SpellingSettingsSchema } from "../src/spelling-settings.js";

it("versions user settings independently of projects, preserving personal word code points", () => {
  const settings = {
    schemaVersion: 1,
    language: "en-GB",
    words: ["Élan", "e\u0301lan", "l’été", "co-operate"],
  };
  expect(SpellingSettingsSchema.parse(settings)).toEqual(settings);
  for (const invalid of [
    { ...settings, schemaVersion: 2 },
    { ...settings, path: "arbitrary" },
    { ...settings, words: ["two words"] },
    { ...settings, words: Array<string>(10001).fill("word") },
    { ...settings, language: "../../en" },
  ]) {
    expect(SpellingSettingsSchema.safeParse(invalid).success).toBe(false);
  }
});
