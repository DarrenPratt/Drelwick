import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Author-free, deterministic original image bytes shared by integration suites. */
export async function syntheticImage(
  format: "png" | "jpeg" = "png",
): Promise<Buffer> {
  const fixtures = JSON.parse(
    await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../fixtures/synthetic-images.json",
      ),
      "utf8",
    ),
  ) as Record<string, string>;
  return Buffer.from(fixtures[format]!, "base64");
}
