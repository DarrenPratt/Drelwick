import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@bookeditor/shared",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
