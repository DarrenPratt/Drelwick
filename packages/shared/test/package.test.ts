import { expect, test } from "vitest";

test("loads the shared TypeScript entry in the Node test environment", async () => {
  const shared = await import("../src/index.js");

  expect(shared).toBeTypeOf("object");
  expect(process.versions.node).toBeDefined();
});
