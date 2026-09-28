import { describe, expect, it } from "vitest";

import { getMainWindowOptions } from "../src/main/windows/window-options.js";

describe("main window security", () => {
  it("isolates the renderer from Node.js APIs", () => {
    const options = getMainWindowOptions("preload.js");

    expect(options.webPreferences).toMatchObject({
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: "preload.js",
    });
  });
});
