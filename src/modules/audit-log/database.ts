import type { Database } from "../../core/database.js";

export interface AuditLogSettings {
  guildId: string;
  channelId: string;
  updatedAt: string;
}

export function migrateAuditLogTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getAuditLogSettings(
  db: Database,
  guildId: string,
): AuditLogSettings | null {
  const row = db
    .prepare(
      `SELECT guild_id, channel_id, updated_at
       FROM audit_log_settings
       WHERE guild_id = ?`,
    )
    .get(guildId) as
    | { guild_id: string; channel_id: string; updated_at: string }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    updatedAt: row.updated_at,
  };
}

export function upsertAuditLogChannel(
  db: Database,
  guildId: string,
  channelId: string,
): void {
  db.prepare(
    `INSERT INTO audit_log_settings (guild_id, channel_id, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       updated_at = datetime('now')`,
  ).run(guildId, channelId);
}

export function clearAuditLogChannel(db: Database, guildId: string): boolean {
  const result = db
    .prepare(`DELETE FROM audit_log_settings WHERE guild_id = ?`)
    .run(guildId);
  return result.changes > 0;
}
