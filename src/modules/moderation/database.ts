import type { Database } from "../../core/database.js";

export interface ModerationWarning {
  id: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string | null;
  createdAt: string;
}

export function migrateModerationTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS moderation_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_moderation_warnings_guild_user
      ON moderation_warnings (guild_id, user_id);
  `);
}

export function addWarning(
  db: Database,
  guildId: string,
  userId: string,
  moderatorId: string,
  reason: string | null,
): ModerationWarning {
  const result = db
    .prepare(
      `INSERT INTO moderation_warnings (guild_id, user_id, moderator_id, reason)
       VALUES (?, ?, ?, ?)`,
    )
    .run(guildId, userId, moderatorId, reason);

  return getWarningById(db, Number(result.lastInsertRowid))!;
}

export function getWarningById(
  db: Database,
  id: number,
): ModerationWarning | null {
  const row = db
    .prepare(
      `SELECT id, guild_id, user_id, moderator_id, reason, created_at
       FROM moderation_warnings WHERE id = ?`,
    )
    .get(id) as WarningRow | undefined;

  return row ? mapWarning(row) : null;
}

export function getWarningsForUser(
  db: Database,
  guildId: string,
  userId: string,
  limit = 10,
): ModerationWarning[] {
  const rows = db
    .prepare(
      `SELECT id, guild_id, user_id, moderator_id, reason, created_at
       FROM moderation_warnings
       WHERE guild_id = ? AND user_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(guildId, userId, limit) as WarningRow[];

  return rows.map(mapWarning);
}

export function countWarningsForUser(
  db: Database,
  guildId: string,
  userId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM moderation_warnings
       WHERE guild_id = ? AND user_id = ?`,
    )
    .get(guildId, userId) as { count: number };

  return row.count;
}

export function deleteWarning(db: Database, guildId: string, id: number): boolean {
  const result = db
    .prepare(
      `DELETE FROM moderation_warnings WHERE guild_id = ? AND id = ?`,
    )
    .run(guildId, id);
  return result.changes > 0;
}

export function clearWarningsForUser(
  db: Database,
  guildId: string,
  userId: string,
): number {
  const result = db
    .prepare(
      `DELETE FROM moderation_warnings WHERE guild_id = ? AND user_id = ?`,
    )
    .run(guildId, userId);
  return result.changes;
}

interface WarningRow {
  id: number;
  guild_id: string;
  user_id: string;
  moderator_id: string;
  reason: string | null;
  created_at: string;
}

function mapWarning(row: WarningRow): ModerationWarning {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    moderatorId: row.moderator_id,
    reason: row.reason,
    createdAt: row.created_at,
  };
}
