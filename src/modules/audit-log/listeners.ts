import { Events, type Guild, type GuildAuditLogsEntry } from "discord.js";

import type { ModuleContext } from "../../core/types.js";
import { isModerationAction } from "./actions.js";
import { getAuditLogSettings } from "./database.js";
import { buildAuditLogEmbed } from "./formatter.js";
import { log } from "./log.js";

export class AuditLogListener {
  private readonly handler = (
    auditLogEntry: GuildAuditLogsEntry,
    guild: Guild,
  ) => {
    void this.onAuditLogEntry(auditLogEntry, guild);
  };

  constructor(private readonly ctx: ModuleContext) {}

  start(): void {
    this.ctx.client.on(Events.GuildAuditLogEntryCreate, this.handler);
  }

  stop(): void {
    this.ctx.client.off(Events.GuildAuditLogEntryCreate, this.handler);
  }

  private async onAuditLogEntry(
    entry: GuildAuditLogsEntry,
    guild: Guild,
  ): Promise<void> {
    if (guild.id !== this.ctx.config.discordGuildId) {
      return;
    }

    if (!isModerationAction(entry.action)) {
      return;
    }

    const settings = getAuditLogSettings(this.ctx.db, guild.id);
    if (!settings) {
      return;
    }

    const channel = await guild.channels
      .fetch(settings.channelId)
      .catch(() => null);
    if (!channel?.isTextBased()) {
      log.warn(
        { channelId: settings.channelId, guildId: guild.id },
        "Audit log channel missing or not text-based",
      );
      return;
    }

    try {
      const embed = buildAuditLogEmbed(entry, guild);
      await channel.send({ embeds: [embed] });
    } catch (error) {
      log.error(
        { err: error, action: entry.action, entryId: entry.id },
        "Failed to post audit log entry",
      );
    }
  }
}
