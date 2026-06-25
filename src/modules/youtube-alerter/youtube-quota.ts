import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { log } from "./log.js";

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

let pausedUntilMs: number | null = null;
let pauseLogged = false;
let pauseAnnounced = false;
let pauseFilePath: string | null = null;

export class YoutubeQuotaExceededError extends Error {
  constructor(message = "YouTube API daily quota exceeded") {
    super(message);
    this.name = "YoutubeQuotaExceededError";
  }
}

export function initYoutubeQuotaPersistence(databasePath: string): void {
  pauseFilePath = `${dirname(databasePath)}/youtube-quota-pause.json`;
  loadPauseFromDisk();
}

export function isYoutubeQuotaExceededError(error: unknown): boolean {
  if (error instanceof YoutubeQuotaExceededError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  return (
    message.includes("403") &&
    (message.includes("quotaExceeded") ||
      message.includes("exceeded your") ||
      message.includes("youtube.quota"))
  );
}

export function isYoutubeQuotaPaused(): boolean {
  clearYoutubeQuotaPauseIfExpired();
  return pausedUntilMs !== null && Date.now() < pausedUntilMs;
}

export function getYoutubeQuotaPausedUntil(): Date | null {
  clearYoutubeQuotaPauseIfExpired();
  return pausedUntilMs === null ? null : new Date(pausedUntilMs);
}

export function clearYoutubeQuotaPauseIfExpired(): void {
  if (pausedUntilMs !== null && Date.now() >= pausedUntilMs) {
    pausedUntilMs = null;
    pauseLogged = false;
    pauseAnnounced = false;
    persistPauseToDisk();
    log.info("YouTube API quota pause ended — resuming polling");
  }
}

export function pauseYoutubeQuotaUntilDailyReset(): Date {
  const resumeAt = getYoutubeQuotaResetTime();
  pausedUntilMs = resumeAt.getTime();
  pauseLogged = false;
  pauseAnnounced = false;
  persistPauseToDisk();
  return resumeAt;
}

/** Log the pause once per pause window. Returns true the first time. */
export function noteYoutubeQuotaPause(): boolean {
  if (pauseLogged || pausedUntilMs === null) {
    return false;
  }

  pauseLogged = true;
  log.warn(
    {
      resumeAt: new Date(pausedUntilMs).toISOString(),
      resumeInMinutes: Math.ceil((pausedUntilMs - Date.now()) / 60_000),
    },
    "YouTube API quota exceeded — polling paused until daily quota reset (midnight Pacific)",
  );
  return true;
}

/** Whether a bots-channel announcement is still needed for this pause. */
export function shouldAnnounceYoutubeQuotaPause(): boolean {
  return pausedUntilMs !== null && !pauseAnnounced;
}

export function markYoutubeQuotaPauseAnnounced(): void {
  pauseAnnounced = true;
}

/** YouTube Data API quota resets at midnight Pacific Time. */
export function getYoutubeQuotaResetTime(now = new Date()): Date {
  const pacific = getPacificTimeParts(now);
  const minutesUntilMidnight =
    (24 - pacific.hour) * 60 - pacific.minute - (pacific.second > 0 ? 1 : 0);

  let probe = new Date(now.getTime() + Math.max(minutesUntilMidnight, 0) * 60_000);

  for (let step = 0; step < 180; step += 1) {
    const parts = getPacificTimeParts(probe);
    if (
      parts.hour === 0 &&
      parts.minute === 0 &&
      parts.second < 5 &&
      probe.getTime() > now.getTime() + 1000
    ) {
      return probe;
    }
    probe = new Date(probe.getTime() + 60_000);
  }

  return new Date(now.getTime() + 6 * 60 * 60_000);
}

export function getYoutubeQuotaPausedIntervalMs(): number | null {
  const pausedUntil = getYoutubeQuotaPausedUntil();
  if (!pausedUntil) {
    return null;
  }

  return Math.max(pausedUntil.getTime() - Date.now(), 60_000);
}

function loadPauseFromDisk(): void {
  if (!pauseFilePath || !existsSync(pauseFilePath)) {
    return;
  }

  try {
    const raw = readFileSync(pauseFilePath, "utf8");
    const data = JSON.parse(raw) as { pausedUntilMs?: number };
    if (
      typeof data.pausedUntilMs === "number" &&
      data.pausedUntilMs > Date.now()
    ) {
      pausedUntilMs = data.pausedUntilMs;
      log.info(
        { resumeAt: new Date(pausedUntilMs).toISOString() },
        "Restored YouTube API quota pause from disk",
      );
    } else {
      unlinkSync(pauseFilePath);
    }
  } catch (error) {
    log.warn({ err: error }, "Failed to read YouTube quota pause file");
  }
}

function persistPauseToDisk(): void {
  if (!pauseFilePath) {
    return;
  }

  try {
    if (pausedUntilMs === null) {
      if (existsSync(pauseFilePath)) {
        unlinkSync(pauseFilePath);
      }
      return;
    }

    mkdirSync(dirname(pauseFilePath), { recursive: true });
    writeFileSync(
      pauseFilePath,
      JSON.stringify({ pausedUntilMs }, null, 2),
      "utf8",
    );
  } catch (error) {
    log.warn({ err: error }, "Failed to persist YouTube quota pause");
  }
}

function getPacificTimeParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}
