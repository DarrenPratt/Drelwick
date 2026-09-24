import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { configureApplicationIdentity } from "../src/main/application-identity.js";

it.each([false, true])(
  "preserves settings and recovery data (explicit directory: %s)",
  async (explicitDirectory) => {
    const root = await mkdtemp(join(tmpdir(), "drelwick-identity-"));
    try {
      const expected = explicitDirectory
        ? join(root, "isolated-profile")
        : join(root, "@drelwick", "desktop");
      await mkdir(expected, { recursive: true });
      await writeFile(
        join(expected, "session.json"),
        '{"cleanShutdown":false}',
      );
      await writeFile(
        join(expected, "recent-projects.json"),
        '{"projects":[]}',
      );
      const paths = new Map([
        ["appData", root],
        ["userData", explicitDirectory ? expected : join(root, "Drelwick")],
      ]);
      const setName = vi.fn();
      configureApplicationIdentity({
        commandLine: {
          hasSwitch: () => explicitDirectory,
        },
        getPath: (name) => paths.get(name)!,
        setPath: (name, value) => {
          paths.set(name, value);
        },
        setName,
      });
      expect(setName).toHaveBeenCalledWith("Drelwick");
      expect(paths.get("userData")).toBe(expected);
      expect(paths.get("sessionData")).toBe(expected);
      expect(await readFile(join(expected, "session.json"), "utf8")).toBe(
        '{"cleanShutdown":false}',
      );
      expect(
        await readFile(join(expected, "recent-projects.json"), "utf8"),
      ).toBe('{"projects":[]}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
