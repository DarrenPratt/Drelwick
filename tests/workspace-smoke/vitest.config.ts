import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@bookeditor/workspace-smoke",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
