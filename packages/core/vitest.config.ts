import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@sarel/core",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
