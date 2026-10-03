import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.pnpm-store/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/coverage/**",
    "**/generated/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/release/**",
    "**/package-smoke-*/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    extends: [js.configs.recommended],
  },
  {
    files: ["**/*.{ts,mts,cts,tsx}"],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ["**/*.{jsx,tsx}"],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat["jsx-runtime"],
      reactHooks.configs.flat.recommended,
    ],
    // No React runtime is installed yet; these rules target the modern JSX runtime.
    settings: { react: { version: "19.0" } },
  },
  {
    files: ["**/*.tsx"],
    rules: { "react/prop-types": "off" },
  },
  {
    files: [
      "*.{js,mjs,cjs,ts,mts,cts}",
      "**/*.config.{js,mjs,cjs,ts,mts,cts}",
      "scripts/**/*.{js,mjs,cjs,ts,mts,cts}",
      "tests/**/*.{js,mjs,cjs,ts,mts,cts}",
      "**/test/**/*.{js,mjs,cjs,ts,mts,cts}",
      "apps/*/src/{main,preload}/**/*.{js,ts}",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/*/src/renderer/**/*.{js,jsx,ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  prettier,
]);
