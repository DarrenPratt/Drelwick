import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@bookeditor/core",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
