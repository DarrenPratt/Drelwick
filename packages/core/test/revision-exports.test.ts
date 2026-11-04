import { expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import {
  revisionProject,
  ACCEPTED_CONTROL,
  PROPOSED_CONTROL,
  REVISION_PRIVATE,
} from "../../../tests/helpers/revision-project.js";
import { EDITORIAL_CANARIES } from "../../../tests/helpers/editorial-project.js";
import { assembleBook, generateDocx, generateEpub } from "../src/index.js";
import { assertAssembledBookCurrent } from "../src/book-assembly.js";

it("E01–E03 inspects every actual DOCX/EPUB part for the selected text state and private review canaries", async () => {
  const f = await revisionProject();
  try {
    const before = await readFile(f.chapterPath);
    for (const projection of ["accepted", "proposed"] as const) {
      const book = await assembleBook(f.projectPath, {
        chooseProjection: async (scope) => {
          expect(scope.count).toBe(2);
          return projection;
        },
      });
      for (const output of [generateDocx(book), generateEpub(book)]) {
        const parts = unzipSync(output.bytes);
        let text = "";
        for (const [name, bytes] of Object.entries(parts)) {
          const part = new TextDecoder().decode(bytes);
          text += part;
          expect(name).not.toMatch(/comments|people|customXml|editorial/iu);
          for (const canary of [
            ...EDITORIAL_CANARIES,
            REVISION_PRIVATE,
            ...f.view.state.review.pending.map((g) => g.id),
          ])
            expect(part, name).not.toContain(canary);
          expect(part).not.toMatch(
            /<w:(?:ins|del|commentRangeStart|commentReference)\b/u,
          );
        }
        expect(text).toContain(
          projection === "accepted" ? ACCEPTED_CONTROL : PROPOSED_CONTROL,
        );
        expect(text).not.toContain(
          projection === "accepted" ? PROPOSED_CONTROL : ACCEPTED_CONTROL,
        );
      }
    }
    await expect(
      assembleBook(f.projectPath, { chooseProjection: async () => null }),
    ).rejects.toMatchObject({ code: "REVISION_PROJECTION_CANCELLED" });
    expect(await readFile(f.chapterPath)).toEqual(before);
    const captured = await assembleBook(f.projectPath, {
      projection: "accepted",
    });
    await writeFile(f.chapterPath, Buffer.concat([before, Buffer.from("\n")]));
    await expect(assertAssembledBookCurrent(captured)).rejects.toThrow();
  } finally {
    await f.cleanup();
  }
});
