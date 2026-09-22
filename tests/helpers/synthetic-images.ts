import { readFile } from "node:fs/promises";

/** Author-free, deterministic original image bytes shared by integration suites. */
export async function syntheticImage(
  format: "png" | "jpeg" = "png",
): Promise<Buffer> {
  const fixtures = JSON.parse(
    await readFile(
      new URL("../fixtures/synthetic-images.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, string>;
  return Buffer.from(fixtures[format]!, "base64");
}
