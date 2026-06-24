import type { AuditLogEvent } from "discord.js";

import type { Database } from "../../core/database.js";
import {
  getActionsForCategory,
  type AuditCategory,
  MODERATION_ACTIONS,
} from "./actions.js";

export interface AuditLogSettings {
  guildId: string;
  channelId: string;
  enabled: boolean;
  disabledActions: Set<AuditLogEvent>;
  updatedAt: string;
}

export function migrateAuditLogTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      disabled_actions TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrateAuditLogSettingsColumns(db);
}

function migrateAuditLogSettingsColumns(db: Database): void {
  const columns = db
    .prepare(`PRAGMA table_info(audit_log_settings)`)
    .all() as { name: string }[];

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("enabled")) {
    db.exec(
      `ALTER TABLE audit_log_settings ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`,
    );
  }

  if (!columnNames.has("disabled_actions")) {
    db.exec(
      `ALTER TABLE audit_log_settings ADD COLUMN disabled_actions TEXT NOT NULL DEFAULT '[]'`,
    );
  }
}

export function getAuditLogSettings(
  db: Database,
  guildId: string,
): AuditLogSettings | null {
  const row = db
    .prepare(
      `SELECT guild_id, channel_id, enabled, disabled_actions, updated_at
       FROM audit_log_settings
       WHERE guild_id = ?`,
    )
    .get(guildId) as
    | {
        guild_id: string;
        channel_id: string;
        enabled: number;
        disabled_actions: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    enabled: row.enabled !== 0,
    disabledActions: parseDisabledActions(row.disabled_actions),
    updatedAt: row.updated_at,
  };
}

export function upsertAuditLogChannel(
  db: Database,
  guildId: string,
  channelId: string,
): void {
  db.prepare(
    `INSERT INTO audit_log_settings (
       guild_id, channel_id, enabled, disabled_actions, updated_at
     )
     VALUES (?, ?, 1, '[]', datetime('now'))
     ON CONFLICT (guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       enabled = 1,
       updated_at = datetime('now')`,
  ).run(guildId, channelId);
}

export function setAuditLogEnabled(
  db: Database,
  guildId: string,
  enabled: boolean,
): boolean {
  const result = db
    .prepare(
      `UPDATE audit_log_settings
       SET enabled = ?, updated_at = datetime('now')
       WHERE guild_id = ?`,
    )
    .run(enabled ? 1 : 0, guildId);
  return result.changes > 0;
}

export function disableAuditCategory(
  db: Database,
  guildId: string,
  category: AuditCategory,
): AuditLogSettings | null {
  const settings = getAuditLogSettings(db, guildId);
  if (!settings) {
    return null;
  }

  for (const action of getActionsForCategory(category)) {
    settings.disabledActions.add(action);
  }

  saveDisabledActions(db, guildId, settings.disabledActions);
  return getAuditLogSettings(db, guildId);
}

export function enableAuditCategory(
  db: Database,
  guildId: string,
  category: AuditCategory,
): AuditLogSettings | null {
  const settings = getAuditLogSettings(db, guildId);
  if (!settings) {
    return null;
  }

  for (const action of getActionsForCategory(category)) {
    settings.disabledActions.delete(action);
  }

  saveDisabledActions(db, guildId, settings.disabledActions);
  return getAuditLogSettings(db, guildId);
}

export function resetAuditFilters(
  db: Database,
  guildId: string,
): AuditLogSettings | null {
  const settings = getAuditLogSettings(db, guildId);
  if (!settings) {
    return null;
  }

  saveDisabledActions(db, guildId, new Set());
  return getAuditLogSettings(db, guildId);
}

export function clearAuditLogChannel(db: Database, guildId: string): boolean {
  const result = db
    .prepare(`DELETE FROM audit_log_settings WHERE guild_id = ?`)
    .run(guildId);
  return result.changes > 0;
}

function saveDisabledActions(
  db: Database,
  guildId: string,
  disabledActions: Set<AuditLogEvent>,
): void {
  const payload = JSON.stringify(
    [...disabledActions].filter((action) => MODERATION_ACTIONS.has(action)),
  );

  db.prepare(
    `UPDATE audit_log_settings
     SET disabled_actions = ?, updated_at = datetime('now')
     WHERE guild_id = ?`,
  ).run(payload, guildId);
}

function parseDisabledActions(value: string | null): Set<AuditLogEvent> {
  if (!value) {
    return new Set();
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed.filter(
        (action): action is AuditLogEvent =>
          typeof action === "number" && MODERATION_ACTIONS.has(action),
      ),
    );
  } catch {
    return new Set();
  }
}
