import { afterEach, expect, it } from "vitest";
import { BundledSpellingAdapter } from "../dist/main/spelling-adapter.js";
const adapters: BundledSpellingAdapter[] = [];
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.dispose();
});
it("loads pinned bundled dictionaries in the built worker, independently of the operating system", async () => {
  const adapter = new BundledSpellingAdapter();
  adapters.push(adapter);
  expect(await adapter.available("en-US")).toBe(true);
  expect(await adapter.available("en-GB")).toBe(true);
  expect(
    await adapter.check("en-US", ["hello", "helo", "color", "colour"]),
  ).toEqual([true, false, true, false]);
  expect(
    await adapter.check("en-GB", ["hello", "helo", "color", "colour"]),
  ).toEqual([true, false, false, true]);
  expect(await adapter.suggest("en-US", "helo")).toContain("hello");
  expect(await adapter.available("../../arbitrary")).toBe(false);
  await expect(adapter.check("fr-FR", ["privateword"])).rejects.toThrow(
    "Local spelling resources are unavailable",
  );
  adapter.dispose();
  expect(await adapter.available("en-US")).toBe(true);
}, 20000);
