import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@bookeditor/desktop",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
