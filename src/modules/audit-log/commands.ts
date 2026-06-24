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
  SlashGroup,
  SlashOption,
} from "discordx";

import { AllowedGuildOnly, ManageGuildOnly } from "../../core/guards.js";
import { getModuleContext } from "../../core/module-loader.js";
import {
  clearAuditLogChannel,
  getAuditLogSettings,
  upsertAuditLogChannel,
} from "./database.js";

@Discord()
@SlashGroup({
  description: "Moderation audit logging",
  name: "audit",
})
@Guard(AllowedGuildOnly, ManageGuildOnly)
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
      content: `Moderation audit logs will be posted in ${channel}.`,
    });
  }

  @Slash({
    description: "Stop logging moderation actions",
    name: "clear",
  })
  @SlashGroup("audit")
  async clear(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const removed = clearAuditLogChannel(db, interaction.guildId!);

    await interaction.editReply({
      content: removed
        ? "Audit logging disabled."
        : "No audit log channel was configured.",
    });
  }

  @Slash({
    description: "Show the configured audit log channel",
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
      content: `Audit logs are posted in <#${settings.channelId}> (configured ${settings.updatedAt}).`,
    });
  }
}
