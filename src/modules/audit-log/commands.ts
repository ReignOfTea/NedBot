import {
  ApplicationCommandOptionType,
  ChannelType,
  type CommandInteraction,
  type GuildTextBasedChannel,
  MessageFlags,
} from "discord.js";
import {
  Discord,
  Guard,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";

import { AllowedGuildOnly } from "../../core/guards.js";
import { CommandPermission } from "../../core/permissions/index.js";
import { getModuleContext } from "../../core/module-loader.js";
import {
  AUDIT_CATEGORIES,
  describeDisabledCategories,
  describePartiallyDisabledCategories,
  getCategoryLabel,
  type AuditCategory,
} from "./actions.js";
import {
  clearAuditLogChannel,
  disableAuditCategory,
  enableAuditCategory,
  getAuditLogSettings,
  resetAuditFilters,
  setAuditLogEnabled,
  upsertAuditLogChannel,
} from "./database.js";

function requireSettingsMessage(
  settings: ReturnType<typeof getAuditLogSettings>,
): string | null {
  if (settings) {
    return null;
  }
  return "Audit logging is not configured. Use `/audit set-channel` first.";
}

function formatStatus(
  settings: NonNullable<ReturnType<typeof getAuditLogSettings>>,
): string {
  const lines = [
    `**Channel:** <#${settings.channelId}>`,
    `**Enabled:** ${settings.enabled ? "Yes" : "No"}`,
    `**Last updated:** ${settings.updatedAt}`,
  ];

  const fullyDisabled = describeDisabledCategories(settings.disabledActions);
  const partiallyDisabled = describePartiallyDisabledCategories(
    settings.disabledActions,
  );

  if (fullyDisabled.length === 0 && partiallyDisabled.length === 0) {
    lines.push("**Filters:** All moderation categories enabled");
  } else {
    if (fullyDisabled.length > 0) {
      lines.push(
        `**Disabled categories:** ${fullyDisabled.map((category) => `\`${category}\``).join(", ")}`,
      );
    }
    if (partiallyDisabled.length > 0) {
      lines.push(
        `**Partially filtered:** ${partiallyDisabled.map((category) => `\`${category}\``).join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

@Discord()
@SlashGroup({
  description: "Moderation audit logging",
  name: "audit",
})
@Guard(AllowedGuildOnly, CommandPermission)
export class AuditCommands {
  @Slash({
    description: "Set the channel where moderation actions are logged",
    name: "set-channel",
  })
  @SlashGroup("audit")
  async setChannel(
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Channel to post audit log embeds in",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: GuildTextBasedChannel,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    upsertAuditLogChannel(db, interaction.guildId!, channel.id);

    await interaction.editReply({
      content: `Moderation audit logs will be posted in ${channel}. Use \`/audit status\` to review settings.`,
    });
  }

  @Slash({
    description: "Resume posting audit logs to the configured channel",
    name: "enable",
  })
  @SlashGroup("audit")
  async enable(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const settings = getAuditLogSettings(db, interaction.guildId!);
    const missing = requireSettingsMessage(settings);
    if (missing) {
      await interaction.editReply({ content: missing });
      return;
    }

    setAuditLogEnabled(db, interaction.guildId!, true);
    await interaction.editReply({
      content: `Audit logging enabled in <#${settings!.channelId}>.`,
    });
  }

  @Slash({
    description: "Pause audit logging without removing the configured channel",
    name: "disable",
  })
  @SlashGroup("audit")
  async disable(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const settings = getAuditLogSettings(db, interaction.guildId!);
    const missing = requireSettingsMessage(settings);
    if (missing) {
      await interaction.editReply({ content: missing });
      return;
    }

    setAuditLogEnabled(db, interaction.guildId!, false);
    await interaction.editReply({
      content: `Audit logging paused. The log channel (<#${settings!.channelId}>) is still saved — use \`/audit enable\` to resume.`,
    });
  }

  @Slash({
    description: "Stop logging and remove all audit configuration",
    name: "clear",
  })
  @SlashGroup("audit")
  async clear(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const removed = clearAuditLogChannel(db, interaction.guildId!);

    await interaction.editReply({
      content: removed
        ? "Audit logging configuration removed."
        : "No audit log configuration was saved.",
    });
  }

  @Slash({
    description: "Show audit log channel, enabled state, and filters",
    name: "status",
  })
  @SlashGroup("audit")
  async status(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const settings = getAuditLogSettings(db, interaction.guildId!);

    if (!settings) {
      await interaction.editReply({
        content:
          "Audit logging is not configured. Use `/audit set-channel` to choose a channel.",
      });
      return;
    }

    await interaction.editReply({
      content: formatStatus(settings),
    });
  }

  @Slash({
    description: "List moderation categories you can include or exclude",
    name: "categories",
  })
  @SlashGroup("audit")
  async categories(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const lines = AUDIT_CATEGORIES.map(
      (category) => `• \`${category}\` — ${getCategoryLabel(category)}`,
    );

    await interaction.editReply({
      content: `**Audit categories**\n${lines.join("\n")}\n\nUse \`/audit exclude\` or \`/audit include\` to filter by category.`,
    });
  }

  @Slash({
    description: "Stop logging a moderation category",
    name: "exclude",
  })
  @SlashGroup("audit")
  async exclude(
    @SlashChoice(...AUDIT_CATEGORIES)
    @SlashOption({
      description: "Category to exclude from audit logs",
      name: "category",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    category: AuditCategory,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const settings = disableAuditCategory(db, interaction.guildId!, category);
    const missing = requireSettingsMessage(settings);
    if (missing) {
      await interaction.editReply({ content: missing });
      return;
    }

    await interaction.editReply({
      content: `Excluded **${category}** from audit logs.\n\n${formatStatus(settings!)}`,
    });
  }

  @Slash({
    description: "Resume logging a moderation category",
    name: "include",
  })
  @SlashGroup("audit")
  async include(
    @SlashChoice(...AUDIT_CATEGORIES)
    @SlashOption({
      description: "Category to include in audit logs again",
      name: "category",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    category: AuditCategory,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const settings = enableAuditCategory(db, interaction.guildId!, category);
    const missing = requireSettingsMessage(settings);
    if (missing) {
      await interaction.editReply({ content: missing });
      return;
    }

    await interaction.editReply({
      content: `Re-enabled **${category}** in audit logs.\n\n${formatStatus(settings!)}`,
    });
  }

  @Slash({
    description: "Log all moderation categories again",
    name: "reset-filters",
  })
  @SlashGroup("audit")
  async resetFilters(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const settings = resetAuditFilters(db, interaction.guildId!);
    const missing = requireSettingsMessage(settings);
    if (missing) {
      await interaction.editReply({ content: missing });
      return;
    }

    await interaction.editReply({
      content: `All category filters cleared.\n\n${formatStatus(settings!)}`,
    });
  }
}
