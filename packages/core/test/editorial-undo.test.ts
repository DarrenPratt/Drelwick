import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { EditorialStateSchema } from "@drelwick/project-model";
import {
  applyEditorialUndo,
  captureEditorialUndo,
} from "../src/editorial-undo.js";

const original = EditorialStateSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        "../../../docs/examples/editorial-v1/project/editorial/state.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

it("undoes only touched records and preserves disjoint discussions through redo", () => {
  const edited = structuredClone(original);
  edited.anchors[0]!.status = "unverified";
  const delta = captureEditorialUndo(original, edited);
  expect(delta.changes).toHaveLength(1);
  const concurrent = structuredClone(edited);
  concurrent.threads[0]!.comments[0]!.body = "Independent later discussion";
  const undone = applyEditorialUndo(concurrent, delta, "undo");
  expect(undone.anchors).toEqual(original.anchors);
  expect(undone.threads).toEqual(concurrent.threads);
  expect(applyEditorialUndo(undone, delta, "redo")).toEqual(concurrent);
  expect(concurrent.anchors[0]!.status).toBe("unverified");
});

it("refuses stale companion undo without changing any shared records", () => {
  const edited = structuredClone(original);
  edited.anchors[0]!.status = "unverified";
  const delta = captureEditorialUndo(original, edited);
  edited.anchors[0]!.modified = "2026-10-28T12:00:00.000Z";
  const preserved = structuredClone(edited);
  expect(() => applyEditorialUndo(edited, delta, "undo")).toThrow(
    "EDITORIAL_STALE",
  );
  expect(edited).toEqual(preserved);
});
