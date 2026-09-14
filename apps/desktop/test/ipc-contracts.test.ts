import { describe, expect, it } from "vitest";

import { IPC, validateIpcPayload } from "@bookeditor/shared";

describe("IPC contracts", () => {
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
  });
});
