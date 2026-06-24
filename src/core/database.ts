import DatabaseDriver from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { migrateYoutubeSubscriptions } from "../modules/youtube-alerter/database.js";
import { migrateXTables } from "../modules/x-alerter/database.js";
import { migrateRssTables } from "../modules/rss-alerter/database.js";

export type Database = DatabaseDriver.Database;

export function createDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseDriver(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_request_panels (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL DEFAULT 'Role Selection',
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_request_panel_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      button_label TEXT,
      description TEXT,
      image_url TEXT,
      color INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (guild_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_role_request_roles_guild
      ON role_request_panel_roles (guild_id);
  `);

  migrateDatabase(db);
  migrateYoutubeSubscriptions(db);
  migrateXTables(db);
  migrateRssTables(db);

  return db;
}

function migrateDatabase(db: Database): void {
  migrateRoleRequestPanelRoles(db);
}

function migrateRoleRequestPanelRoles(db: Database): void {
  const columns = db
    .prepare(`PRAGMA table_info(role_request_panel_roles)`)
    .all() as { name: string }[];

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("description")) {
    db.exec(`ALTER TABLE role_request_panel_roles ADD COLUMN description TEXT`);
  }

  if (!columnNames.has("image_url")) {
    db.exec(`ALTER TABLE role_request_panel_roles ADD COLUMN image_url TEXT`);
  }

  if (!columnNames.has("color")) {
    db.exec(`ALTER TABLE role_request_panel_roles ADD COLUMN color INTEGER`);
  }
}

export function parsePingIds(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function formatPingMentions(
  roleIds: string[],
  userIds: string[],
): string {
  const mentions = [
    ...roleIds.map((id) => `<@&${id}>`),
    ...userIds.map((id) => `<@${id}>`),
  ];

  return mentions.join(" ");
}
