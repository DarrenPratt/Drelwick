import { ipcMain, type BrowserWindow } from "electron";
import { RecoveryService } from "@drelwick/core";
import {
  ApplicationError,
  IPC,
  IpcRequestSchemas,
  noopLogger,
  safeErrorContext,
  type RecoveryCandidateSummary,
  type SafeLogger,
} from "@drelwick/shared";

export function registerRecoveryHandlers(
  getWindow: () => BrowserWindow | undefined,
  rendererUrl: string,
  service: RecoveryService,
  cancelStartup: () => void,
  scanError?: string,
  logger: SafeLogger = noopLogger,
): void {
  let busy = false;
  const summaries = (): RecoveryCandidateSummary[] =>
    service
      .getCandidates()
      .map(({ id, projectPath, chapterId, title, created, source }) => ({
        id,
        projectPath,
        chapterId,
        title: title ?? `Chapter ${chapterId}`,
        created,
        source,
      }));
  for (const channel of [
    IPC.RECOVERY_LIST,
    IPC.RECOVERY_RECOVER,
    IPC.RECOVERY_DISCARD,
    IPC.RECOVERY_CANCEL,
  ] as const) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const failure = (code: string, message: string) => ({
        ok: false as const,
        error: { code, message },
      });
      const window = getWindow();
      if (
        !window ||
        window.isDestroyed() ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame?.url !== rendererUrl
      )
        return failure(
          "RECOVERY_ACCESS_DENIED",
          "Recovery access is not permitted.",
        );
      const parsed = IpcRequestSchemas[channel].safeParse(payload);
      if (!parsed.success)
        return failure("RECOVERY_INPUT_INVALID", "Invalid recovery request.");
      if (busy)
        return failure(
          "RECOVERY_BUSY",
          "Please wait for the current recovery operation.",
        );
      if (channel === IPC.RECOVERY_CANCEL) {
        if (!scanError && service.getCandidates().length === 0)
          return failure(
            "RECOVERY_NOT_PENDING",
            "Startup recovery has already completed.",
          );
        // Bypass normal clean shutdown: unresolved files must be scanned next time.
        logger.warn("recovery.cancelled", {
          candidateCount: service.getCandidates().length,
          scanFailed: Boolean(scanError),
        });
        cancelStartup();
        return { ok: true, value: null };
      }
      if (scanError) return failure("RECOVERY_SCAN_FAILED", scanError);
      if (channel === IPC.RECOVERY_LIST)
        return { ok: true, value: summaries() };
      busy = true;
      const startedAt = Date.now();
      const candidate = parsed.data
        ? service.getCandidates().find(({ id }) => id === parsed.data?.id)
        : undefined;
      const action = channel === IPC.RECOVERY_RECOVER ? "recover" : "discard";
      try {
        if (!parsed.data)
          return failure("RECOVERY_INPUT_INVALID", "Invalid recovery request.");
        const result =
          channel === IPC.RECOVERY_RECOVER
            ? await service.recoverCandidate(parsed.data.id)
            : await service.discardCandidate(parsed.data.id);
        logger.info(`recovery.${action}ed`, {
          candidateId: parsed.data.id,
          ...(candidate ? { chapterId: candidate.chapterId } : {}),
          ...(candidate ? { source: candidate.source } : {}),
          durationMs: Date.now() - startedAt,
        });
        return { ok: true, value: summaries(), ...result };
      } catch (error) {
        logger.error(`recovery.${action}_failed`, {
          ...(parsed.data ? { candidateId: parsed.data.id } : {}),
          ...(candidate ? { chapterId: candidate.chapterId } : {}),
          ...(candidate ? { source: candidate.source } : {}),
          durationMs: Date.now() - startedAt,
          ...safeErrorContext(error),
        });
        return error instanceof ApplicationError
          ? failure(error.code, error.message)
          : failure(
              "RECOVERY_FAILED",
              "Recovery could not complete. Retry or cancel startup.",
            );
      } finally {
        busy = false;
      }
    });
  }
}
