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

function buildPrettyStream() {
  return pinoPretty({
    colorize: true,
    ignore: "pid,hostname,time,module,level",
    hideObject: true,
    singleLine: false,
    messageFormat: (log, messageKey) => {
      const moduleName = String(log.module ?? "app");
      const message = String(log[messageKey] ?? "");
      const levelName = resolveLevelName(log);
      const level = colorizeLevel(levelName);
      const time = formatLogTime(log.time);

      return `[${time}] [${moduleName}] ${level}: ${message}`;
    },
  });
}

export function initLogger(options: LoggerInitOptions): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  rootLogger = pino(
    {
      level:
        options.level ??
        process.env.LOG_LEVEL ??
        (options.isProduction ? "info" : "debug"),
    },
    buildPrettyStream(),
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
