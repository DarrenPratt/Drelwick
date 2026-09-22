import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@sarel/desktop",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
