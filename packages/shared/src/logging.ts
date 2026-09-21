import { ApplicationError } from "./errors.js";

const safeErrorNames = new Set([
  "AggregateError",
  "ApplicationError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const safeErrorCode = /^[A-Z][A-Z0-9_]{0,99}$/u;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const SAFE_LOG_FIELDS = [
  "platform",
  "reason",
  "projectCount",
  "candidateCount",
  "scanFailed",
  "projectId",
  "chapterId",
  "candidateId",
  "source",
  "durationMs",
  "errorName",
  "errorCode",
  "origin",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type SafeLogField = (typeof SAFE_LOG_FIELDS)[number];
export type SafeLogValue = string | number | boolean | null;
export type SafeLogContext = Readonly<
  Partial<Record<SafeLogField, SafeLogValue>>
>;

/**
 * Logging boundary shared by application services. Callers must pass metadata
 * only: never document bodies, IPC payloads, raw errors, paths, or author text.
 */
export interface SafeLogger {
  debug(event: string, context?: SafeLogContext): void;
  info(event: string, context?: SafeLogContext): void;
  warn(event: string, context?: SafeLogContext): void;
  error(event: string, context?: SafeLogContext): void;
}

export const noopLogger: SafeLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Retain diagnostic classification without copying an error message or stack. */
export function safeErrorContext(error: unknown): SafeLogContext {
  if (error instanceof ApplicationError)
    return {
      errorName: "ApplicationError",
      errorCode: safeErrorCode.test(error.code) ? error.code : "UNKNOWN_ERROR",
    };
  if (error instanceof Error)
    return {
      errorName: safeErrorNames.has(error.name) ? error.name : "UnknownError",
    };
  return { errorName: "UnknownError" };
}
