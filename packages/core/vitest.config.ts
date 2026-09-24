import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@drelwick/core",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
