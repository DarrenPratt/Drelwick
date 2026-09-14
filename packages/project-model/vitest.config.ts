import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@bookeditor/project-model",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
