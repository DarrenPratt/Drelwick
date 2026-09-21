import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? "github" : "list",
  outputDir: "test-results",
  timeout: 45_000,
  use: {
    trace: "retain-on-failure",
  },
});
