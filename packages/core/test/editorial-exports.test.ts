import { afterEach, expect, it } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import {
  assembleBook,
  generateDocx,
  generateEpub,
  createProjectArchive,
  restoreProjectArchive,
} from "../src/index.js";
import { inspectSnapshot } from "../src/project-snapshot.js";
import {
  editorialProject,
  EDITORIAL_CANARIES,
  PUBLICATION_CONTROL,
} from "../../../tests/helpers/editorial-project.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
it("E03 exports only public text in every DOCX/EPUB part while archives retain exact editorial bytes without periodic history", async () => {
  const fixture = await editorialProject();
  cleanups.push(fixture.cleanup);
  const scratch = await mkdtemp(join(tmpdir(), "editorial-exports-"));
  cleanups.push(() => rm(scratch, { recursive: true, force: true }));
  const state = JSON.parse(await readFile(fixture.editorialPath, "utf8"));
  expect(
    state.anchors.every(
      (anchor: { status: string }) => anchor.status === "orphaned",
    ),
  ).toBe(true);
  const captured = await assembleBook(fixture.projectPath);
  for (const output of [generateDocx(captured), generateEpub(captured)]) {
    const parts = unzipSync(output.bytes);
    let text = "";
    for (const [name, bytes] of Object.entries(parts)) {
      text += new TextDecoder().decode(bytes);
      for (const canary of EDITORIAL_CANARIES)
        expect(new TextDecoder().decode(bytes), name).not.toContain(canary);
      expect(name).not.toMatch(/comments|people|customXml|editorial/i);
    }
    expect(text).toContain(PUBLICATION_CONTROL);
    expect(text).not.toMatch(
      /<w:(?:ins|del|commentRangeStart|commentReference|highlight)\b/,
    );
  }
  const archivePath = join(scratch, "backup.zip");
  const original = (
    await inspectSnapshot(fixture.projectPath, true)
  ).files.filter(
    (file) =>
      file.path.startsWith("editorial/") || file.path.startsWith(".editorial/"),
  );
  await createProjectArchive({
    projectPath: fixture.projectPath,
    archivePath,
    includeHistory: false,
  });
  const restored = await restoreProjectArchive({
    archivePath,
    destinationParent: scratch,
  });
  for (const file of original)
    expect(
      await readFile(join(restored.projectPath, file.path)),
      file.path,
    ).toEqual(await readFile(join(fixture.projectPath, file.path)));
  const zip = unzipSync(await readFile(archivePath));
  expect(Object.keys(zip).some((name) => name.startsWith(".history/"))).toBe(
    false,
  );
  expect(Object.keys(zip)).toContain("editorial/state.json");
  expect(
    Object.keys(zip).some((name) => name.startsWith(".editorial/drafts/")),
  ).toBe(true);
});
