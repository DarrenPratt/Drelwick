import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_NAMES = [
  "minimal-book",
  "multi-chapter-book",
  "formatted-book",
  "unicode-book",
  "invalid-project",
  "recovery-project",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

const fixturesDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

export function fixturePath(name: FixtureName): string {
  return join(fixturesDirectory, name);
}

export interface FixtureCopy {
  projectPath: string;
  cleanup(): Promise<void>;
}

export async function copyFixture(name: FixtureName): Promise<FixtureCopy> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "bookeditor-fixture-"));
  const projectPath = join(temporaryRoot, name);
  try {
    await cp(fixturePath(name), projectPath, {
      recursive: true,
      errorOnExist: true,
    });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  let cleaned = false;
  return {
    projectPath,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}
