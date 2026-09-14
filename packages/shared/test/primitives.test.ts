import { describe, expect, it } from "vitest";

import {
  ApplicationError,
  createIsoDate,
  createUuid,
  err,
  isIsoDate,
  isSafeRelativePath,
  isUuid,
  joinSafeRelativePath,
  ok,
} from "../src/index.js";

describe("Result", () => {
  it("represents success and failure branches", () => {
    expect(ok("value")).toEqual({ ok: true, value: "value" });
    expect(err("failure")).toEqual({ ok: false, error: "failure" });
  });
});

describe("ApplicationError", () => {
  it("preserves a stable application error code", () => {
    const error = new ApplicationError("PROJECT_INVALID", "Project is invalid");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApplicationError");
    expect(error.code).toBe("PROJECT_INVALID");
  });
});

describe("identifiers and dates", () => {
  it("creates valid UUID v4 identifiers", () => {
    expect(isUuid(createUuid())).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("creates and validates ISO dates", () => {
    const date = createIsoDate();

    expect(isIsoDate(date)).toBe(true);
    expect(isIsoDate("2026-02-30T12:00:00.000Z")).toBe(false);
    expect(isIsoDate("2026-01-01")).toBe(false);
  });
});

describe("safe relative paths", () => {
  it.each([
    "manuscript/chapter.json",
    "manuscript\\chapter.json",
    "assets/images/cover.png",
  ])("accepts %s", (path) => {
    expect(isSafeRelativePath(path)).toBe(true);
  });

  it.each([
    "../outside.json",
    "manuscript/../../outside.json",
    "/absolute/file.json",
    "C:\\absolute\\file.json",
    "C:/absolute/file.json",
  ])("rejects %s", (path) => {
    expect(isSafeRelativePath(path)).toBe(false);
  });

  it("joins safe relative path segments", () => {
    expect(joinSafeRelativePath("manuscript", "chapter.json")).toBe(
      "manuscript/chapter.json",
    );
    expect(() =>
      joinSafeRelativePath("manuscript", "..", "outside.json"),
    ).toThrow();
  });
});
