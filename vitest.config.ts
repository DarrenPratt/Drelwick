import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Filesystem suites flush real projects and launch recovery child processes.
    // Bound disk contention instead of scaling those writers with CPU count.
    maxWorkers: 4,
    projects: [
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      "tests/workspace-smoke/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/*.{test,spec}.{ts,tsx}"],
    },
  },
});
