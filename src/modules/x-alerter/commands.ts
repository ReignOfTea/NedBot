import {
  ApplicationCommandOptionType,
  ChannelType,
  type CommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  MessageFlags,
  type Role,
  type User,
} from "discord.js";
import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";

import { parsePingIds } from "../../core/database.js";
import { AllowedGuildOnly } from "../../core/guards.js";
import { CommandPermission } from "../../core/permissions/index.js";
import { getModuleContext } from "../../core/module-loader.js";
import {
  addSubscriptionPing,
  clearSubscriptionPings,
  getXSubscription,
  getXSubscriptionsByGuild,
  normalizeXUsername,
  removeSubscriptionPing,
  removeXSubscription,
  upsertXSubscription,
} from "./database.js";
import {
  describePingTargets,
  pingTargetFromMentionable,
} from "./ping-targets.js";
import { getXPushListener } from "./runtime.js";

const SETUP_HINT =
  "Your X account must follow this user and have post notifications enabled on X.";

@Discord()
@SlashGroup({
  description: "X (Twitter) post alerts via Web Push",
  name: "x",
})
@Guard(AllowedGuildOnly, CommandPermission)
export class XCommands {
  @Slash({
    description: "Subscribe to alerts when an X account posts",
    name: "subscribe",
  })
  @SlashGroup("x")
  async subscribe(
    @SlashOption({
      description: "X username (with or without @)",
      name: "username",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    usernameInput: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel to post alerts in",
      name: "alert-channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    alertChannel: GuildTextBasedChannel,
    @SlashOption({
      description: "Role to @mention when this account posts",
      name: "ping-role",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    pingRole: Role | undefined,
    @SlashOption({
      description: "User to @mention when this account posts",
      name: "ping-user",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    pingUser: User | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { config, db } = getModuleContext();
    if (!config.xEnabled) {
      await interaction.editReply({
        content:
          "X alerter is not configured. Set `X_AUTH_TOKEN` and `X_CT0` in the environment.",
      });
      return;
    }

    const username = normalizeXUsername(usernameInput);
    if (!username) {
      await interaction.editReply({ content: "Provide a valid X username." });
      return;
    }

    upsertXSubscription(db, {
      guildId: interaction.guildId!,
      username,
      discordChannelId: alertChannel.id,
    });

    if (pingRole) {
      addSubscriptionPing(db, interaction.guildId!, username, {
        type: "role",
        id: pingRole.id,
      });
    }

    if (pingUser) {
      addSubscriptionPing(db, interaction.guildId!, username, {
        type: "user",
        id: pingUser.id,
      });
    }

    const sub = getXSubscription(db, interaction.guildId!, username);
    const pingSummary = sub
      ? describePingTargets(
          parsePingIds(sub.ping_role_ids),
          parsePingIds(sub.ping_user_ids),
        )
      : describePingTargets(
          pingRole ? [pingRole.id] : [],
          pingUser ? [pingUser.id] : [],
        );

    await interaction.editReply({
      content: [
        `Subscribed to **@${username}**`,
        `Alerts will be posted in ${alertChannel}.`,
        `Ping targets: ${pingSummary}`,
        SETUP_HINT,
      ].join("\n"),
    });
  }

  @Slash({ description: "Unsubscribe from an X account", name: "unsubscribe" })
  @SlashGroup("x")
  async unsubscribe(
    @SlashOption({
      description: "X username (with or without @)",
      name: "username",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    usernameInput: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const username = normalizeXUsername(usernameInput);
    const removed = removeXSubscription(db, interaction.guildId!, username);

    if (!removed) {
      await interaction.editReply({
        content: `No subscription found for **@${username}**.`,
      });
      return;
    }

    await interaction.editReply({
      content: `Unsubscribed from **@${username}**.`,
    });
  }

  @Slash({
    description: "Add a user or role to ping for an X subscription",
    name: "ping-add",
  })
  @SlashGroup("x")
  async pingAdd(
    @SlashOption({
      description: "X username (with or without @)",
      name: "username",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    usernameInput: string,
    @SlashOption({
      description: "User or role to ping when this account posts",
      name: "target",
      required: true,
      type: ApplicationCommandOptionType.Mentionable,
    })
    target: GuildMember | Role | User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const username = normalizeXUsername(usernameInput);
    const pingTarget = pingTargetFromMentionable(target);
    const updated = addSubscriptionPing(
      db,
      interaction.guildId!,
      username,
      pingTarget,
    );

    if (!updated) {
      await interaction.editReply({
        content: `No subscription found for **@${username}**. Subscribe first with \`/x subscribe\`.`,
      });
      return;
    }

    await interaction.editReply({
      content: `Added ${describePingTargets(
        pingTarget.type === "role" ? [pingTarget.id] : [],
        pingTarget.type === "user" ? [pingTarget.id] : [],
      )} to **@${username}** alerts.`,
    });
  }

  @Slash({
    description: "Remove a user or role from an X subscription's pings",
    name: "ping-remove",
  })
  @SlashGroup("x")
  async pingRemove(
    @SlashOption({
      description: "X username (with or without @)",
      name: "username",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    usernameInput: string,
    @SlashOption({
      description: "User or role to stop pinging",
      name: "target",
      required: true,
      type: ApplicationCommandOptionType.Mentionable,
    })
    target: GuildMember | Role | User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const username = normalizeXUsername(usernameInput);
    const pingTarget = pingTargetFromMentionable(target);
    const updated = removeSubscriptionPing(
      db,
      interaction.guildId!,
      username,
      pingTarget,
    );

    if (!updated) {
      await interaction.editReply({
        content: `No subscription found for **@${username}**.`,
      });
      return;
    }

    await interaction.editReply({
      content: `Removed ${describePingTargets(
        pingTarget.type === "role" ? [pingTarget.id] : [],
        pingTarget.type === "user" ? [pingTarget.id] : [],
      )} from **@${username}** alerts.`,
    });
  }

  @Slash({
    description: "Clear all ping targets for an X subscription",
    name: "ping-clear",
  })
  @SlashGroup("x")
  async pingClear(
    @SlashOption({
      description: "X username (with or without @)",
      name: "username",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    usernameInput: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const username = normalizeXUsername(usernameInput);
    const updated = clearSubscriptionPings(db, interaction.guildId!, username);

    if (!updated) {
      await interaction.editReply({
        content: `No subscription found for **@${username}**.`,
      });
      return;
    }

    await interaction.editReply({
      content: `Cleared all ping targets for **@${username}**.`,
    });
  }

  @Slash({ description: "List X alert subscriptions for this server", name: "list" })
  @SlashGroup("x")
  async list(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const subs = getXSubscriptionsByGuild(db, interaction.guildId!);

    if (subs.length === 0) {
      await interaction.editReply({
        content:
          "No X subscriptions in this server. Use `/x subscribe` to add one.",
      });
      return;
    }

    const lines = subs.map((sub) => {
      const pings = describePingTargets(
        parsePingIds(sub.ping_role_ids),
        parsePingIds(sub.ping_user_ids),
      );
      return `• **@${sub.x_username}** → <#${sub.discord_channel_id}> (pings: ${pings})`;
    });

    await interaction.editReply({
      content: `**X subscriptions (${subs.length})**\n${lines.join("\n")}`,
    });
  }

  @Slash({
    description: "Show X push listener status and setup notes",
    name: "status",
  })
  @SlashGroup("x")
  async status(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { config, db } = getModuleContext();
    const subs = getXSubscriptionsByGuild(db, interaction.guildId!);
    const listener = getXPushListener();
    const pushStatus = listener?.getStatus();

    const lines = [
      `Configured: **${config.xEnabled ? "yes" : "no"}**`,
      `Push listener: **${
        pushStatus?.running
          ? pushStatus.connected
            ? "connected"
            : "running (not connected)"
          : "not running"
      }**`,
      `Subscriptions in this server: **${subs.length}**`,
      "",
      SETUP_HINT,
    ];

    await interaction.editReply({ content: lines.join("\n") });
  }
}
