import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@drelwick/workspace-smoke",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
