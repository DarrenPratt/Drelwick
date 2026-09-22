export const CURRENT_PROJECT_VERSION = 2;
export type VersionDetection =
  | { kind: "current"; version: number }
  | { kind: "older"; version: number }
  | { kind: "newer"; version: number }
  | { kind: "malformed" };

/** Inspect the envelope before applying any historical or current schema. */
export function detectProjectVersion(
  value: unknown,
  current = CURRENT_PROJECT_VERSION,
): VersionDetection {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value)
  )
    return { kind: "malformed" };
  const version = value.schemaVersion;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    return { kind: "malformed" };
  return {
    kind:
      version === current ? "current" : version > current ? "newer" : "older",
    version,
  };
}
