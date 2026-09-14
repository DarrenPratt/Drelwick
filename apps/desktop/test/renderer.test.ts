import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("renderer application", () => {
  it("has a browser-only entry point", async () => {
    const source = await readFile(
      new URL("../src/renderer/main.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("electron");
    expect(source).not.toContain("node:");
  });
});
