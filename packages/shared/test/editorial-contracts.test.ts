import { expect, it } from "vitest";
import { EditorialActionSchema } from "../src/index.js";
const projectId = "00000000-0000-4000-8000-000000000001";
const chapterId = "00000000-0000-4000-8000-000000000002";
const request = {
  operation: "reply",
  projectId,
  threadId: "00000000-0000-4000-8000-000000000003",
  body: "Synthetic reply",
  operationId: "00000000-0000-4000-8000-000000000004",
  expectedGeneration: 1,
  expectedFiles: {
    project: "a".repeat(64),
    editorial: "b".repeat(64),
    chapters: { [chapterId]: "c".repeat(64) },
  },
};
it("M02 requires bounded mutation preconditions and refuses renderer-controlled paths", () => {
  expect(EditorialActionSchema.safeParse(request).success).toBe(true);
  for (const field of ["operationId", "expectedGeneration", "expectedFiles"])
    expect(
      EditorialActionSchema.safeParse(
        Object.fromEntries(
          Object.entries(request).filter(([key]) => key !== field),
        ),
      ).success,
    ).toBe(false);
  expect(
    EditorialActionSchema.safeParse({ ...request, projectPath: "C:/outside" })
      .success,
  ).toBe(false);
  expect(
    EditorialActionSchema.safeParse({
      ...request,
      expectedGeneration: Number.MAX_SAFE_INTEGER + 1,
    }).success,
  ).toBe(false);
  expect(
    EditorialActionSchema.safeParse({
      ...request,
      expectedFiles: {
        ...request.expectedFiles,
        chapters: { "../outside": "a".repeat(64) },
      },
    }).success,
  ).toBe(false);
  expect(
    EditorialActionSchema.safeParse({
      ...request,
      expectedFiles: {
        ...request.expectedFiles,
        arbitraryFile: "a".repeat(64),
      },
    }).success,
  ).toBe(false);
});
