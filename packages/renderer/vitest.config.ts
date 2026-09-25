import { defineProject } from "vitest/config";
export default defineProject({
  test: {
    name: "@drelwick/renderer",
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
