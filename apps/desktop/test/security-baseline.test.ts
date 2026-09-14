import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Electron security baseline", () => {
  it("does not use the deprecated remote module", async () => {
    const sourceFiles = [
      new URL("../src/main/main.ts", import.meta.url),
      new URL("../src/main/windows/main-window.ts", import.meta.url),
      new URL("../src/main/windows/window-options.ts", import.meta.url),
      new URL("../src/preload/preload.ts", import.meta.url),
    ];
    const source = (
      await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))
    ).join("\n");

    expect(source).not.toMatch(/\bremote\b/);
    expect(source).not.toContain("enableRemoteModule");
  });
});
