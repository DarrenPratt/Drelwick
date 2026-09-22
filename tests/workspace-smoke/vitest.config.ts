import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@sarel/workspace-smoke",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
