import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type {
  LogLevel,
  SafeLogContext,
  SafeLogger,
  SafeLogValue,
} from "@bookeditor/shared";
import { SAFE_LOG_FIELDS, safeErrorContext } from "@bookeditor/shared";

export const LOG_DIRECTORY_NAME = "logs";
export const LOG_FILE_NAME = "bookeditor.log";
export const DEFAULT_MAX_LOG_BYTES = 1024 * 1024;
export const DEFAULT_LOG_BACKUPS = 3;

const MAX_STRING_LENGTH = 500;
const safeFields = new Set<string>(SAFE_LOG_FIELDS);

export interface FileLoggerOptions {
  maxBytes?: number;
  backups?: number;
  now?: () => Date;
}

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  context?: SafeLogContext;
}

/** Main-process JSON-lines logger stored beneath Electron's userData path. */
export class FileLogger implements SafeLogger {
  readonly directory: string;
  readonly path: string;
  readonly maxBytes: number;
  readonly backups: number;
  readonly now: () => Date;

  constructor(userDataPath: string, options: FileLoggerOptions = {}) {
    this.directory = join(userDataPath, LOG_DIRECTORY_NAME);
    this.path = join(this.directory, LOG_FILE_NAME);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
    this.backups = options.backups ?? DEFAULT_LOG_BACKUPS;
    this.now = options.now ?? (() => new Date());
  }

  debug(event: string, context?: SafeLogContext): void {
    this.write("debug", event, context);
  }

  info(event: string, context?: SafeLogContext): void {
    this.write("info", event, context);
  }

  warn(event: string, context?: SafeLogContext): void {
    this.write("warn", event, context);
  }

  error(event: string, context?: SafeLogContext): void {
    this.write("error", event, context);
  }

  private write(
    level: LogLevel,
    event: string,
    context?: SafeLogContext,
  ): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      const safeContext = sanitizeContext(context);
      const record: LogRecord = {
        timestamp: this.now().toISOString(),
        level,
        event: event.slice(0, MAX_STRING_LENGTH),
        ...(Object.keys(safeContext).length > 0
          ? { context: safeContext }
          : {}),
      };
      const line = `${JSON.stringify(record)}\n`;
      this.rotateIfNeeded(Buffer.byteLength(line, "utf8"));
      appendFileSync(this.path, line, { encoding: "utf8" });
    } catch {
      // Logging must never interrupt persistence or application shutdown.
    }
  }

  private rotateIfNeeded(nextBytes: number): void {
    if (!existsSync(this.path)) return;
    if (statSync(this.path).size + nextBytes <= this.maxBytes) return;

    if (this.backups === 0) {
      rmSync(this.path, { force: true });
      return;
    }

    rmSync(`${this.path}.${this.backups}`, { force: true });
    for (let index = this.backups - 1; index >= 1; index -= 1) {
      const source = `${this.path}.${index}`;
      if (existsSync(source)) renameSync(source, `${this.path}.${index + 1}`);
    }
    renameSync(this.path, `${this.path}.1`);
  }
}

function sanitizeContext(context?: SafeLogContext): SafeLogContext {
  if (!context) return {};
  const result: Record<string, SafeLogValue> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!safeFields.has(key)) continue;
    if (typeof value === "string")
      result[key] = value.slice(0, MAX_STRING_LENGTH);
    else if (typeof value === "number")
      result[key] = Number.isFinite(value) ? value : null;
    else if (typeof value === "boolean" || value === null) result[key] = value;
  }
  return result;
}

interface ProcessErrorEvents {
  on(
    event: "uncaughtException",
    listener: (error: Error, origin: string) => void,
  ): unknown;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

export type FatalProcessErrorSource =
  "uncaught_exception" | "unhandled_rejection";

export function installProcessErrorHandling(
  logger: SafeLogger,
  onFatalError: (source: FatalProcessErrorSource) => void,
  target: ProcessErrorEvents = process,
): void {
  target.on("uncaughtException", (error, origin) => {
    logger.error("application.uncaught_exception", {
      origin,
      ...safeErrorContext(error),
    });
    onFatalError("uncaught_exception");
  });
  target.on("unhandledRejection", (reason) => {
    logger.error("application.unhandled_rejection", safeErrorContext(reason));
    onFatalError("unhandled_rejection");
  });
}
