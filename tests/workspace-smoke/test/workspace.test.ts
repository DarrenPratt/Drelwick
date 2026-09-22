import { expect, test } from "vitest";
import * as shared from "@sarel/shared";
import { shared as consumerShared } from "../src/index.js";

test("resolves the built workspace dependency through the consumer", () => {
  expect(consumerShared).toBe(shared);
});
