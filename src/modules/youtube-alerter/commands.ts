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
import { getModuleContext } from "../../core/module-loader.js";
import { AllowedGuildOnly } from "../../core/guards.js";
import {
  addSubscriptionPing,
  clearSubscriptionPings,
  formatAlertChannels,
  getYoutubeSubscriptionsByGuild,
  removeSubscriptionPing,
  removeYoutubeSubscription,
  setYoutubeAlertChannels,
  upsertYoutubeSubscription,
} from "./database.js";
import {
  describePingTargets,
  pingTargetFromMentionable,
} from "./ping-targets.js";
import { getYoutubePoller } from "./runtime.js";
import { YoutubeApiClient } from "./youtube-api.js";

@Discord()
@SlashGroup({
  description: "YouTube live, video, and community post alerts",
  name: "youtube",
})
@Guard(AllowedGuildOnly)
export class YoutubeCommands {
  @Slash({
    description: "Subscribe a YouTube channel (set one or more alert channels)",
    name: "subscribe",
  })
  @SlashGroup("youtube")
  async subscribe(
    @SlashOption({
      description: "YouTube channel URL, @handle, or channel ID",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    channelInput: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel for live stream alerts",
      name: "live-channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    liveChannel: GuildTextBasedChannel | undefined,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel for new video and Short alerts",
      name: "video-channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    videoChannel: GuildTextBasedChannel | undefined,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel for community post alerts",
      name: "post-channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    postChannel: GuildTextBasedChannel | undefined,
    @SlashOption({
      description: "Role to @mention for alerts from this channel",
      name: "ping-role",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    pingRole: Role | undefined,
    @SlashOption({
      description: "User to @mention for alerts from this channel",
      name: "ping-user",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    pingUser: User | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!liveChannel && !videoChannel && !postChannel) {
      await interaction.editReply({
        content:
          "Provide at least one of `live-channel`, `video-channel`, or `post-channel`.",
      });
      return;
    }

    const { config, db } = getModuleContext();
    const api = new YoutubeApiClient(config.youtubeApiKey);

    try {
      const channel = await api.resolveChannel(channelInput);

      upsertYoutubeSubscription(db, {
        guildId: interaction.guildId!,
        youtubeChannelId: channel.id,
        youtubeChannelTitle: channel.title,
        liveChannelId: liveChannel?.id,
        videoChannelId: videoChannel?.id,
        postChannelId: postChannel?.id,
      });

      getYoutubePoller()?.rescheduleInterval();

      if (pingRole) {
        addSubscriptionPing(db, interaction.guildId!, channel.id, {
          type: "role",
          id: pingRole.id,
        });
      }

      if (pingUser) {
        addSubscriptionPing(db, interaction.guildId!, channel.id, {
          type: "user",
          id: pingUser.id,
        });
      }

      const subs = getYoutubeSubscriptionsByGuild(db, interaction.guildId!).find(
        (sub) => sub.youtube_channel_id === channel.id,
      );
      const pingSummary = subs
        ? describePingTargets(
            parsePingIds(subs.ping_role_ids),
            parsePingIds(subs.ping_user_ids),
          )
        : describePingTargets(
            pingRole ? [pingRole.id] : [],
            pingUser ? [pingUser.id] : [],
          );

      await interaction.editReply({
        content: [
          `Subscribed to **${channel.title}**`,
          `Alert channels: ${subs ? formatAlertChannels(subs) : "configured"}`,
          `Ping targets: ${pingSummary}`,
        ].join("\n"),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to subscribe.";
      await interaction.editReply({ content: `Error: ${message}` });
    }
  }

  @Slash({
    description: "Update which Discord channels receive each alert type",
    name: "set-channels",
  })
  @SlashGroup("youtube")
  async setChannels(
    @SlashOption({
      description: "YouTube channel URL, @handle, or channel ID",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    channelInput: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel for live stream alerts",
      name: "live-channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    liveChannel: GuildTextBasedChannel | undefined,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel for new video and Short alerts",
      name: "video-channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    videoChannel: GuildTextBasedChannel | undefined,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Discord channel for community post alerts",
      name: "post-channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    postChannel: GuildTextBasedChannel | undefined,
    @SlashOption({
      description: "Stop sending live stream alerts",
      name: "disable-live",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    disableLive: boolean | undefined,
    @SlashOption({
      description: "Stop sending video and Short alerts",
      name: "disable-video",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    disableVideo: boolean | undefined,
    @SlashOption({
      description: "Stop sending community post alerts",
      name: "disable-post",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    disablePost: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const hasChannelUpdate =
      liveChannel !== undefined ||
      videoChannel !== undefined ||
      postChannel !== undefined;
    const hasDisable =
      disableLive === true || disableVideo === true || disablePost === true;

    if (!hasChannelUpdate && !hasDisable) {
      await interaction.editReply({
        content:
          "Provide at least one channel to set or set a `disable-*` option to true.",
      });
      return;
    }

    const { config, db } = getModuleContext();
    const api = new YoutubeApiClient(config.youtubeApiKey);

    try {
      const channel = await api.resolveChannel(channelInput);

      const updated = setYoutubeAlertChannels(
        db,
        interaction.guildId!,
        channel.id,
        {
          liveChannelId: disableLive
            ? null
            : liveChannel?.id,
          videoChannelId: disableVideo
            ? null
            : videoChannel?.id,
          postChannelId: disablePost
            ? null
            : postChannel?.id,
        },
      );

      if (!updated) {
        await interaction.editReply({
          content: `No subscription found for **${channel.title}**. Subscribe first with \`/youtube subscribe\`.`,
        });
        return;
      }

      const sub = getYoutubeSubscriptionsByGuild(db, interaction.guildId!).find(
        (row) => row.youtube_channel_id === channel.id,
      );

      await interaction.editReply({
        content: [
          `Updated alert channels for **${channel.title}**.`,
          sub ? `Alert channels: ${formatAlertChannels(sub)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update channels.";
      await interaction.editReply({ content: `Error: ${message}` });
    }
  }

  @Slash({ description: "Unsubscribe from a YouTube channel", name: "unsubscribe" })
  @SlashGroup("youtube")
  async unsubscribe(
    @SlashOption({
      description: "YouTube channel URL, @handle, or channel ID",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    channelInput: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { config, db } = getModuleContext();
    const api = new YoutubeApiClient(config.youtubeApiKey);

    try {
      const channel = await api.resolveChannel(channelInput);
      const removed = removeYoutubeSubscription(
        db,
        interaction.guildId!,
        channel.id,
      );

      if (!removed) {
        await interaction.editReply({
          content: `No subscription found for **${channel.title}**.`,
        });
        return;
      }

      getYoutubePoller()?.rescheduleInterval();

      await interaction.editReply({
        content: `Unsubscribed from **${channel.title}**.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to unsubscribe.";
      await interaction.editReply({ content: `Error: ${message}` });
    }
  }

  @Slash({
    description: "Add a user or role to ping for a YouTube subscription",
    name: "ping-add",
  })
  @SlashGroup("youtube")
  async pingAdd(
    @SlashOption({
      description: "YouTube channel URL, @handle, or channel ID",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    channelInput: string,
    @SlashOption({
      description: "User or role to ping for alerts from this channel",
      name: "target",
      required: true,
      type: ApplicationCommandOptionType.Mentionable,
    })
    target: GuildMember | Role | User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { config, db } = getModuleContext();
    const api = new YoutubeApiClient(config.youtubeApiKey);

    try {
      const channel = await api.resolveChannel(channelInput);
      const pingTarget = pingTargetFromMentionable(target);
      const updated = addSubscriptionPing(
        db,
        interaction.guildId!,
        channel.id,
        pingTarget,
      );

      if (!updated) {
        await interaction.editReply({
          content: `No subscription found for **${channel.title}**. Subscribe first with \`/youtube subscribe\`.`,
        });
        return;
      }

      await interaction.editReply({
        content: `Added ${describePingTargets(
          pingTarget.type === "role" ? [pingTarget.id] : [],
          pingTarget.type === "user" ? [pingTarget.id] : [],
        )} to **${channel.title}** alerts.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to add ping target.";
      await interaction.editReply({ content: `Error: ${message}` });
    }
  }

  @Slash({
    description: "Remove a user or role from a YouTube subscription's pings",
    name: "ping-remove",
  })
  @SlashGroup("youtube")
  async pingRemove(
    @SlashOption({
      description: "YouTube channel URL, @handle, or channel ID",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    channelInput: string,
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

    const { config, db } = getModuleContext();
    const api = new YoutubeApiClient(config.youtubeApiKey);

    try {
      const channel = await api.resolveChannel(channelInput);
      const pingTarget = pingTargetFromMentionable(target);
      const updated = removeSubscriptionPing(
        db,
        interaction.guildId!,
        channel.id,
        pingTarget,
      );

      if (!updated) {
        await interaction.editReply({
          content: `No subscription found for **${channel.title}**.`,
        });
        return;
      }

      await interaction.editReply({
        content: `Removed ${describePingTargets(
          pingTarget.type === "role" ? [pingTarget.id] : [],
          pingTarget.type === "user" ? [pingTarget.id] : [],
        )} from **${channel.title}** alerts.`,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to remove ping target.";
      await interaction.editReply({ content: `Error: ${message}` });
    }
  }

  @Slash({
    description: "Clear all ping targets for a YouTube subscription",
    name: "ping-clear",
  })
  @SlashGroup("youtube")
  async pingClear(
    @SlashOption({
      description: "YouTube channel URL, @handle, or channel ID",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    channelInput: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { config, db } = getModuleContext();
    const api = new YoutubeApiClient(config.youtubeApiKey);

    try {
      const channel = await api.resolveChannel(channelInput);
      const updated = clearSubscriptionPings(
        db,
        interaction.guildId!,
        channel.id,
      );

      if (!updated) {
        await interaction.editReply({
          content: `No subscription found for **${channel.title}**.`,
        });
        return;
      }

      await interaction.editReply({
        content: `Cleared all ping targets for **${channel.title}**.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to clear ping targets.";
      await interaction.editReply({ content: `Error: ${message}` });
    }
  }

  @Slash({ description: "List YouTube alert subscriptions for this server", name: "list" })
  @SlashGroup("youtube")
  async list(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { db } = getModuleContext();
    const subs = getYoutubeSubscriptionsByGuild(db, interaction.guildId!);

    if (subs.length === 0) {
      await interaction.editReply({
        content:
          "No YouTube subscriptions in this server. Use `/youtube subscribe` to add one.",
      });
      return;
    }

    const lines = subs.map((sub) => {
      const title = sub.youtube_channel_title ?? sub.youtube_channel_id;
      const pings = describePingTargets(
        parsePingIds(sub.ping_role_ids),
        parsePingIds(sub.ping_user_ids),
      );
      return `• **${title}**\n  ${formatAlertChannels(sub)}\n  pings: ${pings}`;
    });

    await interaction.editReply({
      content: `**YouTube subscriptions (${subs.length})**\n${lines.join("\n")}`,
    });
  }

  @Slash({
    description: "Force-check all subscriptions and send any new alerts",
    name: "sync",
  })
  @SlashGroup("youtube")
  async sync(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const poller = getYoutubePoller();
    if (!poller) {
      await interaction.editReply({
        content: "YouTube alerter is not running.",
      });
      return;
    }

    const result = await poller.syncNow();

    if (result.checked === 0) {
      await interaction.editReply({
        content: "No subscriptions to check. Use `/youtube subscribe` first.",
      });
      return;
    }

    const found = result.live + result.videos + result.posts;

    if (found === 0) {
      await interaction.editReply({
        content: `Checked **${result.checked}** channel(s) — no new live streams, videos, or posts to alert.`,
      });
      return;
    }

    await interaction.editReply({
      content: [
        `Checked **${result.checked}** channel(s).`,
        `Found: **${result.live}** live, **${result.videos}** video(s), **${result.posts}** post(s).`,
        `Sent **${result.alerted}** alert(s).`,
      ].join("\n"),
    });
  }
}
