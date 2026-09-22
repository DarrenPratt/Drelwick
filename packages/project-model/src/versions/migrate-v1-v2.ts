import { ProjectConfigSchema as V1 } from "./v1.js";
import { ProjectConfigV2Schema } from "./v2.js";

/** Historical, pure transformation: preserve even unknown JSON number/string spellings. */
export function migrateV1Manifest(source: string): string {
  const raw: unknown = JSON.parse(source);
  V1.parse(raw);
  if (typeof raw !== "object" || raw === null || "formatFile" in raw)
    throw new Error("Conflicting format descriptor field");
  const tokens = /"(?:\\.|[^"\\])*"|[{}[\]]/g;
  let depth = 0;
  let versionStart = -1;
  let versionEnd = -1;
  const keys = new Set<string>();
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    if (token === "{" || token === "[") depth++;
    else if (token === "}" || token === "]") depth--;
    else if (depth === 1) {
      const after = source.slice(match.index + token.length);
      const colon = /^\s*:\s*/.exec(after);
      if (!colon) continue;
      const key = JSON.parse(token) as string;
      if (keys.has(key)) throw new Error("Ambiguous manifest keys");
      keys.add(key);
      if (key === "schemaVersion") {
        const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
          after.slice(colon[0].length),
        );
        if (!number) throw new Error("Invalid manifest version");
        versionStart = match.index + token.length + colon[0].length;
        versionEnd = versionStart + number[0].length;
      }
    }
  }
  if (versionStart < 0) throw new Error("Missing manifest version");
  const updated = `${source.slice(0, versionStart)}2${source.slice(versionEnd)}`;
  const end = updated.lastIndexOf("}");
  const result = `${updated.slice(0, end)},"formatFile":"format.json"${updated.slice(end)}`;
  ProjectConfigV2Schema.parse(JSON.parse(result) as unknown);
  return result;
}
