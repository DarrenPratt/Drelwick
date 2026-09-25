import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ProjectSnapshotSchema,
  type ProjectSnapshot,
} from "@drelwick/project-model";
import { MIGRATION_DIRECTORY, migrationError } from "./migration-state.js";

/** Complete local recovery copies deliberately do not use portable ZIP exclusions. */
export async function inspectSnapshot(
  root: string,
  omitRuntime = false,
): Promise<ProjectSnapshot> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw migrationError("MIGRATION_STATE_INVALID");
  const snapshot: ProjectSnapshot = { directories: [], files: [] };
  let bytes = 0;
  async function visit(relative: string, depth: number): Promise<void> {
    if (depth > 64) throw migrationError("MIGRATION_BACKUP_FAILED");
    const entries = (await readdir(join(root, relative))).sort();
    for (const name of entries) {
      if (
        !relative &&
        omitRuntime &&
        [
          MIGRATION_DIRECTORY,
          ".drelwick-publication-migration",
          ".chapter-create.lock",
        ].includes(name.toLowerCase()) &&
        name !== name.toLowerCase()
      )
        throw migrationError("MIGRATION_STATE_INVALID");
      if (
        !relative &&
        omitRuntime &&
        [
          MIGRATION_DIRECTORY,
          ".drelwick-publication-migration",
          ".chapter-create.lock",
        ].includes(name)
      )
        continue;
      const path = relative ? `${relative}/${name}` : name;
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink())
        throw migrationError("MIGRATION_BACKUP_FAILED");
      if (info.isDirectory()) {
        snapshot.directories.push(path);
        if (snapshot.directories.length > 10000)
          throw migrationError("MIGRATION_BACKUP_FAILED");
        await visit(path, depth + 1);
      } else if (info.isFile()) {
        bytes += info.size;
        if (snapshot.files.length >= 10000 || bytes > 2 * 1024 ** 3)
          throw migrationError("MIGRATION_BACKUP_FAILED");
        snapshot.files.push({
          path,
          size: info.size,
          sha256: await hashFile(join(root, path)),
        });
      } else throw migrationError("MIGRATION_BACKUP_FAILED");
    }
  }
  await visit("", 0);
  const parsed = ProjectSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw migrationError("MIGRATION_BACKUP_FAILED");
  return parsed.data;
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function sameSnapshot(
  left: ProjectSnapshot,
  right: ProjectSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function copySnapshot(
  source: string,
  destination: string,
  snapshot: ProjectSnapshot,
  afterFile: () => Promise<void>,
): Promise<void> {
  await mkdir(destination);
  for (const directory of snapshot.directories)
    await mkdir(join(destination, directory), { recursive: true });
  for (const file of snapshot.files) {
    await assertRegularPath(source, file.path);
    const target = join(destination, file.path);
    await copyFile(join(source, file.path), target, constants.COPYFILE_EXCL);
    const handle = await open(target, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(dirname(target));
    await afterFile();
  }
  // Flush directory entries as well as file contents on filesystems supporting it.
  for (const directory of [...snapshot.directories].reverse())
    await syncDirectory(join(destination, directory));
  await syncDirectory(destination);
  await syncDirectory(dirname(destination));
}

export async function assertRegularPath(
  root: string,
  path: string,
): Promise<void> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw migrationError("MIGRATION_STATE_INVALID");
  const parts = path.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current);
    if (
      info.isSymbolicLink() ||
      (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
    )
      throw migrationError("MIGRATION_STATE_INVALID");
  }
}

export async function syncDirectory(path: string): Promise<void> {
  // Node/Windows cannot open directories for fsync. Files themselves are always
  // flushed; retained backup/journal recovery assumes the filesystem honours them.
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
