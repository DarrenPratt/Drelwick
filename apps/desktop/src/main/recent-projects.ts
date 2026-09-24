import { mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { RecentProjectsSettingsSchema } from "@drelwick/project-model";
import { writeJsonAtomically } from "@drelwick/core";
import { createUuid, type RecentProject } from "@drelwick/shared";

/** Application settings only. Mutations are serialized and committed atomically. */
export class RecentProjects {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly userData: string) {}

  private async read(): Promise<RecentProject[]> {
    try {
      const { projects } = RecentProjectsSettingsSchema.parse(
        JSON.parse(
          await readFile(join(this.userData, "recent-projects.json"), "utf8"),
        ),
      );
      if (projects.some((project) => !isAbsolute(project.path)))
        throw new Error("Recent project paths must be absolute.");
      return projects;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      // Preserve corrupt/unsupported settings for recovery; never overwrite them.
      throw new Error("Unable to read recent projects.");
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  list(): Promise<RecentProject[]> {
    return this.serialize(() => this.read());
  }

  async find(id: string): Promise<RecentProject | undefined> {
    return (await this.list()).find((project) => project.id === id);
  }

  add(path: string, title: string): Promise<void> {
    return this.serialize(async () => {
      const canonical = await realpath(path);
      const key = (value: string) =>
        process.platform === "win32" ? value.toLowerCase() : value;
      const projects = await this.read();
      const existing = projects.find(
        (project) => key(project.path) === key(canonical),
      );
      await this.write([
        { id: existing?.id ?? createUuid(), path: canonical, title },
        ...projects.filter((project) => key(project.path) !== key(canonical)),
      ]);
    });
  }

  remove(id: string): Promise<RecentProject[]> {
    return this.serialize(async () => {
      const projects = (await this.read()).filter(
        (project) => project.id !== id,
      );
      await this.write(projects);
      return projects;
    });
  }

  private async write(projects: RecentProject[]): Promise<void> {
    await mkdir(this.userData, { recursive: true });
    await writeJsonAtomically(join(this.userData, "recent-projects.json"), {
      schemaVersion: 1,
      projects,
    });
  }
}
