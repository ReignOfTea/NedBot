import type { Database } from "../database.js";

export interface RolePermissionRow {
  guild_id: string;
  role_id: string;
  permission: string;
  granted_at: string;
  granted_by: string | null;
}

export function migratePermissionTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      granted_by TEXT,
      PRIMARY KEY (guild_id, role_id, permission)
    );

    CREATE INDEX IF NOT EXISTS idx_role_permissions_guild_role
      ON role_permissions (guild_id, role_id);
  `);
}

export function grantRolePermission(
  db: Database,
  guildId: string,
  roleId: string,
  permission: string,
  grantedBy: string,
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO role_permissions (guild_id, role_id, permission, granted_by)
       VALUES (?, ?, ?, ?)`,
    )
    .run(guildId, roleId, permission, grantedBy);
  return result.changes > 0;
}

export function revokeRolePermission(
  db: Database,
  guildId: string,
  roleId: string,
  permission: string,
): boolean {
  const result = db
    .prepare(
      `DELETE FROM role_permissions
       WHERE guild_id = ? AND role_id = ? AND permission = ?`,
    )
    .run(guildId, roleId, permission);
  return result.changes > 0;
}

export function listRolePermissions(
  db: Database,
  guildId: string,
  roleId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT permission FROM role_permissions
       WHERE guild_id = ? AND role_id = ?
       ORDER BY permission`,
    )
    .all(guildId, roleId) as { permission: string }[];

  return rows.map((row) => row.permission);
}

export function listRolesWithPermission(
  db: Database,
  guildId: string,
  permission: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT role_id FROM role_permissions
       WHERE guild_id = ? AND permission = ?
       ORDER BY role_id`,
    )
    .all(guildId, permission) as { role_id: string }[];

  return rows.map((row) => row.role_id);
}

export function getGuildRolePermissions(
  db: Database,
  guildId: string,
): RolePermissionRow[] {
  return db
    .prepare(
      `SELECT guild_id, role_id, permission, granted_at, granted_by
       FROM role_permissions
       WHERE guild_id = ?
       ORDER BY role_id, permission`,
    )
    .all(guildId) as RolePermissionRow[];
}

export function getPermissionsForRoles(
  db: Database,
  guildId: string,
  roleIds: readonly string[],
): string[] {
  if (roleIds.length === 0) {
    return [];
  }

  const placeholders = roleIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT permission FROM role_permissions
       WHERE guild_id = ? AND role_id IN (${placeholders})`,
    )
    .all(guildId, ...roleIds) as { permission: string }[];

  return rows.map((row) => row.permission);
}
