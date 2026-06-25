/** Quota units consumed by `checkChannel()` per subscribed YouTube channel. */
export const YOUTUBE_QUOTA_UNITS_PER_CHANNEL_CHECK = 4;

const SECONDS_PER_DAY = 86_400;

/** Fastest allowed interval when quota budget allows it. */
export const MIN_POLL_INTERVAL_SECONDS = 30;

/** Interval when there are no subscriptions (no API calls are made). */
export const IDLE_POLL_INTERVAL_SECONDS = 300;

export function computeYoutubePollIntervalMs(
  channelCount: number,
  quotaBudgetPerDay: number,
): number {
  if (channelCount <= 0) {
    return IDLE_POLL_INTERVAL_SECONDS * 1000;
  }

  const unitsPerPoll = channelCount * YOUTUBE_QUOTA_UNITS_PER_CHANNEL_CHECK;
  const intervalSeconds = Math.ceil(
    (SECONDS_PER_DAY * unitsPerPoll) / quotaBudgetPerDay,
  );

  return Math.max(MIN_POLL_INTERVAL_SECONDS, intervalSeconds) * 1000;
}
