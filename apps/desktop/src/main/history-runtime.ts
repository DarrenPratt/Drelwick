import {
  applyHistoryRetention,
  createHistorySnapshot,
  HISTORY_SNAPSHOT_INTERVAL_MS,
  type HistoryRetentionResult,
} from "@drelwick/core";
import { safeErrorContext, type SafeLogger } from "@drelwick/shared";

export interface HistoryRuntimeOptions {
  snapshot?: typeof createHistorySnapshot;
  retain?: typeof applyHistoryRetention;
  logger: SafeLogger;
}

/** Serializes non-blocking history work so cleanup cannot race a snapshot write. */
export class HistoryRuntime {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly scheduled = new Map<
    string,
    Map<string, ScheduledSnapshot>
  >();
  private readonly snapshot: typeof createHistorySnapshot;
  private readonly retain: typeof applyHistoryRetention;
  private readonly logger: SafeLogger;
  private stopped = false;

  constructor(options: HistoryRuntimeOptions) {
    this.snapshot = options.snapshot ?? createHistorySnapshot;
    this.retain = options.retain ?? applyHistoryRetention;
    this.logger = options.logger;
  }

  scheduleSnapshot(input: {
    projectPath: string;
    projectId: string;
    chapterId: string;
    document: Record<string, unknown>;
  }): void {
    if (this.stopped) return;
    let project = this.scheduled.get(input.projectPath);
    if (!project) {
      project = new Map();
      this.scheduled.set(input.projectPath, project);
    }
    let scheduled = project.get(input.chapterId);
    if (scheduled) {
      scheduled.document = input.document;
      scheduled.lastSavedAt = Date.now();
      return;
    }
    scheduled = {
      projectId: input.projectId,
      chapterId: input.chapterId,
      document: input.document,
      lastSavedAt: Date.now(),
    };
    project.set(input.chapterId, scheduled);
    this.enqueueSnapshot(input.projectPath, scheduled);
    this.scheduleNext(input.projectPath, scheduled);
  }

  private enqueueSnapshot(
    projectPath: string,
    scheduled: ScheduledSnapshot,
  ): void {
    this.enqueue(projectPath, async () => {
      try {
        const snapshot = await this.snapshot({
          projectPath,
          chapterId: scheduled.chapterId,
          document: scheduled.document,
        });
        if (snapshot)
          this.logger.info("history.snapshot_created", {
            projectId: scheduled.projectId,
            chapterId: scheduled.chapterId,
          });
      } catch (error) {
        this.logger.error("history.snapshot_failed", {
          projectId: scheduled.projectId,
          chapterId: scheduled.chapterId,
          ...safeErrorContext(error),
        });
      }
    });
  }

  scheduleRetention(input: { projectPath: string; projectId: string }): void {
    if (this.stopped) return;
    this.enqueue(input.projectPath, async () => {
      try {
        const result: HistoryRetentionResult = await this.retain(
          input.projectPath,
        );
        if (result.removed > 0)
          this.logger.info("history.retention_completed", {
            projectId: input.projectId,
          });
      } catch (error) {
        this.logger.error("history.retention_failed", {
          projectId: input.projectId,
          ...safeErrorContext(error),
        });
      }
    });
  }

  async settleProject(projectPath: string): Promise<void> {
    await this.pending.get(projectPath);
  }

  async closeProject(projectPath: string): Promise<void> {
    const project = this.scheduled.get(projectPath);
    if (project) {
      for (const scheduled of project.values())
        if (scheduled.timer !== undefined) clearTimeout(scheduled.timer);
      this.scheduled.delete(projectPath);
    }
    await this.settleProject(projectPath);
  }

  async settleAll(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(this.pending.values());
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const projectPath of [...this.scheduled.keys()])
      await this.closeProject(projectPath);
    await this.settleAll();
  }

  private scheduleNext(
    projectPath: string,
    scheduled: ScheduledSnapshot,
  ): void {
    scheduled.timer = setTimeout(() => {
      delete scheduled.timer;
      const project = this.scheduled.get(projectPath);
      if (project?.get(scheduled.chapterId) !== scheduled) return;
      if (Date.now() - scheduled.lastSavedAt >= HISTORY_SNAPSHOT_INTERVAL_MS) {
        project.delete(scheduled.chapterId);
        if (project.size === 0) this.scheduled.delete(projectPath);
        return;
      }
      this.enqueueSnapshot(projectPath, scheduled);
      this.scheduleNext(projectPath, scheduled);
    }, HISTORY_SNAPSHOT_INTERVAL_MS);
  }

  private enqueue(projectPath: string, operation: () => Promise<void>): void {
    const previous = this.pending.get(projectPath) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(operation)
      .catch(() => undefined)
      .finally(() => {
        if (this.pending.get(projectPath) === task)
          this.pending.delete(projectPath);
      });
    this.pending.set(projectPath, task);
  }
}

interface ScheduledSnapshot {
  projectId: string;
  chapterId: string;
  document: Record<string, unknown>;
  lastSavedAt: number;
  timer?: ReturnType<typeof setTimeout>;
}
