function normaliseSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

export function isSafeRelativePath(path: string): boolean {
  const normalisedPath = normaliseSeparators(path);
  if (
    normalisedPath.length === 0 ||
    normalisedPath.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalisedPath)
  ) {
    return false;
  }

  const segments = normalisedPath.split("/");
  return segments.every((segment) => segment !== "" && segment !== "..");
}

export function joinSafeRelativePath(...segments: string[]): string {
  const path = segments.join("/");
  if (!isSafeRelativePath(path)) {
    throw new Error("Path must be a safe relative path");
  }

  return normaliseSeparators(path);
}
