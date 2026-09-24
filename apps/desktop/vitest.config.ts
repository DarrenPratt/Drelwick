import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@drelwick/desktop",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
