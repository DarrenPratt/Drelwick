import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("runs the built preload with only the sandbox's Electron require", async () => {
  const source = await readFile(
    new URL("../dist/preload/preload.cjs", import.meta.url),
    "utf8",
  );
  const exposeInMainWorld = vi.fn();
  runInNewContext(source, {
    require: (name: string) => {
      expect(name).toBe("electron");
      return {
        contextBridge: { exposeInMainWorld },
        ipcRenderer: { invoke: vi.fn() },
      };
    },
  });
  expect(exposeInMainWorld).toHaveBeenCalledWith(
    "drelwick",
    expect.objectContaining({
      project: expect.objectContaining({
        create: expect.any(Function),
        selectLocation: expect.any(Function),
      }),
    }),
  );
});
