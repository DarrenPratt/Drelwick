import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const stopSmokeProcess = require("../scripts/stop-smoke-process.cjs") as (
  child?: ChildProcess,
) => Promise<void>;

it("reaps the isolated smoke process even when graceful termination is ignored", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("ready");',
    ],
    {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    },
  );
  try {
    await once(child.stdout!, "data");
    await stopSmokeProcess(child);
    expect(child.signalCode).toBe("SIGKILL");
    await stopSmokeProcess(child);
    await stopSmokeProcess(undefined);
  } finally {
    child.kill("SIGKILL");
  }
});
