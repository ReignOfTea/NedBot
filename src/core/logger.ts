import pino, { type Logger } from "pino";
import pinoPretty from "pino-pretty";

export type { Logger };

let rootLogger: Logger | null = null;

export let coreLog: Logger;

export interface LoggerInitOptions {
  isProduction: boolean;
  level?: string;
}

const LEVEL_NAMES: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

const colorizeLevel = pinoPretty.colorizerFactory(true);

function formatLogTime(epochMs: unknown): string {
  const date = new Date(Number(epochMs));
  if (Number.isNaN(date.getTime())) {
    return "??:??:??";
  }

  return date.toLocaleTimeString("en-GB", { hour12: false });
}

function resolveLevelName(log: Record<string, unknown>): string {
  const level = Number(log.level ?? 30);
  return LEVEL_NAMES[level] ?? "INFO";
}

function shouldHideStructuredFields(level: string): boolean {
  const normalized = level.toLowerCase();
  return normalized !== "debug" && normalized !== "trace";
}

function formatAttachedError(log: Record<string, unknown>): string {
  const err = log.err ?? log.error;
  if (typeof err === "string" && err.length > 0) {
    return `\n${err}`;
  }
  if (!err || typeof err !== "object") {
    return "";
  }

  const details = err as { message?: unknown; stack?: unknown };
  if (typeof details.stack === "string" && details.stack.length > 0) {
    return `\n${details.stack}`;
  }
  if (typeof details.message === "string" && details.message.length > 0) {
    return `\n${details.message}`;
  }
  return "";
}

function buildPrettyStream(level: string) {
  return pinoPretty({
    colorize: true,
    ignore: "pid,hostname,time,module,level,err,error",
    hideObject: shouldHideStructuredFields(level),
    singleLine: false,
    messageFormat: (log, messageKey) => {
      const record = log as Record<string, unknown>;
      const moduleName = String(record.module ?? "app");
      const message = String(record[messageKey] ?? "");
      const levelName = resolveLevelName(record);
      const levelLabel = colorizeLevel(levelName);
      const time = formatLogTime(record.time);

      return `[${time}] [${moduleName}] ${levelLabel}: ${message}${formatAttachedError(record)}`;
    },
  });
}

export function initLogger(options: LoggerInitOptions): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  const level =
    options.level ??
    process.env.LOG_LEVEL ??
    (options.isProduction ? "info" : "debug");

  rootLogger = pino(
    {
      level,
    },
    buildPrettyStream(level),
  );

  coreLog = rootLogger.child({ module: "core" });
  return rootLogger;
}

export function getLogger(): Logger {
  if (!rootLogger) {
    throw new Error("Logger not initialized. Call initLogger() first.");
  }
  return rootLogger;
}

/** Create a child logger tagged with a module heading. */
export function createModuleLogger(module: string): Logger {
  return getLogger().child({ module });
}
