import type { ClientState } from "xnotif";

import type { Database } from "../../core/database.js";
import { parsePingIds } from "../../core/database.js";

export interface XSubscriptionRow {
  id: number;
  guild_id: string;
  x_username: string;
  discord_channel_id: string;
  last_post_id: string | null;
  ping_role_ids: string;
  ping_user_ids: string;
  created_at: string;
}

export function migrateXTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS x_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      x_username TEXT NOT NULL,
      discord_channel_id TEXT NOT NULL,
      last_post_id TEXT,
      ping_role_ids TEXT NOT NULL DEFAULT '[]',
      ping_user_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, x_username)
    );

    CREATE INDEX IF NOT EXISTS idx_x_subs_username
      ON x_subscriptions (x_username);

    CREATE TABLE IF NOT EXISTS x_push_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    );
  `);
}

export function normalizeXUsername(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function getXSubscriptionsByGuild(
  db: Database,
  guildId: string,
): XSubscriptionRow[] {
  return db
    .prepare(
      `SELECT * FROM x_subscriptions WHERE guild_id = ? ORDER BY created_at DESC`,
    )
    .all(guildId) as XSubscriptionRow[];
}

export function getXSubscriptionsByUsername(
  db: Database,
  username: string,
): XSubscriptionRow[] {
  return db
    .prepare(`SELECT * FROM x_subscriptions WHERE x_username = ?`)
    .all(normalizeXUsername(username)) as XSubscriptionRow[];
}

export function getXSubscription(
  db: Database,
  guildId: string,
  username: string,
): XSubscriptionRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM x_subscriptions
         WHERE guild_id = ? AND x_username = ?
         LIMIT 1`,
      )
      .get(guildId, normalizeXUsername(username)) as
      | XSubscriptionRow
      | undefined) ?? null
  );
}

export function upsertXSubscription(
  db: Database,
  data: {
    guildId: string;
    username: string;
    discordChannelId: string;
  },
): XSubscriptionRow {
  const username = normalizeXUsername(data.username);

  const existing = getXSubscription(db, data.guildId, username);
  if (!existing) {
    return db
      .prepare(
        `INSERT INTO x_subscriptions (guild_id, x_username, discord_channel_id)
         VALUES (?, ?, ?)
         RETURNING *`,
      )
      .get(data.guildId, username, data.discordChannelId) as XSubscriptionRow;
  }

  return db
    .prepare(
      `UPDATE x_subscriptions
       SET discord_channel_id = ?
       WHERE guild_id = ? AND x_username = ?
       RETURNING *`,
    )
    .get(
      data.discordChannelId,
      data.guildId,
      username,
    ) as XSubscriptionRow;
}

export function removeXSubscription(
  db: Database,
  guildId: string,
  username: string,
): boolean {
  const result = db
    .prepare(
      `DELETE FROM x_subscriptions
       WHERE guild_id = ? AND x_username = ?`,
    )
    .run(guildId, normalizeXUsername(username));
  return result.changes > 0;
}

export function setSubscriptionPings(
  db: Database,
  guildId: string,
  username: string,
  pingRoleIds: string[],
  pingUserIds: string[],
): boolean {
  const result = db
    .prepare(
      `UPDATE x_subscriptions
       SET ping_role_ids = ?, ping_user_ids = ?
       WHERE guild_id = ? AND x_username = ?`,
    )
    .run(
      JSON.stringify(pingRoleIds),
      JSON.stringify(pingUserIds),
      guildId,
      normalizeXUsername(username),
    );
  return result.changes > 0;
}

export function addSubscriptionPing(
  db: Database,
  guildId: string,
  username: string,
  target: { type: "role" | "user"; id: string },
): boolean {
  const subscription = getXSubscription(db, guildId, username);
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

  return setSubscriptionPings(db, guildId, username, roleIds, userIds);
}

export function removeSubscriptionPing(
  db: Database,
  guildId: string,
  username: string,
  target: { type: "role" | "user"; id: string },
): boolean {
  const subscription = getXSubscription(db, guildId, username);
  if (!subscription) {
    return false;
  }

  const roleIds = parsePingIds(subscription.ping_role_ids).filter(
    (id) => !(target.type === "role" && id === target.id),
  );
  const userIds = parsePingIds(subscription.ping_user_ids).filter(
    (id) => !(target.type === "user" && id === target.id),
  );

  return setSubscriptionPings(db, guildId, username, roleIds, userIds);
}

export function clearSubscriptionPings(
  db: Database,
  guildId: string,
  username: string,
): boolean {
  return setSubscriptionPings(db, guildId, username, [], []);
}

export function updateLastPostId(
  db: Database,
  guildId: string,
  username: string,
  postId: string,
): void {
  db.prepare(
    `UPDATE x_subscriptions
     SET last_post_id = ?
     WHERE guild_id = ? AND x_username = ?`,
  ).run(postId, guildId, normalizeXUsername(username));
}

export function loadPushState(db: Database): ClientState | null {
  const row = db
    .prepare(`SELECT state_json FROM x_push_state WHERE id = 1`)
    .get() as { state_json: string } | undefined;

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.state_json) as ClientState;
  } catch {
    return null;
  }
}

export function savePushState(db: Database, state: ClientState): void {
  db.prepare(
    `INSERT INTO x_push_state (id, state_json) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
  ).run(JSON.stringify(state));
}
