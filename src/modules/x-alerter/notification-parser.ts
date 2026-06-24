import type { TwitterNotification } from "xnotif";

import type { XPostAlert } from "./types.js";
import { normalizeXUsername } from "./database.js";

const TWEET_NOTIFICATION_TYPES = new Set([
  "tweet",
  "moment",
  "user_posted",
]);

export function isTweetNotification(notification: TwitterNotification): boolean {
  const type = notification.data?.type;
  if (type && TWEET_NOTIFICATION_TYPES.has(type)) {
    return true;
  }

  const uri = notification.data?.uri ?? "";
  return /\/status\/\d+/.test(uri);
}

export function parseTweetNotification(
  notification: TwitterNotification,
): XPostAlert | null {
  const url = notification.data?.uri;
  if (!url) {
    return null;
  }

  const username = extractUsername(
    notification.title ?? notification.data?.title,
  );
  if (!username) {
    return null;
  }

  const contentId =
    extractTweetId(url) ??
    notification.tag ??
    notification.data?.tag ??
    url;

  const displayName = (notification.title ?? notification.data?.title ?? username)
    .replace(/^@+/, "")
    .trim();

  return {
    username,
    displayName,
    body: notification.body ?? notification.data?.body ?? "",
    url,
    iconUrl: notification.icon,
    contentId,
  };
}

function extractUsername(title?: string): string | null {
  if (!title) {
    return null;
  }

  const match = title.trim().match(/^@?([\w]+)/);
  return match ? normalizeXUsername(match[1]) : null;
}

function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}
