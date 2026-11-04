import { expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const { unzipSync } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("fflate") as { unzipSync(bytes: Uint8Array): Record<string, Uint8Array> };
import type { PrintPreview } from "@drelwick/shared";
import {
  revisionProject,
  ACCEPTED_CONTROL,
  PROPOSED_CONTROL,
} from "../../../tests/helpers/revision-project.js";
const { save, choose } = vi.hoisted(() => ({ save: vi.fn(), choose: vi.fn() }));
vi.mock("electron", () => ({
  dialog: { showSaveDialog: save, showMessageBox: choose },
}));
import { exportDocx } from "../src/main/docx-export.js";
import { exportEpub } from "../src/main/epub-export.js";
import { exportPrint } from "../src/main/print-export.js";
import { prepareBookPreview } from "../src/main/book-preview.js";

it.each(["docx", "epub"] as const)(
  "E01/E02 %s requests a fresh operation choice, cancels without output and rejects changed source bytes",
  async (format) => {
    const f = await revisionProject();
    const run = format === "docx" ? exportDocx : exportEpub;
    try {
      let choice = 0,
        calls = 0;
      choose.mockImplementation(async (_window, options) => {
        if (options.title === "Choose manuscript text for this output") {
          calls++;
          expect(options.buttons).toHaveLength(3);
          expect(options.defaultId).toBe(2);
          return { response: choice };
        }
        return { response: 1 };
      });
      for (choice of [0, 1]) {
        const path = join(
          dirname(f.projectPath),
          `revision-${choice}.${format}`,
        );
        save.mockResolvedValue({ canceled: false, filePath: path });
        expect(
          (
            await run(
              {} as BrowserWindow,
              f.projectPath,
              f.projectId,
              () => true,
            )
          ).created,
        ).toBe(true);
        const text = Object.values(unzipSync(await readFile(path)))
          .map((part) => new TextDecoder().decode(part))
          .join("\n");
        expect(text).toContain(
          choice === 0 ? ACCEPTED_CONTROL : PROPOSED_CONTROL,
        );
        expect(text).not.toContain(
          choice === 0 ? PROPOSED_CONTROL : ACCEPTED_CONTROL,
        );
      }
      const path = join(dirname(f.projectPath), `preserved.${format}`),
        original = Buffer.from("Previous destination");
      await writeFile(path, original);
      save.mockClear();
      choice = 2;
      expect(
        (await run({} as BrowserWindow, f.projectPath, f.projectId, () => true))
          .created,
      ).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(await readFile(path)).toEqual(original);
      choice = 0;
      save.mockImplementation(async () => {
        await writeFile(
          f.chapterPath,
          Buffer.concat([await readFile(f.chapterPath), Buffer.from("\n")]),
        );
        return { canceled: false, filePath: path };
      });
      await expect(
        run({} as BrowserWindow, f.projectPath, f.projectId, () => true),
      ).rejects.toThrow();
      expect(await readFile(path)).toEqual(original);
      expect(calls).toBe(4);
    } finally {
      save.mockReset();
      choose.mockReset();
      await f.cleanup();
    }
  },
);

it("E01 preview requires its own projection and PDF cancellation does not reuse the preview choice", async () => {
  const f = await revisionProject();
  try {
    const accepted = await prepareBookPreview(
        f.projectPath,
        f.projectId,
        async () => "accepted",
      ),
      proposed = await prepareBookPreview(
        f.projectPath,
        f.projectId,
        async () => "proposed",
      );
    expect(accepted.markup).toContain(ACCEPTED_CONTROL);
    expect(accepted.markup).not.toContain(PROPOSED_CONTROL);
    expect(proposed.markup).toContain(PROPOSED_CONTROL);
    expect(proposed.markup).not.toContain(ACCEPTED_CONTROL);
    await expect(
      prepareBookPreview(f.projectPath, f.projectId, async () => null),
    ).rejects.toMatchObject({ code: "REVISION_PROJECTION_CANCELLED" });
    choose.mockResolvedValue({ response: 2 });
    save.mockClear();
    const result = await exportPrint(
      {} as BrowserWindow,
      f.projectPath,
      {
        revision: "a".repeat(64),
        export: { projection: "accepted" },
      } as PrintPreview,
      {
        authorized: () => true,
        signal: new AbortController().signal,
        acceptWarnings: true,
        progress: () => undefined,
      },
    );
    expect(result.created).toBe(false);
    expect(choose).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  } finally {
    save.mockReset();
    choose.mockReset();
    await f.cleanup();
  }
});
