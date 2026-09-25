import { expect, test } from "vitest";
import * as shared from "@drelwick/shared";
import { shared as consumerShared, rendered } from "../src/index.js";

test("resolves the built workspace dependency through the consumer", () => {
  expect(consumerShared).toBe(shared);
  expect(rendered.ok).toBe(true);
});
