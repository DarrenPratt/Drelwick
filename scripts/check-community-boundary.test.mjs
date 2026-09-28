import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCommunityBoundary } from "./check-community-boundary.mjs";

// Construct negative examples as data, not real forbidden module references.
const proprietary = ["@drelwick", "pro"].join("/");
const privateRepository = ["Drelwick", "Pro"].join("-");
const community = { drelwick: ".", "@drelwick/core": "packages/core" };
function fixture() {
  return new Map([
    ["package.json", JSON.stringify({ name: "drelwick" })],
    ["packages/core/package.json", JSON.stringify({ name: "@drelwick/core" })],
    [
      "pnpm-workspace.yaml",
      'packages:\n  - "apps/*"\n  - "packages/*"\n  - "tests/workspace-smoke"\n',
    ],
  ]);
}
function rejected(file, source, pattern) {
  const files = fixture();
  files.set(file, source);
  const errors = checkCommunityBoundary(files, community);
  assert.ok(
    errors.some((error) => error.includes(pattern)),
    errors.join("\n"),
  );
  assert.ok(
    errors.every((error) =>
      error.includes(
        "Community packages must not depend on Drelwick Pro packages.",
      ),
    ),
  );
}

test("Community imports, builtins, third-party modules and ordinary project words pass", () => {
  const files = fixture();
  files.set(
    "consumer.ts",
    'import type { X } from "@drelwick/core"; export * from "./local.js"; import("node:fs"); require("typescript"); const name = "ProseMirror project";',
  );
  assert.deepEqual(checkCommunityBoundary(files, community), []);
});

for (const field of [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  test(`rejects Pro ${field}, even aliased`, () => {
    rejected(
      "package.json",
      JSON.stringify({
        name: "drelwick",
        [field]: { harmless: `npm:${proprietary}@1.0.0` },
      }),
      "Manifest references Pro",
    );
  });
}

for (const source of [
  `import type { X } from "${proprietary}";`,
  `export * from "${proprietary}/feature";`,
  `import("${proprietary}");`,
  `require("${proprietary}");`,
  `require.resolve("${proprietary}");`,
  `type X = import("${proprietary}").X;`,
  `import X = require("${proprietary}");`,
  `const modulePath = "../../${privateRepository}/index.js";`,
]) {
  test(`rejects prohibited executable reference: ${source}`, () => {
    rejected("packages/core/src/example.ts", source, "Pro");
  });
}

test("rejects computed module loading instead of silently skipping it", () => {
  rejected(
    "entry.ts",
    'import("@drelwick/" + product);',
    "Computed module loading",
  );
  rejected("entry.ts", "require(moduleName)", "Computed module loading");
});
test("new packages require an explicit Community classification", () => {
  rejected(
    "packages/new/package.json",
    '{"name":"@drelwick/new"}',
    "not in the reviewed Community inventory",
  );
  rejected("entry.ts", 'import "@drelwick/unclassified";', "Unclassified");
});
test("root tooling and workspace dependencies cannot use sibling checkouts", () => {
  rejected(
    "package.json",
    JSON.stringify({
      name: "drelwick",
      dependencies: { helper: "link:../private" },
    }),
    "escapes",
  );
  rejected("entry.ts", 'import "../private/entry.js";', "escapes");
  rejected(
    "package.json",
    JSON.stringify({
      name: "drelwick",
      dependencies: { "@drelwick/core": "^1.0.0" },
    }),
    "workspace:*",
  );
});
test("workspace globs cannot silently include another repository", () => {
  rejected(
    "pnpm-workspace.yaml",
    'packages:\n  - "../*"\n',
    "Workspace discovery changed",
  );
});
test("configuration aliases and CI references are checked", () => {
  rejected(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: { paths: { alias: [`../${privateRepository}`] } },
    }),
    "Pro",
  );
  rejected(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { paths: { alias: ["../private"] } } }),
    "escapes",
  );
  rejected(
    ".github/workflows/ci.yml",
    `repository: owner/${privateRepository}`,
    "Configuration references Pro",
  );
});
test("Pro cannot be added to the Community inventory", () => {
  const files = fixture();
  files.set(
    "packages/extra/package.json",
    JSON.stringify({ name: proprietary }),
  );
  assert.ok(
    checkCommunityBoundary(files, {
      ...community,
      [proprietary]: "packages/extra",
    }).some((error) => error.includes("cannot be classified")),
  );
});

test("rejects environment coupling and absolute compiler paths", () => {
  const variable = ["DRELWICK", "PRO", "PATH"].join("_");
  rejected("entry.ts", `const path = process.env.${variable};`, "Pro");
  for (const target of ["/private/types", "C:/private/types"]) {
    rejected(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { alias: [target] } } }),
      "Non-portable",
    );
  }
});
