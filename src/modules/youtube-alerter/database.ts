import type { Database } from "../../core/database.js";
import { parsePingIds } from "../../core/database.js";
import type { YoutubeAlertType } from "./types.js";

export interface YoutubeSubscriptionRow {
  id: number;
  guild_id: string;
  youtube_channel_id: string;
  youtube_channel_title: string | null;
  live_channel_id: string | null;
  video_channel_id: string | null;
  post_channel_id: string | null;
  last_live_id: string | null;
  last_video_id: string | null;
  last_post_id: string | null;
  ping_role_ids: string;
  ping_user_ids: string;
  created_at: string;
}

export function migrateYoutubeSubscriptions(db: Database): void {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'youtube_subscriptions'`,
    )
    .all() as { name: string }[];

  if (tables.length === 0) {
    createYoutubeSubscriptionsTable(db);
    return;
  }

  const columns = db
    .prepare(`PRAGMA table_info(youtube_subscriptions)`)
    .all() as { name: string }[];

  const columnNames = new Set(columns.map((column) => column.name));

  if (columnNames.has("live_channel_id")) {
    return;
  }

  const legacyRows = columnNames.has("discord_channel_id")
    ? (db.prepare(`SELECT * FROM youtube_subscriptions`).all() as Record<
        string,
        unknown
      >[])
    : [];

  db.exec(`DROP TABLE IF EXISTS youtube_subscriptions`);

  createYoutubeSubscriptionsTable(db);

  const grouped = new Map<string, YoutubeSubscriptionRow>();

  for (const row of legacyRows) {
    const guildId = String(row.guild_id);
    const youtubeChannelId = String(row.youtube_channel_id);
    const key = `${guildId}:${youtubeChannelId}`;

    const existing = grouped.get(key);
    const discordChannelId = row.discord_channel_id
      ? String(row.discord_channel_id)
      : null;

    const roleIds = parsePingIds(
      row.ping_role_ids ? String(row.ping_role_ids) : null,
    );
    const userIds = parsePingIds(
      row.ping_user_ids ? String(row.ping_user_ids) : null,
    );

    if (!existing) {
      grouped.set(key, {
        id: 0,
        guild_id: guildId,
        youtube_channel_id: youtubeChannelId,
        youtube_channel_title: row.youtube_channel_title
          ? String(row.youtube_channel_title)
          : null,
        live_channel_id: discordChannelId,
        video_channel_id: null,
        post_channel_id: null,
        last_live_id: row.last_live_video_id
          ? String(row.last_live_video_id)
          : null,
        last_video_id: null,
        last_post_id: null,
        ping_role_ids: JSON.stringify(roleIds),
        ping_user_ids: JSON.stringify(userIds),
        created_at: row.created_at ? String(row.created_at) : new Date().toISOString(),
      });
      continue;
    }

    const mergedRoles = [
      ...new Set([
        ...parsePingIds(existing.ping_role_ids),
        ...roleIds,
      ]),
    ];
    const mergedUsers = [
      ...new Set([
        ...parsePingIds(existing.ping_user_ids),
        ...userIds,
      ]),
    ];

    grouped.set(key, {
      ...existing,
      ping_role_ids: JSON.stringify(mergedRoles),
      ping_user_ids: JSON.stringify(mergedUsers),
    });
  }

  const insert = db.prepare(`
    INSERT INTO youtube_subscriptions (
      guild_id,
      youtube_channel_id,
      youtube_channel_title,
      live_channel_id,
      video_channel_id,
      post_channel_id,
      last_live_id,
      last_video_id,
      last_post_id,
      ping_role_ids,
      ping_user_ids,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of grouped.values()) {
    insert.run(
      row.guild_id,
      row.youtube_channel_id,
      row.youtube_channel_title,
      row.live_channel_id,
      row.video_channel_id,
      row.post_channel_id,
      row.last_live_id,
      row.last_video_id,
      row.last_post_id,
      row.ping_role_ids,
      row.ping_user_ids,
      row.created_at,
    );
  }
}

function createYoutubeSubscriptionsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      youtube_channel_id TEXT NOT NULL,
      youtube_channel_title TEXT,
      live_channel_id TEXT,
      video_channel_id TEXT,
      post_channel_id TEXT,
      last_live_id TEXT,
      last_video_id TEXT,
      last_post_id TEXT,
      ping_role_ids TEXT NOT NULL DEFAULT '[]',
      ping_user_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, youtube_channel_id)
    );

    CREATE INDEX IF NOT EXISTS idx_youtube_subs_channel
      ON youtube_subscriptions (youtube_channel_id);
  `);
}

export function getYoutubeSubscriptionsByGuild(
  db: Database,
  guildId: string,
): YoutubeSubscriptionRow[] {
  return db
    .prepare(
      `SELECT * FROM youtube_subscriptions WHERE guild_id = ? ORDER BY created_at DESC`,
    )
    .all(guildId) as YoutubeSubscriptionRow[];
}

export function getAllYoutubeSubscriptions(
  db: Database,
): YoutubeSubscriptionRow[] {
  return db
    .prepare(`SELECT * FROM youtube_subscriptions ORDER BY id ASC`)
    .all() as YoutubeSubscriptionRow[];
}

export function getYoutubeSubscription(
  db: Database,
  guildId: string,
  youtubeChannelId: string,
): YoutubeSubscriptionRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM youtube_subscriptions
         WHERE guild_id = ? AND youtube_channel_id = ?
         LIMIT 1`,
      )
      .get(guildId, youtubeChannelId) as YoutubeSubscriptionRow | undefined) ??
    null
  );
}

export function upsertYoutubeSubscription(
  db: Database,
  data: {
    guildId: string;
    youtubeChannelId: string;
    youtubeChannelTitle: string;
    liveChannelId?: string | null;
    videoChannelId?: string | null;
    postChannelId?: string | null;
  },
): YoutubeSubscriptionRow {
  const existing = getYoutubeSubscription(
    db,
    data.guildId,
    data.youtubeChannelId,
  );

  if (!existing) {
    const stmt = db.prepare(`
      INSERT INTO youtube_subscriptions (
        guild_id,
        youtube_channel_id,
        youtube_channel_title,
        live_channel_id,
        video_channel_id,
        post_channel_id
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    return stmt.get(
      data.guildId,
      data.youtubeChannelId,
      data.youtubeChannelTitle,
      data.liveChannelId ?? null,
      data.videoChannelId ?? null,
      data.postChannelId ?? null,
    ) as YoutubeSubscriptionRow;
  }

  const stmt = db.prepare(`
    UPDATE youtube_subscriptions
    SET youtube_channel_title = ?,
        live_channel_id = COALESCE(?, live_channel_id),
        video_channel_id = COALESCE(?, video_channel_id),
        post_channel_id = COALESCE(?, post_channel_id)
    WHERE guild_id = ? AND youtube_channel_id = ?
    RETURNING *
  `);

  return stmt.get(
    data.youtubeChannelTitle,
    data.liveChannelId ?? null,
    data.videoChannelId ?? null,
    data.postChannelId ?? null,
    data.guildId,
    data.youtubeChannelId,
  ) as YoutubeSubscriptionRow;
}

export function setYoutubeAlertChannels(
  db: Database,
  guildId: string,
  youtubeChannelId: string,
  channels: {
    liveChannelId?: string | null;
    videoChannelId?: string | null;
    postChannelId?: string | null;
  },
): boolean {
  const existing = getYoutubeSubscription(db, guildId, youtubeChannelId);
  if (!existing) {
    return false;
  }

  const result = db
    .prepare(
      `UPDATE youtube_subscriptions
       SET live_channel_id = ?,
           video_channel_id = ?,
           post_channel_id = ?
       WHERE guild_id = ? AND youtube_channel_id = ?`,
    )
    .run(
      channels.liveChannelId !== undefined
        ? channels.liveChannelId
        : existing.live_channel_id,
      channels.videoChannelId !== undefined
        ? channels.videoChannelId
        : existing.video_channel_id,
      channels.postChannelId !== undefined
        ? channels.postChannelId
        : existing.post_channel_id,
      guildId,
      youtubeChannelId,
    );

  return result.changes > 0;
}

export function setSubscriptionPings(
  db: Database,
  guildId: string,
  youtubeChannelId: string,
  pingRoleIds: string[],
  pingUserIds: string[],
): boolean {
  const result = db
    .prepare(
      `UPDATE youtube_subscriptions
       SET ping_role_ids = ?, ping_user_ids = ?
       WHERE guild_id = ? AND youtube_channel_id = ?`,
    )
    .run(
      JSON.stringify(pingRoleIds),
      JSON.stringify(pingUserIds),
      guildId,
      youtubeChannelId,
    );

  return result.changes > 0;
}

export function addSubscriptionPing(
  db: Database,
  guildId: string,
  youtubeChannelId: string,
  target: { type: "role" | "user"; id: string },
): boolean {
  const subscription = getYoutubeSubscription(db, guildId, youtubeChannelId);
  if (!subscription) {
    return false;
  }

  const roleIds = parsePingIds(subscription.ping_role_ids);
  const userIds = parsePingIds(subscription.ping_user_ids);

  if (target.type === "role" && !roleIds.includes(target.id)) {
    roleIds.push(target.id);
  } else if (target.type === "user" && !userIds.includes(target.id)) {
    userIds.push(target.id);
  }

  return setSubscriptionPings(db, guildId, youtubeChannelId, roleIds, userIds);
}

export function removeSubscriptionPing(
  db: Database,
  guildId: string,
  youtubeChannelId: string,
  target: { type: "role" | "user"; id: string },
): boolean {
  const subscription = getYoutubeSubscription(db, guildId, youtubeChannelId);
  if (!subscription) {
    return false;
  }

  const roleIds = parsePingIds(subscription.ping_role_ids).filter(
    (id) => !(target.type === "role" && id === target.id),
  );
  const userIds = parsePingIds(subscription.ping_user_ids).filter(
    (id) => !(target.type === "user" && id === target.id),
  );

  return setSubscriptionPings(db, guildId, youtubeChannelId, roleIds, userIds);
}

export function clearSubscriptionPings(
  db: Database,
  guildId: string,
  youtubeChannelId: string,
): boolean {
  return setSubscriptionPings(db, guildId, youtubeChannelId, [], []);
}

export function removeYoutubeSubscription(
  db: Database,
  guildId: string,
  youtubeChannelId: string,
): boolean {
  const result = db
    .prepare(
      `DELETE FROM youtube_subscriptions
       WHERE guild_id = ? AND youtube_channel_id = ?`,
    )
    .run(guildId, youtubeChannelId);
  return result.changes > 0;
}

export function updateLastAlertId(
  db: Database,
  youtubeChannelId: string,
  type: YoutubeAlertType,
  contentId: string,
): void {
  const column =
    type === "live"
      ? "last_live_id"
      : type === "video"
        ? "last_video_id"
        : "last_post_id";

  db.prepare(
    `UPDATE youtube_subscriptions
     SET ${column} = ?
     WHERE youtube_channel_id = ?`,
  ).run(contentId, youtubeChannelId);
}

export function getDistinctYoutubeChannelIdsForGuild(
  db: Database,
  guildId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT youtube_channel_id
       FROM youtube_subscriptions
       WHERE guild_id = ?`,
    )
    .all(guildId) as { youtube_channel_id: string }[];
  return rows.map((row) => row.youtube_channel_id);
}

export function getDiscordChannelIdForAlertType(
  subscription: YoutubeSubscriptionRow,
  type: YoutubeAlertType,
): string | null {
  switch (type) {
    case "live":
      return subscription.live_channel_id;
    case "video":
      return subscription.video_channel_id;
    case "post":
      return subscription.post_channel_id;
  }
}

export function getLastAlertId(
  subscription: YoutubeSubscriptionRow,
  type: YoutubeAlertType,
): string | null {
  switch (type) {
    case "live":
      return subscription.last_live_id;
    case "video":
      return subscription.last_video_id;
    case "post":
      return subscription.last_post_id;
  }
}

export function formatAlertChannels(sub: YoutubeSubscriptionRow): string {
  const parts: string[] = [];
  if (sub.live_channel_id) {
    parts.push(`live → <#${sub.live_channel_id}>`);
  }
  if (sub.video_channel_id) {
    parts.push(`video → <#${sub.video_channel_id}>`);
  }
  if (sub.post_channel_id) {
    parts.push(`post → <#${sub.post_channel_id}>`);
  }
  return parts.length > 0 ? parts.join(", ") : "none configured";
}
