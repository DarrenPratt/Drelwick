import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SessionMarkerService } from "../src/main/session-marker.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("creates an unclean marker and detects it on the next startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "drelwick-session-"));
  directories.push(root);
  const first = new SessionMarkerService(root);
  const started = await first.start("2026-09-18T16:00:00.000Z");
  expect(started).toEqual({ previousSession: null, wasUnclean: false });
  expect(
    JSON.parse(await readFile(join(root, "session.json"), "utf8")),
  ).toMatchObject({
    schemaVersion: 1,
    started: "2026-09-18T16:00:00.000Z",
    cleanShutdown: false,
  });

  const second = new SessionMarkerService(root);
  await expect(second.start("2026-09-18T16:05:00.000Z")).resolves.toMatchObject(
    {
      wasUnclean: true,
    },
  );
});

it("marks only the active session clean", async () => {
  const root = await mkdtemp(join(tmpdir(), "drelwick-session-"));
  directories.push(root);
  const service = new SessionMarkerService(root);
  await service.start("2026-09-18T16:00:00.000Z");
  await service.markClean("2026-09-18T16:01:00.000Z");
  expect(
    JSON.parse(await readFile(join(root, "session.json"), "utf8")),
  ).toMatchObject({
    cleanShutdown: true,
    shutdown: "2026-09-18T16:01:00.000Z",
  });
});

it("rejects a corrupt marker without replacing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "drelwick-session-"));
  directories.push(root);
  const path = join(root, "session.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, '{"schemaVersion":1}', "utf8"),
  );
  await expect(new SessionMarkerService(root).start()).rejects.toThrow(
    "Unable to read the previous session marker.",
  );
  expect(await readFile(path, "utf8")).toBe('{"schemaVersion":1}');
});
