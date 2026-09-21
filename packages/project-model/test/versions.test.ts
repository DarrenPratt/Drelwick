import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturePath } from "../../../tests/helpers/fixture-projects.js";
import {
  ProjectConfigV1Schema,
  ProjectConfigV2Schema,
  ProjectConfigSchema,
  ProjectFormatSchema,
  detectProjectVersion,
  migrateV1Manifest,
} from "../src/index.js";

describe("explicit project version boundaries", () => {
  it.each([
    [{ schemaVersion: 1 }, "older"],
    [{ schemaVersion: 2 }, "current"],
    [{ schemaVersion: 3 }, "newer"],
    [{}, "malformed"],
    [null, "malformed"],
    [{ schemaVersion: "1" }, "malformed"],
    [{ schemaVersion: 0 }, "malformed"],
    [{ schemaVersion: 1.5 }, "malformed"],
    [{ schemaVersion: Infinity }, "malformed"],
  ])("detects %j as %s", (input, kind) => {
    expect(detectProjectVersion(input).kind).toBe(kind);
  });

  it("retains a historical V1 schema and transforms a real fixture into explicit V2", async () => {
    const source = await readFile(
      join(fixturePath("multi-chapter-book"), "project.json"),
      "utf8",
    );
    const v1 = ProjectConfigV1Schema.parse(JSON.parse(source) as unknown);
    expect(ProjectConfigV2Schema.safeParse(v1).success).toBe(false);
    const v2 = ProjectConfigV2Schema.parse(
      JSON.parse(migrateV1Manifest(source)) as unknown,
    );
    expect(v2).toEqual({ ...v1, schemaVersion: 2, formatFile: "format.json" });
    expect(ProjectConfigV1Schema.safeParse(v2).success).toBe(false);
    expect(ProjectConfigSchema.safeParse(v2).success).toBe(true);
    expect(
      ProjectConfigSchema.safeParse({ ...v2, schemaVersion: 3 }).success,
    ).toBe(false);
    expect(
      ProjectFormatSchema.safeParse({
        schemaVersion: 1,
        projectId: v1.projectId,
        bookSchemaVersion: 1,
        chapterSchemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate top-level keys and conflicting unknown format fields", async () => {
    const source = await readFile(
      join(fixturePath("unicode-book"), "project.json"),
      "utf8",
    );
    expect(() =>
      migrateV1Manifest(
        source.replace(
          '"schemaVersion": 1',
          '"schemaVersion": 1, "schemaVersion": 1',
        ),
      ),
    ).toThrow();
    expect(() =>
      migrateV1Manifest(
        source.replace(
          '"schemaVersion": 1',
          '"schemaVersion": 1, "formatFile": "author-notes.json"',
        ),
      ),
    ).toThrow();
  });
});
