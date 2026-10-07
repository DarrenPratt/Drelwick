import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const requireFromBuilder = createRequire(require.resolve("electron-builder"));
type Mapping = { from?: string; to?: string; filter: string[] };
type Config = {
  files: (string | Mapping)[];
  linux: { executableName: string };
};
const { getConfig, validateConfiguration } = requireFromBuilder(
  "app-builder-lib/out/util/config/config.js",
) as {
  getConfig(
    directory: string,
    path: string,
    overrides: undefined,
  ): Promise<Config>;
  validateConfiguration(
    config: Config,
    logger: { isEnabled: boolean },
  ): Promise<void>;
};
const includeNativeImages =
  require("../scripts/include-native-images.cjs") as (context: {
    packager: { config: Config };
  }) => Promise<void>;
type Filter = (path: string, stat: { isDirectory(): boolean }) => boolean;
const { getNodeModuleFileMatcher, FileMatcher } = requireFromBuilder(
  "app-builder-lib/out/fileMatcher.js",
) as {
  getNodeModuleFileMatcher(
    source: string,
    destination: string,
    expand: (value: string) => string,
    platform: object,
    packager: { config: Config; debugLogger: { isEnabled: boolean } },
  ): { createFilter(): Filter };
  FileMatcher: new (
    source: string,
    destination: string,
    expand: (value: string) => string,
    patterns: string[],
  ) => { createFilter(): Filter };
};

it("copies native image packages exactly once even when dependency collection finds them", async () => {
  const config = await getConfig(desktop, "electron-builder.yml", undefined);
  expect(config.linux.executableName).toBe("drelwick");
  await includeNativeImages({ packager: { config } });
  const firstPass = structuredClone(config.files);
  await includeNativeImages({ packager: { config } });
  expect(config.files).toEqual(firstPass);

  const collected = getNodeModuleFileMatcher(
    desktop,
    join(desktop, "release"),
    (value) => value,
    {},
    { config, debugLogger: { isEnabled: false } },
  ).createFilter();
  const mappings = config.files.filter(
    (entry): entry is Mapping & { from: string; to: string } =>
      typeof entry !== "string" &&
      Boolean(entry.from && entry.to?.startsWith("node_modules/@img/sharp-")),
  );
  expect(mappings.length).toBeGreaterThan(0);
  for (const mapping of mappings) {
    const explicit = new FileMatcher(
      mapping.from,
      mapping.to,
      (value) => value,
      mapping.filter,
    ).createFilter();
    // Include the Linux paths that previously collided during ASAR hard-linking.
    for (const file of [
      "package.json",
      "lib/index.js",
      "lib/glib-2.0/include/glibconfig.h",
      "lib/sharp.node",
    ]) {
      const stat = { isDirectory: () => false };
      expect(collected(join(desktop, mapping.to, file), stat)).toBe(false);
      expect(explicit(join(mapping.from, file), stat)).toBe(true);
    }
  }
  expect(
    collected(join(desktop, "node_modules/other/package.json"), {
      isDirectory: () => false,
    }),
  ).toBe(true);
});

it("resolves all platform targets and preserves dependency runtime source", async () => {
  const config = await getConfig(desktop, "electron-builder.yml", undefined);
  await validateConfiguration(config, { isEnabled: false });
  const collected = getNodeModuleFileMatcher(
    desktop,
    join(desktop, "release"),
    (value) => value,
    {},
    { config, debugLogger: { isEnabled: false } },
  ).createFilter();
  const stat = { isDirectory: () => false };
  expect(
    collected(join(desktop, "node_modules/runtime-library/src/index.js"), stat),
  ).toBe(true);
  expect(
    collected(join(desktop, "node_modules/@drelwick/core/src/index.ts"), stat),
  ).toBe(false);
  expect(
    collected(
      join(desktop, "node_modules/@drelwick/core/dist/docx-parser.bundle.js"),
      stat,
    ),
  ).toBe(true);
  expect(
    collected(join(desktop, "node_modules/dictionary-en/index.dic"), stat),
  ).toBe(true);
  expect(
    collected(
      join(desktop, "node_modules/runtime-library/tests/example.js"),
      stat,
    ),
  ).toBe(false);
});
