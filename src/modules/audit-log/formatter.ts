import {
  AuditLogEvent,
  Colors,
  EmbedBuilder,
  type Guild,
  type GuildAuditLogsEntry,
  type PartialUser,
  type User,
} from "discord.js";

import { actionLabel } from "./actions.js";

const ACTION_COLORS: Partial<Record<AuditLogEvent, number>> = {
  [AuditLogEvent.MemberKick]: Colors.Orange,
  [AuditLogEvent.MemberPrune]: Colors.Orange,
  [AuditLogEvent.MemberBanAdd]: Colors.Red,
  [AuditLogEvent.MemberBanRemove]: Colors.Green,
  [AuditLogEvent.MemberUpdate]: Colors.Yellow,
  [AuditLogEvent.MemberRoleUpdate]: Colors.Blurple,
  [AuditLogEvent.MemberMove]: Colors.Grey,
  [AuditLogEvent.MemberDisconnect]: Colors.Grey,
  [AuditLogEvent.RoleCreate]: Colors.Green,
  [AuditLogEvent.RoleUpdate]: Colors.Blurple,
  [AuditLogEvent.RoleDelete]: Colors.Red,
  [AuditLogEvent.ChannelDelete]: Colors.Red,
  [AuditLogEvent.ChannelOverwriteCreate]: Colors.Blurple,
  [AuditLogEvent.ChannelOverwriteUpdate]: Colors.Blurple,
  [AuditLogEvent.ChannelOverwriteDelete]: Colors.Red,
  [AuditLogEvent.MessageDelete]: Colors.DarkGrey,
  [AuditLogEvent.MessageBulkDelete]: Colors.DarkGrey,
  [AuditLogEvent.MessagePin]: Colors.Green,
  [AuditLogEvent.MessageUnpin]: Colors.Orange,
  [AuditLogEvent.ThreadDelete]: Colors.Red,
  [AuditLogEvent.AutoModerationBlockMessage]: Colors.Red,
  [AuditLogEvent.AutoModerationFlagToChannel]: Colors.Orange,
  [AuditLogEvent.AutoModerationUserCommunicationDisabled]: Colors.Yellow,
  [AuditLogEvent.AutoModerationQuarantineUser]: Colors.Red,
};

export function buildAuditLogEmbed(
  entry: GuildAuditLogsEntry,
  guild: Guild,
): EmbedBuilder {
  const label = actionLabel(entry.action);
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[entry.action] ?? Colors.DarkGrey)
    .setTitle(label)
    .setTimestamp(entry.createdAt);

  const executor = formatExecutor(entry.executor);
  if (executor) {
    embed.addFields({ name: "Moderator", value: executor, inline: true });
  }

  const target = formatTarget(entry, guild);
  if (target) {
    embed.addFields({ name: "Target", value: target, inline: true });
  }

  const details = formatDetails(entry, guild);
  if (details) {
    embed.addFields({ name: "Details", value: details });
  }

  if (entry.reason) {
    embed.addFields({ name: "Reason", value: entry.reason });
  }

  embed.setFooter({ text: `Audit log entry ${entry.id}` });
  return embed;
}

function formatExecutor(executor: User | PartialUser | null): string | null {
  if (!executor) {
    return null;
  }

  const tag = executor.tag ?? executor.id;
  return `${executor} (${tag})`;
}

function formatTarget(
  entry: GuildAuditLogsEntry,
  guild: Guild,
): string | null {
  const target = entry.target;

  if (!target) {
    if (entry.targetId) {
      return `\`${entry.targetId}\``;
    }
    return null;
  }

  if ("username" in target && target.username) {
    const user = target as User;
    return `${user} (${user.tag})`;
  }

  if ("name" in target && "id" in target) {
    const named = target as { id: string; name: string };
    if (entry.targetType === "Role") {
      return `<@&${named.id}> (${named.name})`;
    }
    if (entry.targetType === "Channel") {
      return `<#${named.id}> (${named.name})`;
    }
    return `${named.name} (\`${named.id}\`)`;
  }

  if ("id" in target && typeof target.id === "string") {
    return `\`${target.id}\``;
  }

  if (entry.targetId) {
    const channel = guild.channels.cache.get(entry.targetId);
    if (channel) {
      return `${channel}`;
    }
    const role = guild.roles.cache.get(entry.targetId);
    if (role) {
      return `${role}`;
    }
    const member = guild.members.cache.get(entry.targetId);
    if (member) {
      return `${member.user} (${member.user.tag})`;
    }
    return `<@${entry.targetId}>`;
  }

  return null;
}

function formatDetails(
  entry: GuildAuditLogsEntry,
  guild: Guild,
): string | null {
  const lines: string[] = [];

  if (entry.changes.length > 0) {
    for (const change of entry.changes) {
      const key = formatChangeKey(change.key);
      const oldValue = formatChangeValue(change.old, guild);
      const newValue = formatChangeValue(change.new, guild);

      if (oldValue === null && newValue !== null) {
        lines.push(`**${key}:** ${newValue}`);
      } else if (oldValue !== null && newValue === null) {
        lines.push(`**${key}:** ~~${oldValue}~~`);
      } else if (oldValue !== null && newValue !== null) {
        lines.push(`**${key}:** ${oldValue} → ${newValue}`);
      }
    }
  }

  const extra = entry.extra as Record<string, unknown> | null;
  if (extra) {
    if (typeof extra.count === "number") {
      lines.push(`**Messages deleted:** ${extra.count}`);
    }
    if (typeof extra.channel_id === "string") {
      lines.push(`**Channel:** <#${extra.channel_id}>`);
    }
    if (typeof extra.delete_member_days === "number") {
      lines.push(`**Delete message days:** ${extra.delete_member_days}`);
    }
    if (Array.isArray(extra.roles)) {
      const roles = extra.roles
        .map((role) => {
          if (typeof role === "object" && role && "id" in role) {
            return `<@&${String((role as { id: string }).id)}>`;
          }
          return null;
        })
        .filter((role): role is string => role !== null);
      if (roles.length > 0) {
        lines.push(`**Roles:** ${roles.join(", ")}`);
      }
    }
  }

  if (lines.length === 0) {
    return null;
  }

  return lines.join("\n").slice(0, 1024);
}

function formatChangeKey(key: string): string {
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatChangeValue(
  value: unknown,
  guild: Guild,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    if (value === "0" || value.length === 0) {
      return null;
    }

    if (keyLooksLikeSnowflake(value)) {
      const role = guild.roles.cache.get(value);
      if (role) {
        return role.name;
      }
      const channel = guild.channels.cache.get(value);
      if (channel) {
        return channel.name;
      }
    }

    if (isIsoTimestamp(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return value === "0"
          ? "None"
          : `<t:${Math.floor(date.getTime() / 1000)}:R>`;
      }
    }

    return value.slice(0, 200);
  }

  return String(value).slice(0, 200);
}

function keyLooksLikeSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value);
}
