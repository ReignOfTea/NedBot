import type { CommandInteraction } from "discord.js";

import { getModuleContext } from "../module-loader.js";
import { getPermissionsForRoles } from "./database.js";

function getMemberRoleIds(interaction: CommandInteraction): string[] {
  const member = interaction.member;
  if (!member || !("roles" in member)) {
    return [];
  }

  const roles = member.roles;
  if (Array.isArray(roles)) {
    return roles;
  }

  if ("cache" in roles) {
    return [...roles.cache.keys()];
  }

  return [];
}

export function isBotOwner(userId: string): boolean {
  const { config } = getModuleContext();
  return config.botOwnerUserId === userId;
}

export function hasLegacyBotAdmin(userId: string): boolean {
  const { config } = getModuleContext();
  return config.botAdminUserIds.includes(userId);
}

function permissionMatches(granted: string, required: string): boolean {
  if (granted === required || granted === "*") {
    return true;
  }

  if (granted.endsWith(".*")) {
    const prefix = granted.slice(0, -1);
    return required.startsWith(prefix);
  }

  return false;
}

export function hasPermission(
  interaction: CommandInteraction,
  required: string,
): boolean {
  const userId = interaction.user.id;

  if (isBotOwner(userId) || hasLegacyBotAdmin(userId)) {
    return true;
  }

  if (!interaction.guildId) {
    return false;
  }

  const roleIds = getMemberRoleIds(interaction);
  const { db } = getModuleContext();
  const granted = getPermissionsForRoles(db, interaction.guildId, roleIds);

  return granted.some((perm) => permissionMatches(perm, required));
}
