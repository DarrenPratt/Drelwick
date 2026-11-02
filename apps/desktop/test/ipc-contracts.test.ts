import { describe, expect, it } from "vitest";

import { IPC, validateIpcPayload } from "@drelwick/shared";

describe("IPC contracts", () => {
  it("scopes editorial draft discovery to a project identity without renderer paths", () => {
    const request = {
      operation: "drafts",
      projectId: "00000000-0000-4000-8000-000000000001",
    };
    expect(validateIpcPayload(IPC.EDITORIAL_ACTION, request)).toEqual(request);
    expect(() =>
      validateIpcPayload(IPC.EDITORIAL_ACTION, {
        ...request,
        projectPath: "C:/other",
      }),
    ).toThrow();
    expect(() =>
      validateIpcPayload(IPC.EDITORIAL_ACTION, {
        ...request,
        projectId: "../other",
      }),
    ).toThrow();
  });
  it("accepts valid chapter requests", () => {
    expect(
      validateIpcPayload(IPC.CHAPTER_RENAME, {
        chapterId: "chapter-1",
        title: "Renamed chapter",
      }),
    ).toEqual({ chapterId: "chapter-1", title: "Renamed chapter" });
  });

  it("rejects malformed requests before a handler can use them", () => {
    expect(() =>
      validateIpcPayload(IPC.CHAPTER_REORDER, { chapterIds: [""] }),
    ).toThrow();
    expect(() =>
      validateIpcPayload(IPC.PROJECT_CREATE, { path: "outside-project" }),
    ).toThrow();
    expect(() =>
      validateIpcPayload(IPC.APPLICATION_RENDERER_ERROR, {
        errorName: "Error",
        message: "manuscript content",
      }),
    ).toThrow();
  });

  it("accepts sanitized renderer error classification only", () => {
    expect(
      validateIpcPayload(IPC.APPLICATION_RENDERER_ERROR, {
        errorName: "TypeError",
      }),
    ).toEqual({ errorName: "TypeError" });
  });
});
