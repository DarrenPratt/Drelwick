import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@drelwick/project-model",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
