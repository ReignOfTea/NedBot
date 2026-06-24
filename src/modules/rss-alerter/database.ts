import type { Database } from "../../core/database.js";
import { parsePingIds } from "../../core/database.js";
import { normalizeFeedUrl } from "./feed-url.js";
import { DEFAULT_MATCH_FIELDS, type RssMatchField } from "./types.js";

export interface RssSubscriptionRow {
  id: number;
  guild_id: string;
  feed_url: string;
  feed_title: string | null;
  label: string | null;
  discord_channel_id: string;
  match_regex: string;
  match_fields: string;
  last_entry_id: string | null;
  ping_role_ids: string;
  ping_user_ids: string;
  created_at: string;
}

export function migrateRssTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rss_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      feed_url TEXT NOT NULL,
      feed_title TEXT,
      label TEXT,
      discord_channel_id TEXT NOT NULL,
      match_regex TEXT NOT NULL,
      match_fields TEXT NOT NULL DEFAULT '["title","summary","description","content"]',
      last_entry_id TEXT,
      ping_role_ids TEXT NOT NULL DEFAULT '[]',
      ping_user_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, feed_url, discord_channel_id, match_regex)
    );

    CREATE INDEX IF NOT EXISTS idx_rss_subs_feed
      ON rss_subscriptions (feed_url);

    CREATE INDEX IF NOT EXISTS idx_rss_subs_guild
      ON rss_subscriptions (guild_id);

    CREATE TABLE IF NOT EXISTS rss_alerted_entries (
      subscription_id INTEGER NOT NULL,
      entry_id TEXT NOT NULL,
      alerted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (subscription_id, entry_id),
      FOREIGN KEY (subscription_id) REFERENCES rss_subscriptions(id) ON DELETE CASCADE
    );
  `);
}

export function parseMatchFields(value: string | null): RssMatchField[] {
  if (!value) {
    return [...DEFAULT_MATCH_FIELDS];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_MATCH_FIELDS];
    }

    const allowed = new Set<string>(DEFAULT_MATCH_FIELDS);
    return parsed.filter(
      (field): field is RssMatchField =>
        typeof field === "string" && allowed.has(field),
    );
  } catch {
    return [...DEFAULT_MATCH_FIELDS];
  }
}

export function getRssSubscriptionsByGuild(
  db: Database,
  guildId: string,
): RssSubscriptionRow[] {
  return db
    .prepare(
      `SELECT * FROM rss_subscriptions WHERE guild_id = ? ORDER BY created_at DESC`,
    )
    .all(guildId) as RssSubscriptionRow[];
}

export function getRssSubscriptionsByFeed(
  db: Database,
  feedUrl: string,
): RssSubscriptionRow[] {
  const normalized = normalizeFeedUrl(feedUrl);
  return db
    .prepare(`SELECT * FROM rss_subscriptions WHERE feed_url = ?`)
    .all(normalized) as RssSubscriptionRow[];
}

export function getDistinctFeedUrlsForGuild(
  db: Database,
  guildId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT feed_url
       FROM rss_subscriptions
       WHERE guild_id = ?`,
    )
    .all(guildId) as { feed_url: string }[];

  return rows.map((row) => row.feed_url);
}

export function getRssSubscription(
  db: Database,
  guildId: string,
  subscriptionId: number,
): RssSubscriptionRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM rss_subscriptions
         WHERE guild_id = ? AND id = ?
         LIMIT 1`,
      )
      .get(guildId, subscriptionId) as RssSubscriptionRow | undefined) ?? null
  );
}

export function getRssSubscriptionByFeedAndChannel(
  db: Database,
  guildId: string,
  feedUrl: string,
  discordChannelId: string,
  matchRegex: string,
): RssSubscriptionRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM rss_subscriptions
         WHERE guild_id = ? AND feed_url = ? AND discord_channel_id = ? AND match_regex = ?
         LIMIT 1`,
      )
      .get(
        guildId,
        normalizeFeedUrl(feedUrl),
        discordChannelId,
        matchRegex,
      ) as RssSubscriptionRow | undefined) ?? null
  );
}

export function upsertRssSubscription(
  db: Database,
  data: {
    guildId: string;
    feedUrl: string;
    feedTitle?: string | null;
    label?: string | null;
    discordChannelId: string;
    matchRegex: string;
    matchFields?: RssMatchField[];
    lastEntryId?: string | null;
  },
): RssSubscriptionRow {
  const feedUrl = normalizeFeedUrl(data.feedUrl);
  const matchFields = JSON.stringify(
    data.matchFields ?? [...DEFAULT_MATCH_FIELDS],
  );

  const existing = getRssSubscriptionByFeedAndChannel(
    db,
    data.guildId,
    feedUrl,
    data.discordChannelId,
    data.matchRegex,
  );

  if (!existing) {
    return db
      .prepare(
        `INSERT INTO rss_subscriptions (
          guild_id, feed_url, feed_title, label, discord_channel_id,
          match_regex, match_fields, last_entry_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`,
      )
      .get(
        data.guildId,
        feedUrl,
        data.feedTitle ?? null,
        data.label ?? null,
        data.discordChannelId,
        data.matchRegex,
        matchFields,
        data.lastEntryId ?? null,
      ) as RssSubscriptionRow;
  }

  db.prepare(
    `UPDATE rss_subscriptions
     SET feed_title = COALESCE(?, feed_title),
         label = COALESCE(?, label),
         match_fields = ?
     WHERE id = ?`,
  ).run(data.feedTitle ?? null, data.label ?? null, matchFields, existing.id);

  if (data.lastEntryId !== undefined) {
    updateLastEntryId(db, existing.id, data.lastEntryId);
  }

  return getRssSubscription(db, data.guildId, existing.id)!;
}

export function removeRssSubscription(
  db: Database,
  guildId: string,
  subscriptionId: number,
): boolean {
  const result = db
    .prepare(`DELETE FROM rss_subscriptions WHERE guild_id = ? AND id = ?`)
    .run(guildId, subscriptionId);
  return result.changes > 0;
}

export function updateRssMatchRegex(
  db: Database,
  guildId: string,
  subscriptionId: number,
  matchRegex: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE rss_subscriptions
       SET match_regex = ?
       WHERE guild_id = ? AND id = ?`,
    )
    .run(matchRegex, guildId, subscriptionId);
  return result.changes > 0;
}

export function updateLastEntryId(
  db: Database,
  subscriptionId: number,
  lastEntryId: string | null,
): void {
  db.prepare(
    `UPDATE rss_subscriptions SET last_entry_id = ? WHERE id = ?`,
  ).run(lastEntryId, subscriptionId);
}

export function hasAlertedEntry(
  db: Database,
  subscriptionId: number,
  entryId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM rss_alerted_entries
       WHERE subscription_id = ? AND entry_id = ?
       LIMIT 1`,
    )
    .get(subscriptionId, entryId);
  return row !== undefined;
}

export function recordAlertedEntry(
  db: Database,
  subscriptionId: number,
  entryId: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO rss_alerted_entries (subscription_id, entry_id)
     VALUES (?, ?)`,
  ).run(subscriptionId, entryId);
}

export function addSubscriptionPing(
  db: Database,
  guildId: string,
  subscriptionId: number,
  target: { type: "role" | "user"; id: string },
): RssSubscriptionRow | null {
  const sub = getRssSubscription(db, guildId, subscriptionId);
  if (!sub) {
    return null;
  }

  const roleIds = parsePingIds(sub.ping_role_ids);
  const userIds = parsePingIds(sub.ping_user_ids);

  if (target.type === "role") {
    if (!roleIds.includes(target.id)) {
      roleIds.push(target.id);
    }
  } else if (!userIds.includes(target.id)) {
    userIds.push(target.id);
  }

  db.prepare(
    `UPDATE rss_subscriptions
     SET ping_role_ids = ?, ping_user_ids = ?
     WHERE id = ?`,
  ).run(JSON.stringify(roleIds), JSON.stringify(userIds), sub.id);

  return getRssSubscription(db, guildId, subscriptionId);
}

export function removeSubscriptionPing(
  db: Database,
  guildId: string,
  subscriptionId: number,
  target: { type: "role" | "user"; id: string },
): RssSubscriptionRow | null {
  const sub = getRssSubscription(db, guildId, subscriptionId);
  if (!sub) {
    return null;
  }

  const roleIds = parsePingIds(sub.ping_role_ids).filter(
    (id) => !(target.type === "role" && id === target.id),
  );
  const userIds = parsePingIds(sub.ping_user_ids).filter(
    (id) => !(target.type === "user" && id === target.id),
  );

  db.prepare(
    `UPDATE rss_subscriptions
     SET ping_role_ids = ?, ping_user_ids = ?
     WHERE id = ?`,
  ).run(JSON.stringify(roleIds), JSON.stringify(userIds), sub.id);

  return getRssSubscription(db, guildId, subscriptionId);
}

export function clearSubscriptionPings(
  db: Database,
  guildId: string,
  subscriptionId: number,
): RssSubscriptionRow | null {
  const sub = getRssSubscription(db, guildId, subscriptionId);
  if (!sub) {
    return null;
  }

  db.prepare(
    `UPDATE rss_subscriptions
     SET ping_role_ids = '[]', ping_user_ids = '[]'
     WHERE id = ?`,
  ).run(sub.id);

  return getRssSubscription(db, guildId, subscriptionId);
}

export function describeSubscription(sub: RssSubscriptionRow): string {
  const name = sub.label || sub.feed_title || sub.feed_url;
  return `**#${sub.id}** ${name} → <#${sub.discord_channel_id}> \`${sub.match_regex}\``;
}
