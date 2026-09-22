import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@sarel/project-model",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
