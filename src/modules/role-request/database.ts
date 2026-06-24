import type { Database } from "../../core/database.js";

export const ROLE_TOGGLE_PREFIX = "rr:toggle:";

export interface RoleRequestPanelRow {
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  description: string | null;
  updated_at: string;
}

export interface RoleRequestPanelRoleRow {
  id: number;
  guild_id: string;
  role_id: string;
  button_label: string | null;
  description: string | null;
  image_url: string | null;
  color: number | null;
  sort_order: number;
}

export interface RolePaneConfig {
  buttonLabel?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  color?: number | null;
}

export function getRoleRequestPanel(
  db: Database,
  guildId: string,
): RoleRequestPanelRow | null {
  return (
    (db
      .prepare(`SELECT * FROM role_request_panels WHERE guild_id = ?`)
      .get(guildId) as RoleRequestPanelRow | undefined) ?? null
  );
}

export function upsertRoleRequestPanel(
  db: Database,
  data: {
    guildId: string;
    channelId: string;
    title?: string;
    description?: string | null;
  },
): RoleRequestPanelRow {
  const stmt = db.prepare(`
    INSERT INTO role_request_panels (guild_id, channel_id, title, description)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      title = excluded.title,
      description = excluded.description,
      updated_at = datetime('now')
    RETURNING *
  `);

  return stmt.get(
    data.guildId,
    data.channelId,
    data.title ?? "Role Selection",
    data.description ?? null,
  ) as RoleRequestPanelRow;
}

export function setRoleRequestPanelMessageId(
  db: Database,
  guildId: string,
  messageId: string | null,
): void {
  db.prepare(
    `UPDATE role_request_panels
     SET message_id = ?, updated_at = datetime('now')
     WHERE guild_id = ?`,
  ).run(messageId, guildId);
}

export function getRoleRequestPanelRoles(
  db: Database,
  guildId: string,
): RoleRequestPanelRoleRow[] {
  return db
    .prepare(
      `SELECT * FROM role_request_panel_roles
       WHERE guild_id = ?
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(guildId) as RoleRequestPanelRoleRow[];
}

export function addRoleRequestPanelRole(
  db: Database,
  guildId: string,
  roleId: string,
  config: RolePaneConfig = {},
): RoleRequestPanelRoleRow {
  const maxOrder = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_order
       FROM role_request_panel_roles
       WHERE guild_id = ?`,
    )
    .get(guildId) as { max_order: number };

  const stmt = db.prepare(`
    INSERT INTO role_request_panel_roles (
      guild_id,
      role_id,
      button_label,
      description,
      image_url,
      color,
      sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, role_id) DO UPDATE SET
      button_label = COALESCE(excluded.button_label, button_label),
      description = COALESCE(excluded.description, description),
      image_url = COALESCE(excluded.image_url, image_url),
      color = COALESCE(excluded.color, color)
    RETURNING *
  `);

  return stmt.get(
    guildId,
    roleId,
    config.buttonLabel ?? null,
    config.description ?? null,
    config.imageUrl ?? null,
    config.color ?? null,
    maxOrder.max_order + 1,
  ) as RoleRequestPanelRoleRow;
}

export function updateRoleRequestPanelRole(
  db: Database,
  guildId: string,
  roleId: string,
  config: RolePaneConfig,
): boolean {
  const existing = db
    .prepare(
      `SELECT * FROM role_request_panel_roles
       WHERE guild_id = ? AND role_id = ?`,
    )
    .get(guildId, roleId) as RoleRequestPanelRoleRow | undefined;

  if (!existing) {
    return false;
  }

  const result = db
    .prepare(
      `UPDATE role_request_panel_roles
       SET button_label = ?,
           description = ?,
           image_url = ?,
           color = ?
       WHERE guild_id = ? AND role_id = ?`,
    )
    .run(
      config.buttonLabel !== undefined
        ? config.buttonLabel
        : existing.button_label,
      config.description !== undefined
        ? config.description
        : existing.description,
      config.imageUrl !== undefined ? config.imageUrl : existing.image_url,
      config.color !== undefined ? config.color : existing.color,
      guildId,
      roleId,
    );

  return result.changes > 0;
}

export function removeRoleRequestPanelRole(
  db: Database,
  guildId: string,
  roleId: string,
): boolean {
  const result = db
    .prepare(
      `DELETE FROM role_request_panel_roles
       WHERE guild_id = ? AND role_id = ?`,
    )
    .run(guildId, roleId);
  return result.changes > 0;
}

export function roleToggleCustomId(roleId: string): string {
  return `${ROLE_TOGGLE_PREFIX}${roleId}`;
}

export function parseRoleToggleCustomId(customId: string): string | null {
  if (!customId.startsWith(ROLE_TOGGLE_PREFIX)) {
    return null;
  }

  const roleId = customId.slice(ROLE_TOGGLE_PREFIX.length);
  return roleId.length > 0 ? roleId : null;
}
