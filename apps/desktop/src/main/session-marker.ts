import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SessionMarkerSchema,
  type SessionMarker,
} from "@bookeditor/project-model";
import { createUuid } from "@bookeditor/shared";
import { writeJsonAtomically } from "@bookeditor/core";

export interface SessionStart {
  previousSession: SessionMarker | null;
  wasUnclean: boolean;
}

export class SessionMarkerService {
  private readonly markerPath: string;
  private currentSession: SessionMarker | undefined;

  constructor(userData: string) {
    this.markerPath = join(userData, "session.json");
  }

  async start(now = new Date().toISOString()): Promise<SessionStart> {
    const previousSession = await this.read();
    const currentSession: SessionMarker = {
      schemaVersion: 1,
      sessionId: createUuid(),
      started: now,
      cleanShutdown: false,
    };
    await mkdir(dirname(this.markerPath), { recursive: true });
    await writeJsonAtomically(this.markerPath, currentSession);
    this.currentSession = currentSession;
    return {
      previousSession,
      wasUnclean: previousSession !== null && !previousSession.cleanShutdown,
    };
  }

  async markClean(now = new Date().toISOString()): Promise<void> {
    const currentSession = this.currentSession;
    if (!currentSession) throw new Error("Session marker has not started.");
    await writeJsonAtomically(this.markerPath, {
      ...currentSession,
      cleanShutdown: true,
      started: currentSession.started,
      shutdown: now,
    });
  }

  private async read(): Promise<SessionMarker | null> {
    try {
      return SessionMarkerSchema.parse(
        JSON.parse(await readFile(this.markerPath, "utf8")),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      throw new Error("Unable to read the previous session marker.");
    }
  }
}
